import { MAX_CONCURRENT_REQUESTS } from "../domain/constants";
import type { ReaderRangeParsed, SiteSetting } from "../domain/types";
import { mapWithConcurrency } from "../network/client";
import { buildDetailEndpoint } from "../network/endpoints";
import { parseThumbnailRangePage } from "../parsers/reader.parser";
import type { GalleryChunk } from "../utils/chunk";

export function buildThumbnailPagesForChunk(
  firstRange: ReaderRangeParsed,
  chunk: GalleryChunk,
): number[] {
  const thumbnailsPerPage = Math.max(1, firstRange.thumbnails.length);
  const firstThumbPage = Math.floor((chunk.start - 1) / thumbnailsPerPage) + 1;
  const lastThumbPage = Math.floor((chunk.end - 1) / thumbnailsPerPage) + 1;
  const clampedFirst = Math.max(1, Math.min(firstRange.pageCount, firstThumbPage));
  const clampedLast = Math.max(clampedFirst, Math.min(firstRange.pageCount, lastThumbPage));

  return Array.from({ length: clampedLast - clampedFirst + 1 }, (_, index) => clampedFirst + index);
}

export async function resolveThumbnailRangesForChunk(
  comicId: string,
  site: SiteSetting,
  firstRange: ReaderRangeParsed,
  chunk: GalleryChunk,
  getText: (url: string) => Promise<string>,
): Promise<ReaderRangeParsed[]> {
  const requiredThumbPages = buildThumbnailPagesForChunk(firstRange, chunk);
  const ranges: ReaderRangeParsed[] = [];

  if (requiredThumbPages.includes(1)) {
    ranges.push(firstRange);
  }

  const remainingThumbPages = requiredThumbPages.filter((thumbPage) => thumbPage > 1);
  if (!remainingThumbPages.length) {
    return ranges.length ? ranges : [firstRange];
  }

  const parsedRanges = await mapWithConcurrency(
    remainingThumbPages,
    async (thumbPage) => {
      const detailUrl = buildDetailEndpoint(comicId, site, thumbPage - 1);
      const html = await getText(detailUrl);
      return parseThumbnailRangePage(html);
    },
    MAX_CONCURRENT_REQUESTS,
  );

  return [...ranges, ...parsedRanges];
}
