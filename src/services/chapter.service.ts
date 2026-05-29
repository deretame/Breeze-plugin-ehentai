import type { ChapterContentContract } from "../domain/contracts";
import type { ChapterPayload, PluginSettings, ReaderRangeParsed } from "../domain/types";
import { parseError } from "../errors/plugin-error";
import { mapChapterContent } from "../mappers/chapter.mapper";
import { httpClient } from "../network/client";
import { buildDetailEndpoint } from "../network/endpoints";
import { parseDetailPage } from "../parsers/detail.parser";
import { parseThumbnailRangePage, toImagePageHref } from "../parsers/reader.parser";
import { cache } from "../tools";
import { unwrapBridgeValue } from "../utils/bridge-cache";
import { buildDeferredImageUrl } from "../utils/deferred-image";
import { requiredString } from "../utils/guards";
import { ensureAllowedHostUrl } from "../utils/url";
import {
  buildGalleryChunkId,
  buildGalleryChunkExtern,
  getGalleryChunkSize,
  resolveGalleryChunkFromExtern,
  type GalleryChunk,
} from "../utils/chunk";
import { resolveThumbnailRangesForChunk } from "./gallery-range.service";
import {
  buildNonSearchSiteAttempts,
  buildRoutingExtern,
  readEhUnavailableExtern,
  type RequestConfig,
} from "./site-routing.service";

const CHAPTER_CACHE_TTL_MS = 30 * 60 * 1000;
const CHAPTER_CACHE_KEY_PREFIX = "ehentai:chapter:v2";

type SnapshotPage = {
  id: string;
  name: string;
  path: string;
  url: string;
  extern: Record<string, unknown>;
};

type ResolvedChapterSnapshot = {
  title: string;
  pages: SnapshotPage[];
};

type ChapterCacheEnvelope = {
  version: 1;
  expiresAt: number;
  value: ResolvedChapterSnapshot;
};

function buildChapterCacheKey(
  comicId: string,
  site: PluginSettings["site"],
  chunk: GalleryChunk,
): string {
  return [CHAPTER_CACHE_KEY_PREFIX, site, comicId, `chunk=${chunk.start}-${chunk.end}`].join(":");
}

function normalizeSnapshotPage(value: unknown): SnapshotPage | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const map = value as Record<string, unknown>;
  const id = String(map.id ?? "").trim();
  const name = String(map.name ?? "").trim();
  const path = String(map.path ?? "").trim();
  const url = String(map.url ?? "").trim();
  const extern =
    map.extern && typeof map.extern === "object" && !Array.isArray(map.extern)
      ? (map.extern as Record<string, unknown>)
      : {};
  if (!id || !name || !path || !url) {
    return null;
  }
  return { id, name, path, url, extern };
}

function parseChapterCacheEnvelope(raw: unknown): ChapterCacheEnvelope | null {
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

  if (!data || typeof data !== "object" || Array.isArray(data)) {
    return null;
  }

  const map = data as Record<string, unknown>;
  const version = Number(map.version);
  const expiresAt = Number(map.expiresAt);
  const value = map.value as Record<string, unknown> | undefined;
  const title = String(value?.title ?? "").trim();
  const pagesRaw = Array.isArray(value?.pages) ? value.pages : [];
  const pages = pagesRaw
    .map((page) => normalizeSnapshotPage(page))
    .filter((page): page is SnapshotPage => Boolean(page));
  if (version !== 1 || !Number.isFinite(expiresAt) || !title || !pages.length) {
    return null;
  }

  return {
    version: 1,
    expiresAt,
    value: {
      title,
      pages,
    },
  };
}

