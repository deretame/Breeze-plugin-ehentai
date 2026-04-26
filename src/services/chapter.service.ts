import { MAX_CONCURRENT_REQUESTS } from "../domain/constants";
import type { ChapterContentContract, ReadPagesCompatContract } from "../domain/contracts";
import type { ChapterPayload, PluginSettings, ReaderRangeParsed } from "../domain/types";
import { parseError, PluginError } from "../errors/plugin-error";
import { mapChapterContent, mapReadPagesCompat, type ChapterDocInput } from "../mappers/chapter.mapper";
import { httpClient, mapWithConcurrency } from "../network/client";
import { buildDetailEndpoint, buildImagePageEndpoint } from "../network/endpoints";
import {
  extractReloadKeyFromImagePage,
  isRetryableImagePageHtml,
  parseImagePage,
  parseThumbnailRangePage,
  toImagePageHref,
} from "../parsers/reader.parser";
import { normalizePage, requiredString } from "../utils/guards";
import { ensureAllowedHostUrl, ensureAllowedMediaUrl } from "../utils/url";
import { buildRequestConfig } from "./settings.service";

type RequestConfig = { headers: Record<string, string> } | undefined;

async function getText(url: string, requestConfig?: RequestConfig): Promise<string> {
  return requestConfig ? httpClient.getText(url, requestConfig) : httpClient.getText(url);
}

async function resolveChapterDoc(
  imagePageHref: string,
  imageIndex: number,
  requestConfig: RequestConfig,
): Promise<ChapterDocInput> {
  const safeImagePageHref = ensureAllowedHostUrl(imagePageHref);
  const imagePageHtml = await getText(buildImagePageEndpoint(safeImagePageHref), requestConfig);

  try {
    const parsed = parseImagePage(safeImagePageHref, imagePageHtml);
    return {
      index: imageIndex,
      href: safeImagePageHref,
      imageUrl: ensureAllowedMediaUrl(parsed.imageUrl),
      reloadKey: parsed.reloadKey,
    };
  } catch (error) {
    if (error instanceof PluginError && error.code === "UPSTREAM_BLOCKED") {
      throw error;
    }

    const reloadKey = extractReloadKeyFromImagePage(imagePageHtml);
    if (!reloadKey || !isRetryableImagePageHtml(imagePageHtml)) {
      throw error;
    }

    const retriedHtml = await getText(buildImagePageEndpoint(safeImagePageHref, reloadKey), requestConfig);
    const retried = parseImagePage(safeImagePageHref, retriedHtml);

    return {
      index: imageIndex,
      href: safeImagePageHref,
      imageUrl: ensureAllowedMediaUrl(retried.imageUrl),
      reloadKey: retried.reloadKey,
    };
  }
}

function buildRangeTargets(
  ranges: ReaderRangeParsed[],
): Array<{ imagePageHref: string; imageIndex: number }> {
  return ranges.flatMap((range) =>
    range.thumbnails.map((thumbnail, offset) => {
      const imageIndex = range.imageNoFrom + offset + 1;
      return {
        imagePageHref: toImagePageHref(thumbnail, imageIndex),
        imageIndex,
      };
    }),
  );
}

async function resolveThumbnailRanges(
  comicId: string,
  firstRange: ReaderRangeParsed,
  settings: PluginSettings,
  requestConfig: RequestConfig,
): Promise<ReaderRangeParsed[]> {
  if (firstRange.pageCount <= 1) {
    return [firstRange];
  }

  const remainingThumbPages = Array.from(
    { length: Math.max(0, firstRange.pageCount - 1) },
    (_, index) => index + 2,
  );

  if (!remainingThumbPages.length) {
    return [firstRange];
  }

  const parsedRanges = await mapWithConcurrency(
    remainingThumbPages,
    async (thumbPage) => {
      const detailUrl = buildDetailEndpoint(comicId, settings.site, thumbPage - 1);
      const html = await getText(detailUrl, requestConfig);
      return parseThumbnailRangePage(html);
    },
    MAX_CONCURRENT_REQUESTS,
  );

  return [firstRange, ...parsedRanges];
}

