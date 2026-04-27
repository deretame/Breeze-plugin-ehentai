import { MAX_CONCURRENT_REQUESTS, PLUGIN_SOURCE } from "../domain/constants";
import type { ReadSnapshotContract } from "../domain/contracts";
import type {
  ChapterPayload,
  PluginSettings,
  ReaderRangeParsed,
} from "../domain/types";
import { parseError } from "../errors/plugin-error";
import { httpClient, mapWithConcurrency } from "../network/client";
import { buildDetailEndpoint } from "../network/endpoints";
import { parseDetailPage } from "../parsers/detail.parser";
import {
  parseThumbnailRangePage,
  toImagePageHref,
} from "../parsers/reader.parser";
import { cache } from "../tools";
import { buildDeferredImageUrl } from "../utils/deferred-image";
import { requiredString } from "../utils/guards";
import { ensureAllowedHostUrl } from "../utils/url";
import {
  buildNonSearchSiteAttempts,
  buildRoutingExtern,
  readEhUnavailableExtern,
  type RequestConfig,
} from "./site-routing.service";

const READ_SNAPSHOT_CACHE_TTL_MS = 30 * 60 * 1000;
const READ_SNAPSHOT_CACHE_KEY_PREFIX = "ehentai:read-snapshot:v1";

type SnapshotPage = {
  id: string;
  name: string;
  path: string;
  url: string;
  extern: Record<string, unknown>;
};

type ResolvedReadSnapshot = {
  title: string;
  pages: SnapshotPage[];
};

type ReadSnapshotCacheEnvelope = {
  version: 1;
  expiresAt: number;
  value: ResolvedReadSnapshot;
};

function buildReadSnapshotCacheKey(
  comicId: string,
  site: PluginSettings["site"],
): string {
  return [READ_SNAPSHOT_CACHE_KEY_PREFIX, site, comicId].join(":");
}

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

function parseReadSnapshotCacheEnvelope(
  raw: unknown,
): ReadSnapshotCacheEnvelope | null {
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

async function readCachedReadSnapshot(
  cacheKey: string,
): Promise<ResolvedReadSnapshot | null> {
  try {
    const raw = await cache.get(cacheKey, "");
    const decoded = unwrapBridgeValue(raw);
    const envelope = parseReadSnapshotCacheEnvelope(decoded);
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
  } catch {
    return null;
  }
}

async function writeCachedReadSnapshot(
  cacheKey: string,
  value: ResolvedReadSnapshot,
): Promise<void> {
  const envelope: ReadSnapshotCacheEnvelope = {
    version: 1,
    expiresAt: Date.now() + READ_SNAPSHOT_CACHE_TTL_MS,
    value,
  };
  try {
    await cache.set(cacheKey, JSON.stringify(envelope));
  } catch {
    // ignore cache set errors
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

function readChapterOrder(extern: Record<string, unknown>): number {
  const rawOrder = Number(extern.order ?? 1);
  if (!Number.isFinite(rawOrder)) {
    return 1;
  }
  return Math.max(1, Math.trunc(rawOrder));
}

function appendRangeEntries(
  pageMap: Map<
    number,
    {
      id: string;
      name: string;
      path: string;
      url: string;
      extern: Record<string, unknown>;
    }
  >,
  range: ReaderRangeParsed,
  routingExtern: Record<string, unknown>,
): void {
  for (let offset = 0; offset < range.thumbnails.length; offset += 1) {
    const thumbnail = range.thumbnails[offset];
    const imageIndex = range.imageNoFrom + offset + 1;
    const imagePageHref = ensureAllowedHostUrl(
      toImagePageHref(thumbnail, imageIndex),
    );
    // In deferred mode we don't know the final image extension yet.
    // Use a neutral suffix to avoid pretending it's jpg/webp.
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

export async function getReadSnapshotService(
  payload: ChapterPayload,
  settings: PluginSettings,
): Promise<ReadSnapshotContract> {
  const comicId = requiredString(payload.comicId, "comicId");
  const chapterId = String(payload.chapterId ?? comicId);
  const extern = payload.extern ?? {};
  const chapterOrder = readChapterOrder(extern);
  const incomingEhUnavailable = readEhUnavailableExtern(payload.extern);
  const attempts = buildNonSearchSiteAttempts(settings, payload.extern);
  let title = comicId;
  let pages: Array<{
    id: string;
    name: string;
    path: string;
    url: string;
    extern: Record<string, unknown>;
  }> = [];
  let lastError: unknown;
  let resolvedEhUnavailable = incomingEhUnavailable;

  for (const attempt of attempts) {
    try {
      const ehUnavailable =
        settings.site === "EX" &&
        (incomingEhUnavailable || attempt.site === "EX");
      const routingExtern = buildRoutingExtern(ehUnavailable);
      const cacheKey = buildReadSnapshotCacheKey(comicId, attempt.site);
      const cached = await readCachedReadSnapshot(cacheKey);
      if (cached) {
        title = cached.title;
        pages = cached.pages;
        resolvedEhUnavailable = ehUnavailable;
        console.log("[EH] read snapshot cache hit", cacheKey);
        break;
      }
      const firstDetailUrl = buildDetailEndpoint(comicId, attempt.site, 0);
      const firstHtml = await getText(firstDetailUrl, attempt.requestConfig);
      if (!firstHtml.trim()) {
        continue;
      }

      try {
        const detail = parseDetailPage(firstHtml, comicId);
        title = detail.title || comicId;
      } catch {
        // Read snapshot should still work even if detail parse fails.
      }

      const firstRange = parseThumbnailRangePage(firstHtml);
      const pageMap = new Map<
        number,
        {
          id: string;
          name: string;
          path: string;
          url: string;
          extern: Record<string, unknown>;
        }
      >();
      appendRangeEntries(pageMap, firstRange, routingExtern);

      const remainingThumbPages = Array.from(
        { length: Math.max(0, firstRange.pageCount - 1) },
        (_, index) => index + 2,
      );

      if (remainingThumbPages.length) {
        const parsedRanges = await mapWithConcurrency(
          remainingThumbPages,
          async (thumbPage) => {
            const detailUrl = buildDetailEndpoint(
              comicId,
              attempt.site,
              thumbPage - 1,
            );
            const html = await getText(detailUrl, attempt.requestConfig);
            return parseThumbnailRangePage(html);
          },
          MAX_CONCURRENT_REQUESTS,
        );

        for (const range of parsedRanges) {
          appendRangeEntries(pageMap, range, routingExtern);
        }
      }

      pages = Array.from(pageMap.entries())
        .sort((a, b) => a[0] - b[0])
        .map(([, page]) => page);
      if (pages.length) {
        await writeCachedReadSnapshot(cacheKey, { title, pages });
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
    throw parseError("no readable pages in read snapshot");
  }

  const chapterRef = {
    id: chapterId,
    name: "Gallery",
    order: chapterOrder,
    extern: buildRoutingExtern(resolvedEhUnavailable),
  };
  const routingExtern = buildRoutingExtern(resolvedEhUnavailable);

  return {
    source: PLUGIN_SOURCE,
    extern: {
      ...extern,
      ...routingExtern,
    },
    data: {
      comic: {
        id: comicId,
        source: PLUGIN_SOURCE,
        title,
        extern: routingExtern,
      },
      chapter: {
        ...chapterRef,
        pages,
        extern: chapterRef.extern,
      },
      chapters: [chapterRef],
    },
  };
}
