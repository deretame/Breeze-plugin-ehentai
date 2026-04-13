import type { ChapterContentContract, ReadPagesCompatContract } from "../domain/contracts";
import type { ChapterPayload, PluginSettings } from "../domain/types";
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

async function resolveChapterDoc(
  imagePageHref: string,
  imageIndex: number,
): Promise<ChapterDocInput> {
  const safeImagePageHref = ensureAllowedHostUrl(imagePageHref);
  const imagePageHtml = await httpClient.getText(buildImagePageEndpoint(safeImagePageHref));

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

    const retriedHtml = await httpClient.getText(buildImagePageEndpoint(safeImagePageHref, reloadKey));
    const retried = parseImagePage(safeImagePageHref, retriedHtml);

    return {
      index: imageIndex,
      href: safeImagePageHref,
      imageUrl: ensureAllowedMediaUrl(retried.imageUrl),
      reloadKey: retried.reloadKey,
    };
  }
}

async function resolveChapterDocs(
  comicId: string,
  page: number,
  settings: PluginSettings,
): Promise<{ items: ChapterDocInput[]; pageCount: number }> {
  const html = await httpClient.getText(buildDetailEndpoint(comicId, settings.site, page - 1));
  const range = parseThumbnailRangePage(html);
  const skippedErrors: unknown[] = [];

  const settled = await mapWithConcurrency(range.thumbnails, async (thumbnail, offset) => {
    const imageIndex = range.imageNoFrom + offset + 1;

    try {
      return await resolveChapterDoc(toImagePageHref(thumbnail, imageIndex), imageIndex);
    } catch (error) {
      if (error instanceof PluginError && error.code === "UPSTREAM_BLOCKED") {
        throw error;
      }
      skippedErrors.push(error);
      return null;
    }
  });

  const valid = settled.filter((item): item is ChapterDocInput => Boolean(item?.imageUrl));
  if (!valid.length) {
    throw parseError("no readable page images in chapter", skippedErrors[0]);
  }

  return {
    items: valid,
    pageCount: range.pageCount,
  };
}

export async function getChapterService(
  payload: ChapterPayload,
  settings: PluginSettings,
): Promise<ChapterContentContract> {
  const comicId = requiredString(payload.comicId, "comicId");
  const chapterId = String(payload.chapterId ?? comicId);
  const page = normalizePage(payload.page, 1);

  const resolved = await resolveChapterDocs(comicId, page, settings);
  return mapChapterContent(comicId, chapterId, page, resolved.pageCount, resolved.items);
}

export async function getReadPagesService(
  payload: ChapterPayload,
  settings: PluginSettings,
): Promise<ReadPagesCompatContract> {
  const comicId = requiredString(payload.comicId, "comicId");
  const page = normalizePage(payload.page, 1);

  const resolved = await resolveChapterDocs(comicId, page, settings);
  return mapReadPagesCompat(page, resolved.pageCount, resolved.items);
}
