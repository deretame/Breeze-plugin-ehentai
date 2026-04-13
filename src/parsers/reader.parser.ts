import * as cheerio from "cheerio";
import type { ReaderImageParsed, ReaderRangeParsed, ReaderThumbnail } from "../domain/types";
import { parseError, upstreamBlockedError } from "../errors/plugin-error";
import { toInt } from "../utils/number";

const RANGE_REGEX = /Showing\s+(\d+)\s*-\s*(\d+)\s+of\s+([\d,]+)\s+images/i;
const RELOAD_KEY_REGEX = /return\s+nl\('([^']+)'\)/;
const MPV_HREF_REGEX = /(https?:\/\/(?:e-hentai|exhentai)\.org)\/mpv\/(\d+)\/[^/?#]+/i;
const EH_509_IMAGE_PATH = "/g/509.gif";
const EX_509_IMAGE_PATH = "/img/509.gif";

const LIMIT_MARKERS = [
  "you have reached the image limit",
  "you have exceeded your image",
];

const RETRYABLE_MARKERS = [
  "invalid token",
  "invalid request",
  "an error has occurred",
  "page load has been aborted due to a fatal error",
];

export function extractReloadKeyFromImagePage(html: string): string | undefined {
  const $ = cheerio.load(html);
  const loadFailOnClick = String($("#loadfail").attr("onclick") ?? "");
  return RELOAD_KEY_REGEX.exec(loadFailOnClick)?.[1];
}

export function isRetryableImagePageHtml(html: string): boolean {
  const lowered = html.toLowerCase();
  return RETRYABLE_MARKERS.some((marker) => lowered.includes(marker));
}

export function toImagePageHref(thumbnail: ReaderThumbnail, pageNo: number): string {
  const href = String(thumbnail.href ?? "").trim();
  if (!href.includes("/mpv/")) {
    return href;
  }

  const orghash = String(thumbnail.originImageHash ?? "").trim();
  if (orghash.length < 10) {
    return href;
  }

  const match = MPV_HREF_REGEX.exec(href);
  if (!match) {
    return href;
  }

  const hostPrefix = match[1];
  const gid = match[2];
  return `${hostPrefix}/s/${orghash.slice(0, 10)}/${gid}-${Math.max(1, pageNo)}`;
}

export function parseThumbnailRangePage(html: string): ReaderRangeParsed {
  const $ = cheerio.load(html);
  const description = $(".gtb .gpc").first().text().replace(/,/g, "");
  const rangeMatch = RANGE_REGEX.exec(description);
  if (!rangeMatch) {
    throw parseError("failed to parse thumbnail range");
  }

  const thumbnails: ReaderThumbnail[] = $("#gdt a[href]")
    .map((index, node) => ({
      index,
      href: String($(node).attr("href") ?? ""),
      originImageHash: String($(node).find("div[data-orghash]").first().attr("data-orghash") ?? "").trim() || undefined,
    }))
    .get()
    .filter((item) => item.href.includes("/s/") || item.href.includes("/mpv/"));

  if (!thumbnails.length) {
    throw parseError("failed to parse thumbnail links");
  }

  const currentPageNo = toInt($(".ptds a").first().text(), 1);
  const pageCount = toInt($(".ptt tbody tr td").eq(-2).text(), currentPageNo);

  return {
    imageNoFrom: toInt(rangeMatch[1], 1) - 1,
    imageNoTo: toInt(rangeMatch[2], 1) - 1,
    imageCount: toInt(rangeMatch[3], thumbnails.length),
    currentPageNo,
    pageCount,
    thumbnails,
  };
}

export function parseImagePage(href: string, html: string): ReaderImageParsed {
  const lowered = html.toLowerCase();
  if (LIMIT_MARKERS.some((marker) => lowered.includes(marker))) {
    throw upstreamBlockedError("image quota exceeded");
  }

  const $ = cheerio.load(html);
  const imageUrl = String($("#img").attr("src") ?? "").trim();
  const reloadKey = extractReloadKeyFromImagePage(html);

  if (!imageUrl) {
    if (isRetryableImagePageHtml(html)) {
      throw parseError("image page returned retryable error");
    }
    throw parseError("failed to parse final image url");
  }

  const normalizedImageUrl = imageUrl.toLowerCase();
  if (normalizedImageUrl.includes(EH_509_IMAGE_PATH) || normalizedImageUrl.includes(EX_509_IMAGE_PATH)) {
    throw upstreamBlockedError("image quota exceeded");
  }

  return {
    href,
    imageUrl,
    reloadKey,
  };
}
