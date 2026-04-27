import { MAX_CONCURRENT_REQUESTS } from "../domain/constants";
import type {
  ChapterContentContract,
  ReadPagesCompatContract,
} from "../domain/contracts";
import type {
  ChapterPayload,
  PluginSettings,
  ReaderRangeParsed,
} from "../domain/types";
import { parseError, PluginError } from "../errors/plugin-error";
import {
  mapChapterContent,
  mapReadPagesCompat,
  type ChapterDocInput,
} from "../mappers/chapter.mapper";
import { httpClient, mapWithConcurrency } from "../network/client";
import {
  buildDetailEndpoint,
  buildImagePageEndpoint,
} from "../network/endpoints";
import {
  extractReloadKeyFromImagePage,
  isRetryableImagePageHtml,
  parseImagePage,
  parseThumbnailRangePage,
  toImagePageHref,
} from "../parsers/reader.parser";
import { cache } from "../tools";
import { normalizePage, requiredString } from "../utils/guards";
import { ensureAllowedHostUrl, ensureAllowedMediaUrl } from "../utils/url";
import {
  buildNonSearchSiteAttempts,
  buildRoutingExtern,
  readEhUnavailableExtern,
  type RequestConfig,
} from "./site-routing.service";

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

function unwrapBridgeValue(raw: unknown, depth = 0): unknown {
  if (depth > 8) {
    return raw;
  }

  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    const map = raw as Record<string, unknown>;
    if (map.ok === true && "value" in map) {
      return unwrapBridgeValue(map.value, depth + 1);
    }
    return raw;
  }

  if (typeof raw === "string") {
    const text = raw.trim();
    if (!text) {
      return "";
    }
    try {
      const parsed = JSON.parse(text);
      if (
        parsed &&
        typeof parsed === "object" &&
        !Array.isArray(parsed) &&
        (parsed as Record<string, unknown>).ok === true &&
        "value" in (parsed as Record<string, unknown>)
      ) {
        return unwrapBridgeValue(
          (parsed as Record<string, unknown>).value,
          depth + 1,
        );
      }
    } catch {
      // keep raw text as-is
    }
  }

  return raw;
}

function buildChapterDocCacheKey(
  comicId: string,
  page: number,
  site: PluginSettings["site"],
  mergeAllThumbnailPagesOnFirstPage: boolean,
): string {
  return [
    CHAPTER_DOC_CACHE_KEY_PREFIX,
    site,
    comicId,
    `page=${page}`,
    `mergeAll=${mergeAllThumbnailPagesOnFirstPage ? "1" : "0"}`,
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
  const reloadKey = map.reloadKey;
  if (!Number.isInteger(index) || index <= 0 || !href || !imageUrl) {
    return false;
  }
  if (
    reloadKey !== undefined &&
    reloadKey !== null &&
    typeof reloadKey !== "string"
  ) {
    return false;
  }
  return true;
}

function normalizeCachedChapterDocs(
  value: unknown,
): ResolvedChapterDocs | null {
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

function parseChapterDocCacheEnvelope(
  raw: unknown,
): ChapterDocCacheEnvelope | null {
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

async function readCachedChapterDocs(
  cacheKey: string,
): Promise<ResolvedChapterDocs | null> {
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

async function writeCachedChapterDocs(
  cacheKey: string,
  value: ResolvedChapterDocs,
): Promise<void> {
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

async function getText(
  url: string,
  requestConfig?: RequestConfig,
): Promise<string> {
  return requestConfig
    ? httpClient.getText(url, requestConfig)
    : httpClient.getText(url);
}

async function resolveChapterDoc(
  imagePageHref: string,
  imageIndex: number,
  requestConfig: RequestConfig,
): Promise<ChapterDocInput> {
  const safeImagePageHref = ensureAllowedHostUrl(imagePageHref);
  const imagePageHtml = await getText(
    buildImagePageEndpoint(safeImagePageHref),
    requestConfig,
  );

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
      const detailUrl = buildDetailEndpoint(comicId, site, thumbPage - 1);
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
      return await resolveChapterDoc(
        target.imagePageHref,
        target.imageIndex,
        requestConfig,
      );
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

  const valid = Array.from(uniqueByIndex.values()).sort(
    (a, b) => a.index - b.index,
  );
  if (!valid.length) {
    throw parseError("no readable page images in chapter", skippedErrors[0]);
  }
  return valid;
}

async function resolveChapterDocs(
  comicId: string,
  page: number,
  site: PluginSettings["site"],
  requestConfig: RequestConfig,
  mergeAllThumbnailPagesOnFirstPage = false,
): Promise<ResolvedChapterDocs> {
  const cacheKey = buildChapterDocCacheKey(
    comicId,
    page,
    site,
    mergeAllThumbnailPagesOnFirstPage,
  );
  const cached = await readCachedChapterDocs(cacheKey);
  if (cached) {
    return cached;
  }

  const html = await getText(
    buildDetailEndpoint(comicId, site, page - 1),
    requestConfig,
  );
  if (!html.trim()) {
    throw parseError("empty chapter html");
  }
  const firstRange = parseThumbnailRangePage(html);
  const mergedAllThumbnailPages =
    mergeAllThumbnailPagesOnFirstPage && page === 1 && firstRange.pageCount > 1;

  const ranges = mergedAllThumbnailPages
    ? await resolveThumbnailRanges(comicId, firstRange, site, requestConfig)
    : [firstRange];
  const valid = await resolveChapterDocsFromRanges(ranges, requestConfig);

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
        attempt.site,
        attempt.requestConfig,
        true,
      );
      const mapped = mapChapterContent(
        comicId,
        chapterId,
        page,
        resolved.pageCount,
        resolved.items,
      );
      if (resolved.mergedAllThumbnailPages) {
        mapped.extern = {
          ...mapped.extern,
          thumbnailPageCount: resolved.thumbnailPageCount,
          mergedAllThumbnailPages: true,
        };
      }
      const ehUnavailable =
        settings.site === "EX" &&
        (incomingEhUnavailable || attempt.site === "EX");
      const routingExtern = buildRoutingExtern(ehUnavailable);
      mapped.extern = {
        ...mapped.extern,
        ...routingExtern,
      };
      mapped.data.chapter.docs = mapped.data.chapter.docs.map((doc) => ({
        ...doc,
        extern: {
          ...(doc.extern ?? {}),
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

export async function getReadPagesService(
  payload: ChapterPayload,
  settings: PluginSettings,
): Promise<ReadPagesCompatContract> {
  const comicId = requiredString(payload.comicId, "comicId");
  const page = normalizePage(payload.page, 1);
  const incomingEhUnavailable = readEhUnavailableExtern(payload.extern);
  const attempts = buildNonSearchSiteAttempts(settings, payload.extern);
  let lastError: unknown;

  for (const attempt of attempts) {
    try {
      const resolved = await resolveChapterDocs(
        comicId,
        page,
        attempt.site,
        attempt.requestConfig,
        false,
      );
      const mapped = mapReadPagesCompat(
        page,
        resolved.pageCount,
        resolved.items,
      );
      const ehUnavailable =
        settings.site === "EX" &&
        (incomingEhUnavailable || attempt.site === "EX");
      const routingExtern = buildRoutingExtern(ehUnavailable);
      mapped.data.items = mapped.data.items.map((item) => ({
        ...item,
        extern: {
          ...item.extern,
          ...routingExtern,
        },
      }));
      return mapped;
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError ?? parseError("failed to resolve read pages");
}
