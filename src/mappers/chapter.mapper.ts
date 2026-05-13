import { PLUGIN_SOURCE } from "../domain/constants";
import type { ChapterContentContract } from "../domain/contracts";
import type { GalleryChunk } from "../utils/chunk";
import {
  buildGalleryChunkExtern,
  buildGalleryChunkId,
  buildGalleryChunks,
  formatGalleryChunkName,
  getGalleryChunkSize,
} from "../utils/chunk";

type SnapshotPageInput = {
  id: string;
  name: string;
  path: string;
  url: string;
  extern: Record<string, unknown>;
};

export function mapChapterContent(
  comicId: string,
  title: string,
  chunk: GalleryChunk,
  totalPageCount: number,
  pages: SnapshotPageInput[],
  chapterId: string,
  chapterOrder: number,
  routingExtern: Record<string, unknown>,
): ChapterContentContract {
  const chunkSize = getGalleryChunkSize();
  const chapterExtern = {
    ...buildGalleryChunkExtern(chunk, totalPageCount, chunkSize),
    ...routingExtern,
  };

  const chapters = buildGalleryChunks(totalPageCount, chunkSize).map((entry) => {
    const chunkId = buildGalleryChunkId(entry);
    return {
      id: chunkId,
      name: formatGalleryChunkName(entry, totalPageCount),
      order: entry.index,
      requestId: chunkId,
      storageChapterId: "Gallery",
      logicalKey: chunkId,
      extern: {
        ...buildGalleryChunkExtern(entry, totalPageCount, chunkSize),
        ...routingExtern,
      },
    };
  });

  return {
    source: PLUGIN_SOURCE,
    extern: chapterExtern,
    data: {
      comic: {
        id: comicId,
        source: PLUGIN_SOURCE,
        title,
        extern: routingExtern,
      },
      chapter: {
        id: chapterId,
        name: formatGalleryChunkName(chunk, totalPageCount),
        order: chapterOrder,
        requestId: chapterId,
        storageChapterId: "Gallery",
        logicalKey: chapterId,
        pages,
        extern: chapterExtern,
      },
      chapters,
    },
  };
}
