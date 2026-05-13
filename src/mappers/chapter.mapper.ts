import { PLUGIN_SOURCE } from "../domain/constants";
import type { ChapterContentContract } from "../domain/contracts";

export type ChapterDocInput = {
  index: number;
  href: string;
  imageUrl: string;
  reloadKey?: string;
  fileName?: string;
};

export function mapChapterContent(
  comicId: string,
  chapterId: string,
  page: number,
  pageCount: number,
  items: ChapterDocInput[],
): ChapterContentContract {
  return {
    source: PLUGIN_SOURCE,
    comicId,
    chapterId,
    extern: {
      page,
      pageCount,
      hasReachedMax: page >= pageCount,
    },
    scheme: { version: "1.0.0", type: "chapterContent" },
    data: {
      chapter: {
        epId: chapterId,
        epName: "Gallery",
        length: items.length,
        epPages: String(items.length),
        docs: items.map((item) => ({
          id: String(item.index),
          name: item.fileName ?? `${item.index}.img`,
          path: item.fileName ?? `${item.index}.img`,
          url: item.imageUrl,
          extern: {
            href: item.href,
            reloadKey: item.reloadKey,
          },
        })),
      },
    },
  };
}

