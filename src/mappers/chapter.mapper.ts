import { PLUGIN_SOURCE } from "../domain/constants";
import type { ChapterContentContract, ReadPagesCompatContract } from "../domain/contracts";

export type ChapterDocInput = {
  index: number;
  href: string;
  imageUrl: string;
  reloadKey?: string;
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
          name: `${item.index}.jpg`,
          path: `${item.index}.jpg`,
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

export function mapReadPagesCompat(
  page: number,
  pageCount: number,
  items: ChapterDocInput[],
): ReadPagesCompatContract {
  return {
    source: PLUGIN_SOURCE,
    scheme: { version: "1.0.0", type: "readPages" },
    data: {
      paging: {
        page,
        hasReachedMax: page >= pageCount,
      },
      items: items.map((item) => ({
        index: item.index,
        url: item.imageUrl,
        extern: {
          href: item.href,
          reloadKey: item.reloadKey,
        },
      })),
    },
  };
}
