import type { ChapterContentContract } from "../domain/contracts";
import type { ChapterPayload, PluginSettings, ReaderRangeParsed } from "../domain/types";
import { parseError, PluginError } from "../errors/plugin-error";
import {
  mapChapterContent,
  type ChapterDocInput,
} from "../mappers/chapter.mapper";
import { httpClient, mapWithConcurrency } from "../network/client";
import { buildDetailEndpoint, buildImagePageEndpoint } from "../network/endpoints";
import {
  extractReloadKeyFromImagePage,
  isRetryableImagePageHtml,
  parseImagePage,
  parseThumbnailRangePage,
  toImagePageHref,
} from "../parsers/reader.parser";
import { cache } from "../tools";
import { unwrapBridgeValue } from "../utils/bridge-cache";
import { normalizePage, requiredString } from "../utils/guards";
import { ensureAllowedHostUrl, ensureAllowedMediaUrl } from "../utils/url";
import {
  buildNonSearchSiteAttempts,
  buildRoutingExtern,
  readEhUnavailableExtern,
  type RequestConfig,
} from "./site-routing.service";
import { buildDeferredImageUrl } from "../utils/deferred-image";
import {
  getGalleryChunkSize,
  resolveGalleryChunkFromExtern,
  type GalleryChunk,
} from "../utils/chunk";
import { resolveThumbnailRangesForChunk } from "./gallery-range.service";

const CHAPTER_DOC_CACHE_TTL_MS = 30 * 60 * 1000;
const CHAPTER_DOC_CACHE_KEY_PREFIX = "ehentai:chapter-docs:v1";

type ResolvedChapterDocs = {
  items: ChapterDocInput[];
  pageCount: number;
  thumbnailPageCount: number;
  mergedAllThumbnailPages: boolean;
};

type ChapterDocCacheEnvelope = {
  version: 1;
  expiresAt: number;
  value: ResolvedChapterDocs;
};

function buildChapterDocCacheKey(
  comicId: string,
  page: number,
  site: PluginSettings["site"],
  mergeAllThumbnailPagesOnFirstPage: boolean,
  chunk: GalleryChunk,
): string {
  return [
    CHAPTER_DOC_CACHE_KEY_PREFIX,
    site,
    comicId,
    `page=${page}`,
    `mergeAll=${mergeAllThumbnailPagesOnFirstPage ? "1" : "0"}`,
    `chunk=${chunk.start}-${chunk.end}`,
  ].join(":");
}

function isValidChapterDocInput(value: unknown): value is ChapterDocInput {
  if (!value || typeof value !== "object") {
    return false;
  }
  const map = value as Record<string, unknown>;
  const index = Number(map.index);
  const href = String(map.href ?? "").trim();
  const imageUrl = String(map.imageUrl ?? "").trim();
  const fileName = map.fileName;
  const reloadKey = map.reloadKey;
  if (!Number.isInteger(index) || index <= 0 || !href || !imageUrl) {
    return false;
  }
  if (fileName !== undefined && fileName !== null && typeof fileName !== "string") {
    return false;
  }
  if (reloadKey !== undefined && reloadKey !== null && typeof reloadKey !== "string") {
    return false;
  }
  return true;
}

function normalizeCachedChapterDocs(value: unknown): ResolvedChapterDocs | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const map = value as Record<string, unknown>;
  const itemsRaw = Array.isArray(map.items) ? map.items : [];
  const items = itemsRaw.filter(isValidChapterDocInput);
  const pageCount = Number(map.pageCount);
  const thumbnailPageCount = Number(map.thumbnailPageCount);
  const mergedAllThumbnailPages = Boolean(map.mergedAllThumbnailPages);

  if (!items.length || !Number.isInteger(pageCount) || pageCount <= 0) {
    return null;
  }
  if (!Number.isInteger(thumbnailPageCount) || thumbnailPageCount <= 0) {
    return null;
  }

  return {
    items,
    pageCount,
    thumbnailPageCount,
    mergedAllThumbnailPages,
  };
}

function parseChapterDocCacheEnvelope(raw: unknown): ChapterDocCacheEnvelope | null {
  let data: unknown = raw;
  if (typeof data === "string") {
    const text = data.trim();
    if (!text) {
      return null;
    }
    try {
      data = JSON.parse(text);
    } catch {
      return null;
    }
  }

  if (!data || typeof data !== "object") {
    return null;
  }
  const map = data as Record<string, unknown>;
  const version = Number(map.version);
  const expiresAt = Number(map.expiresAt);
  const value = normalizeCachedChapterDocs(map.value);
  if (version !== 1 || !Number.isFinite(expiresAt) || !value) {
    return null;
  }
  return {
    version: 1,
    expiresAt,
    value,
  };
}

async function readCachedChapterDocs(cacheKey: string): Promise<ResolvedChapterDocs | null> {
  try {
    const raw = await cache.get(cacheKey, "");
    const decoded = unwrapBridgeValue(raw);
    const envelope = parseChapterDocCacheEnvelope(decoded);
    if (!envelope) {
      return null;
    }
    if (Date.now() >= envelope.expiresAt) {
      try {
        await cache.delete(cacheKey);
      } catch {
        // ignore cache delete errors
      }
      return null;
    }
    return envelope.value;
  } catch (error) {
    console.warn("[EH] chapter cache get failed", cacheKey, error);
    return null;
  }
}