async function resolveChapterDocsFromRanges(
  ranges: ReaderRangeParsed[],
  requestConfig: RequestConfig,
): Promise<ChapterDocInput[]> {
  const targets = buildRangeTargets(ranges);
  const skippedErrors: unknown[] = [];

  const settled = await mapWithConcurrency(targets, async (target) => {
    try {
      return await resolveChapterDoc(target.imagePageHref, target.imageIndex, requestConfig);
    } catch (error) {
      if (error instanceof PluginError && error.code === "UPSTREAM_BLOCKED") {
        throw error;
      }
      skippedErrors.push(error);
      return null;
    }
  });

  const uniqueByIndex = new Map<number, ChapterDocInput>();
  for (const item of settled) {
    if (!item?.imageUrl || uniqueByIndex.has(item.index)) {
      continue;
    }
    uniqueByIndex.set(item.index, item);
  }

  const valid = Array.from(uniqueByIndex.values()).sort((a, b) => a.index - b.index);
  if (!valid.length) {
    throw parseError("no readable page images in chapter", skippedErrors[0]);
  }
  return valid;
}

async function resolveChapterDocs(
  comicId: string,
  page: number,
  settings: PluginSettings,
  requestConfig: RequestConfig,
  mergeAllThumbnailPagesOnFirstPage = false,
): Promise<{ items: ChapterDocInput[]; pageCount: number; thumbnailPageCount: number; mergedAllThumbnailPages: boolean }> {
  const html = await getText(buildDetailEndpoint(comicId, settings.site, page - 1), requestConfig);
  const firstRange = parseThumbnailRangePage(html);
  const mergedAllThumbnailPages =
    mergeAllThumbnailPagesOnFirstPage && page === 1 && firstRange.pageCount > 1;

  const ranges = mergedAllThumbnailPages
    ? await resolveThumbnailRanges(comicId, firstRange, settings, requestConfig)
    : [firstRange];
  const valid = await resolveChapterDocsFromRanges(ranges, requestConfig);

  if (!valid.length) {
    throw parseError("no readable page images in chapter");
  }

  return {
    items: valid,
    // When merging all thumbnail pages into one payload, report one logical page
    // so callers do not keep requesting page=2 and downloading duplicates.
    pageCount: mergedAllThumbnailPages ? 1 : firstRange.pageCount,
    thumbnailPageCount: firstRange.pageCount,
    mergedAllThumbnailPages,
  };
}

export async function getChapterService(
  payload: ChapterPayload,
  settings: PluginSettings,
): Promise<ChapterContentContract> {
  const comicId = requiredString(payload.comicId, "comicId");
  const chapterId = String(payload.chapterId ?? comicId);
  const page = normalizePage(payload.page, 1);
  const requestConfig = buildRequestConfig(settings);

  const resolved = await resolveChapterDocs(comicId, page, settings, requestConfig, true);
  const mapped = mapChapterContent(comicId, chapterId, page, resolved.pageCount, resolved.items);
  if (resolved.mergedAllThumbnailPages) {
    mapped.extern = {
      ...mapped.extern,
      thumbnailPageCount: resolved.thumbnailPageCount,
      mergedAllThumbnailPages: true,
    };
  }
  return mapped;
}

export async function getReadPagesService(
  payload: ChapterPayload,
  settings: PluginSettings,
): Promise<ReadPagesCompatContract> {
  const comicId = requiredString(payload.comicId, "comicId");
  const page = normalizePage(payload.page, 1);
  const requestConfig = buildRequestConfig(settings);

  const resolved = await resolveChapterDocs(comicId, page, settings, requestConfig, false);
  return mapReadPagesCompat(page, resolved.pageCount, resolved.items);
}
