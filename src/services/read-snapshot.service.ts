import { MAX_CONCURRENT_REQUESTS, PLUGIN_SOURCE } from "../domain/constants";
import type { ReadSnapshotContract } from "../domain/contracts";
import type { ChapterPayload, PluginSettings, ReaderRangeParsed } from "../domain/types";
import { parseError } from "../errors/plugin-error";
import { httpClient, mapWithConcurrency } from "../network/client";
import { buildDetailEndpoint } from "../network/endpoints";
import { parseDetailPage } from "../parsers/detail.parser";
import { parseThumbnailRangePage, toImagePageHref } from "../parsers/reader.parser";
import { requiredString } from "../utils/guards";
import { buildDeferredImageUrl } from "../utils/deferred-image";
import { ensureAllowedHostUrl } from "../utils/url";
import { buildRequestConfig } from "./settings.service";

type RequestConfig = { headers: Record<string, string> } | undefined;

async function getText(url: string, requestConfig?: RequestConfig): Promise<string> {
  return requestConfig ? httpClient.getText(url, requestConfig) : httpClient.getText(url);
}

function readChapterOrder(extern: Record<string, unknown>): number {
  const rawOrder = Number(extern.order ?? 1);
  if (!Number.isFinite(rawOrder)) {
    return 1;
  }
  return Math.max(1, Math.trunc(rawOrder));
}

function appendRangeEntries(
  pageMap: Map<number, { id: string; name: string; path: string; url: string; extern: Record<string, unknown> }>,
  range: ReaderRangeParsed,
): void {
  for (let offset = 0; offset < range.thumbnails.length; offset += 1) {
    const thumbnail = range.thumbnails[offset];
    const imageIndex = range.imageNoFrom + offset + 1;
    const imagePageHref = ensureAllowedHostUrl(toImagePageHref(thumbnail, imageIndex));
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
  const requestConfig = buildRequestConfig(settings);

  const firstDetailUrl = buildDetailEndpoint(comicId, settings.site, 0);
  const firstHtml = await getText(firstDetailUrl, requestConfig);
  let title = comicId;
  try {
    const detail = parseDetailPage(firstHtml, comicId);
    title = detail.title || comicId;
  } catch {
    // Read snapshot should still work even if detail parse fails.
  }

  const firstRange = parseThumbnailRangePage(firstHtml);
  const pageMap = new Map<number, { id: string; name: string; path: string; url: string; extern: Record<string, unknown> }>();
  appendRangeEntries(pageMap, firstRange);

  const remainingThumbPages = Array.from(
    { length: Math.max(0, firstRange.pageCount - 1) },
    (_, index) => index + 2,
  );

  if (remainingThumbPages.length) {
    const parsedRanges = await mapWithConcurrency(
      remainingThumbPages,
      async (thumbPage) => {
        const detailUrl = buildDetailEndpoint(comicId, settings.site, thumbPage - 1);
        const html = await getText(detailUrl, requestConfig);
        return parseThumbnailRangePage(html);
      },
      MAX_CONCURRENT_REQUESTS,
    );

    for (const range of parsedRanges) {
      appendRangeEntries(pageMap, range);
    }
  }

  const pages = Array.from(pageMap.entries())
    .sort((a, b) => a[0] - b[0])
    .map(([, page]) => page);
  if (!pages.length) {
    throw parseError("no readable pages in read snapshot");
  }

  const chapterRef = {
    id: chapterId,
    name: "Gallery",
    order: chapterOrder,
    extern: {},
  };

  return {
    source: PLUGIN_SOURCE,
    extern,
    data: {
      comic: {
        id: comicId,
        source: PLUGIN_SOURCE,
        title,
        extern: {},
      },
      chapter: {
        ...chapterRef,
        pages,
      },
      chapters: [chapterRef],
    },
  };
}