async function writeCachedChapterDocs(cacheKey: string, value: ResolvedChapterDocs): Promise<void> {
  const envelope: ChapterDocCacheEnvelope = {
    version: 1,
    expiresAt: Date.now() + CHAPTER_DOC_CACHE_TTL_MS,
    value,
  };
  try {
    const saved = await cache.set(cacheKey, JSON.stringify(envelope));
    if (saved !== true) {
      console.warn("[EH] chapter cache set returned non-true", cacheKey, saved);
    }
  } catch (error) {
    console.warn("[EH] chapter cache set failed", cacheKey, error);
  }
}

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

    const retriedHtml = await getText(
      buildImagePageEndpoint(safeImagePageHref, reloadKey),
      requestConfig,
    );
    const retried = parseImagePage(safeImagePageHref, retriedHtml);

    return {
      index: imageIndex,
      href: safeImagePageHref,
      imageUrl: ensureAllowedMediaUrl(retried.imageUrl),
      reloadKey: retried.reloadKey,
    };
  }
}

function toDeferredChapterDocInput(item: ChapterDocInput): ChapterDocInput {
  const deferredFileName = `${item.index}.img`;
  return {
    index: item.index,
    href: item.href,
    imageUrl: buildDeferredImageUrl(item.href),
    reloadKey: item.reloadKey,
    fileName: deferredFileName,
  };
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
  site: PluginSettings["site"],
  requestConfig: RequestConfig,
  chunk: GalleryChunk,
): Promise<ReaderRangeParsed[]> {
  return resolveThumbnailRangesForChunk(comicId, site, firstRange, chunk, (url) =>
    getText(url, requestConfig),
  );
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
  extern: Record<string, unknown> | undefined,
  site: PluginSettings["site"],
  requestConfig: RequestConfig,
  mergeAllThumbnailPagesOnFirstPage = false,
): Promise<ResolvedChapterDocs> {
  const chunkSize = getGalleryChunkSize();
  const requestedChunk = resolveGalleryChunkFromExtern(extern ?? {}, undefined, chunkSize);
  const cacheKey = buildChapterDocCacheKey(
    comicId,
    page,
    site,
    mergeAllThumbnailPagesOnFirstPage,
    requestedChunk,
  );
  const cached = await readCachedChapterDocs(cacheKey);
  if (cached) {
    return cached;
  }

  const html = await getText(buildDetailEndpoint(comicId, site, page - 1), requestConfig);
  if (!html.trim()) {
    throw parseError("empty chapter html");
  }
  const firstRange = parseThumbnailRangePage(html);
  const resolvedChunk = resolveGalleryChunkFromExtern(
    extern ?? {},
    firstRange.imageCount,
    chunkSize,
  );
  const mergedAllThumbnailPages =
    mergeAllThumbnailPagesOnFirstPage && page === 1 && firstRange.pageCount > 1;

  const ranges = mergedAllThumbnailPages
    ? await resolveThumbnailRanges(comicId, firstRange, site, requestConfig, resolvedChunk)
    : [firstRange];
  const valid = (await resolveChapterDocsFromRanges(ranges, requestConfig)).filter(
    (item) => item.index >= resolvedChunk.start && item.index <= resolvedChunk.end,
  );

  if (!valid.length) {
    throw parseError("no readable page images in chapter");
  }

  const resolved: ResolvedChapterDocs = {
    items: valid,
    // When merging all thumbnail pages into one payload, report one logical page
    // so callers do not keep requesting page=2 and downloading duplicates.
    pageCount: mergedAllThumbnailPages ? 1 : firstRange.pageCount,
    thumbnailPageCount: firstRange.pageCount,
    mergedAllThumbnailPages,
  };
  await writeCachedChapterDocs(cacheKey, resolved);
  return resolved;
}

export async function getChapterService(
  payload: ChapterPayload,
  settings: PluginSettings,
): Promise<ChapterContentContract> {
  const comicId = requiredString(payload.comicId, "comicId");
  const chapterId = String(payload.chapterId ?? comicId);
  const page = normalizePage(payload.page, 1);
  const incomingEhUnavailable = readEhUnavailableExtern(payload.extern);
  const attempts = buildNonSearchSiteAttempts(settings, payload.extern);
  let lastError: unknown;

  for (const attempt of attempts) {
    try {
      const resolved = await resolveChapterDocs(
        comicId,
        page,
        payload.extern,
        attempt.site,
        attempt.requestConfig,
        true,
      );
      const mapped = mapChapterContent(
        comicId,
        chapterId,
        page,
        resolved.pageCount,
        resolved.items.map(toDeferredChapterDocInput),
      );
      if (resolved.mergedAllThumbnailPages) {
        mapped.extern = {
          ...mapped.extern,
          thumbnailPageCount: resolved.thumbnailPageCount,
          mergedAllThumbnailPages: true,
        };
      }
      const ehUnavailable =
        settings.site === "EX" && (incomingEhUnavailable || attempt.site === "EX");
      const routingExtern = buildRoutingExtern(ehUnavailable);
      mapped.extern = {
        ...mapped.extern,
        ...routingExtern,
      };
      mapped.data.chapter.docs = mapped.data.chapter.docs.map((doc) => ({
        ...doc,
        extern: {
          ...doc.extern,
          ...routingExtern,
        },
      }));
      return mapped;
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError ?? parseError("failed to resolve chapter pages");
}