async function readCachedChapterSnapshot(
  cacheKey: string,
): Promise<ResolvedChapterSnapshot | null> {
  try {
    const raw = await cache.get(cacheKey, "");
    const decoded = unwrapBridgeValue(raw);
    const envelope = parseChapterCacheEnvelope(decoded);
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

async function writeCachedChapterSnapshot(
  cacheKey: string,
  value: ResolvedChapterSnapshot,
): Promise<void> {
  const envelope: ChapterCacheEnvelope = {
    version: 1,
    expiresAt: Date.now() + CHAPTER_CACHE_TTL_MS,
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

function appendRangeEntries(
  pageMap: Map<number, SnapshotPage>,
  range: ReaderRangeParsed,
  routingExtern: Record<string, unknown>,
  chunk: GalleryChunk,
): void {
  for (let offset = 0; offset < range.thumbnails.length; offset += 1) {
    const thumbnail = range.thumbnails[offset];
    const imageIndex = range.imageNoFrom + offset + 1;
    if (imageIndex < chunk.start || imageIndex > chunk.end) {
      continue;
    }
    const imagePageHref = ensureAllowedHostUrl(toImagePageHref(thumbnail, imageIndex));
    const deferredFileName = `${imageIndex}.img`;
    pageMap.set(imageIndex, {
      id: String(imageIndex),
      name: deferredFileName,
      path: deferredFileName,
      url: buildDeferredImageUrl(imagePageHref),
      extern: {
        href: imagePageHref,
        ...routingExtern,
      },
    });
  }
}

function readChapterOrder(extern: Record<string, unknown>, chunk: GalleryChunk): number {
  const rawOrder = Number(extern.order ?? chunk.index);
  if (!Number.isFinite(rawOrder)) {
    return chunk.index;
  }
  return Math.max(1, Math.trunc(rawOrder));
}

export async function getChapterService(
  payload: ChapterPayload,
  settings: PluginSettings,
): Promise<ChapterContentContract> {
  const comicId = requiredString(payload.comicId, "comicId");
  const extern = payload.extern ?? {};
  const incomingEhUnavailable = readEhUnavailableExtern(payload.extern);
  const attempts = buildNonSearchSiteAttempts(settings, payload.extern);
  const chunkSize = getGalleryChunkSize();
  let title = comicId;
  let pages: SnapshotPage[] = [];
  let resolvedChunk: GalleryChunk = {
    index: 1,
    start: 1,
    end: chunkSize,
  };
  let resolvedTotalPageCount = chunkSize;
  let lastError: unknown;
  let resolvedEhUnavailable = incomingEhUnavailable;

  for (const attempt of attempts) {
    try {
      const ehUnavailable =
        settings.site === "EX" && (incomingEhUnavailable || attempt.site === "EX");
      const routingExtern = buildRoutingExtern(ehUnavailable);
      const requestedChunk = resolveGalleryChunkFromExtern(extern, undefined, chunkSize);
      const earlyCacheKey = buildChapterCacheKey(comicId, attempt.site, requestedChunk);
      const earlyCached = await readCachedChapterSnapshot(earlyCacheKey);
      if (earlyCached) {
        title = earlyCached.title;
        pages = earlyCached.pages;
        resolvedChunk = requestedChunk;
        resolvedEhUnavailable = ehUnavailable;
        break;
      }

      const firstDetailUrl = buildDetailEndpoint(comicId, attempt.site, 0);
      const firstHtml = await getText(firstDetailUrl, attempt.requestConfig);
      if (!firstHtml.trim()) {
        continue;
      }

      let parsedDetailPageCount: number | undefined;
      try {
        const detail = parseDetailPage(firstHtml, comicId);
        title = detail.title || comicId;
        parsedDetailPageCount = detail.pageCount;
      } catch {
        // chapter view should still work even if detail parse fails.
      }

      const firstRange = parseThumbnailRangePage(firstHtml);
      resolvedTotalPageCount = parsedDetailPageCount ?? firstRange.imageCount;
      resolvedChunk = resolveGalleryChunkFromExtern(extern, resolvedTotalPageCount, chunkSize);
      const pageMap = new Map<number, SnapshotPage>();
      const chunkExtern = buildGalleryChunkExtern(resolvedChunk, resolvedTotalPageCount, chunkSize);
      const cacheKey = buildChapterCacheKey(comicId, attempt.site, resolvedChunk);
      const cached = await readCachedChapterSnapshot(cacheKey);
      if (cached) {
        title = cached.title;
        pages = cached.pages;
        resolvedEhUnavailable = ehUnavailable;
        break;
      }

      const parsedRanges = await resolveThumbnailRangesForChunk(
        comicId,
        attempt.site,
        firstRange,
        resolvedChunk,
        (url) => getText(url, attempt.requestConfig),
      );
      for (const range of parsedRanges) {
        appendRangeEntries(pageMap, range, { ...routingExtern, ...chunkExtern }, resolvedChunk);
      }

      pages = Array.from(pageMap.entries())
        .sort((a, b) => a[0] - b[0])
        .map(([, page]) => page);
      if (pages.length) {
        const cacheValue = { title, pages };
        await writeCachedChapterSnapshot(cacheKey, cacheValue);
        if (cacheKey !== earlyCacheKey) {
          await writeCachedChapterSnapshot(earlyCacheKey, cacheValue);
        }
        resolvedEhUnavailable = ehUnavailable;
        break;
      }
    } catch (error) {
      lastError = error;
    }
  }

  if (!pages.length) {
    if (lastError) {
      throw lastError;
    }
    throw parseError("no readable pages in chapter");
  }

  const routingExtern = buildRoutingExtern(resolvedEhUnavailable);
  const chapterId = String(payload.chapterId ?? "").trim() || buildGalleryChunkId(resolvedChunk);
  const chapterOrder = readChapterOrder(extern, resolvedChunk);
  return mapChapterContent(
    comicId,
    title,
    resolvedChunk,
    resolvedTotalPageCount,
    pages,
    chapterId,
    chapterOrder,
    routingExtern,
  );
}
