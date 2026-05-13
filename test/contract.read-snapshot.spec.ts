import { afterEach, describe, expect, test, vi } from "vitest";
import { getReadSnapshot } from "../src/index";
import { httpClient } from "../src/network/client";
import { DEFERRED_IMAGE_PATH } from "../src/domain/constants";

function firstSnapshotPageFixture(): string {
  return `
    <div id="gn">English Gallery Title</div>
    <div id="gj">゜掛惤正奶玄伙</div>
    <div id="gdc"><div class="cs">Manga</div></div>
    <div id="gdn"><a>uploader-name</a></div>
    <div id="gdd">
      <table><tbody><tr><td class="gdt1">Length:</td><td class="gdt2">3 pages</td></tr></tbody></table>
    </div>
    <div id="taglist"></div>
    <div class="gtb"><p class="gpc">Showing 1 - 3 of 3 images</p></div>
    <div class="ptds"><a>1</a></div>
    <div class="ptt"><table><tbody><tr><td></td><td><a>1</a></td><td></td></tr></tbody></table></div>
    <div id="gdt">
      <a href="https://e-hentai.org/s/a1/123-1"><div data-orghash="abcdefghij1"></div></a>
      <a href="https://e-hentai.org/s/a2/123-2"><div data-orghash="abcdefghij2"></div></a>
      <a href="https://e-hentai.org/s/a3/123-3"><div data-orghash="abcdefghij3"></div></a>
    </div>
  `;
}

function thumbnailPageFixture(currentPage: number, totalImages = 2000, pageSize = 20): string {
  const imageStart = (currentPage - 1) * pageSize + 1;
  const imageEnd = Math.min(totalImages, imageStart + pageSize - 1);
  const links = Array.from({ length: imageEnd - imageStart + 1 }, (_, index) => {
    const imageNo = imageStart + index;
    return `<a href="https://e-hentai.org/s/h${imageNo}/123-${imageNo}"><div data-orghash="abcdefghij${imageNo}"></div></a>`;
  }).join("");
  return `
    <div id="gn">Large Gallery</div>
    <div id="gdc"><div class="cs">Manga</div></div>
    <div id="gdd">
      <table><tbody><tr><td class="gdt1">Length:</td><td class="gdt2">${totalImages} pages</td></tr></tbody></table>
    </div>
    <div id="taglist"></div>
    <div class="gtb"><p class="gpc">Showing ${imageStart} - ${imageEnd} of ${totalImages} images</p></div>
    <div class="ptds"><a>${currentPage}</a></div>
    <div class="ptt"><table><tbody><tr><td></td><td><a>100</a></td><td></td></tr></tbody></table></div>
    <div id="gdt">${links}</div>
  `;
}

afterEach(() => {
  vi.restoreAllMocks();
});

function installInMemoryBridgeCache(): () => void {
  const host = globalThis as {
    bridge?: { call: (name: string, ...args: unknown[]) => Promise<unknown> };
  };
  const previousBridge = host.bridge;
  const cacheStore = new Map<string, unknown>();

  host.bridge = {
    call: async (name: string, ...args: unknown[]): Promise<unknown> => {
      if (name === "cache.get") {
        const key = String(args[0] ?? "");
        const fallback = args[1];
        return cacheStore.has(key) ? cacheStore.get(key) : fallback;
      }
      if (name === "cache.set") {
        const key = String(args[0] ?? "");
        cacheStore.set(key, args[1]);
        return true;
      }
      if (name === "cache.delete") {
        const key = String(args[0] ?? "");
        return cacheStore.delete(key);
      }
      if (name === "load_plugin_config") {
        return args[1] ?? "";
      }
      if (name === "save_plugin_config") {
        return String(args[1] ?? "");
      }
      throw new Error(`unexpected bridge call: ${name}`);
    },
  };

  return () => {
    if (previousBridge === undefined) {
      delete host.bridge;
      return;
    }
    host.bridge = previousBridge;
  };
}

describe("read snapshot contract", () => {
  test("test_getReadSnapshot_returns_comic_chapter_and_deferred_page_urls", async () => {
    const getTextSpy = vi.spyOn(httpClient, "getText");
    getTextSpy.mockResolvedValueOnce(firstSnapshotPageFixture());

    const result = await getReadSnapshot({ comicId: "123456/abcdef", chapterId: "123456/abcdef" });
    expect(result.source).toBe("ehentai");
    expect(result.data.comic.id).toBe("123456/abcdef");
    expect(result.data.comic.title).toBe("English Gallery Title");
    expect(result.data.chapter.id).toBe("123456/abcdef");
    expect(result.data.chapter.pages).toHaveLength(3);
    expect(result.data.chapter.name).toBe("Gallery 001-003");
    expect(result.data.chapter.extern).toMatchObject({
      chunkIndex: 1,
      chunkStart: 1,
      chunkEnd: 3,
      chunkSize: 200,
      totalPageCount: 3,
    });
    expect(result.data.chapter.pages[0]).toMatchObject({
      id: "1",
      name: "1.img",
      path: "1.img",
      extern: {
        href: "https://e-hentai.org/s/a1/123-1",
      },
    });
    const deferredUrl = new URL(result.data.chapter.pages[0].url);
    expect(deferredUrl.pathname).toBe(DEFERRED_IMAGE_PATH);
    expect(deferredUrl.searchParams.get("href")).toBeNull();
    expect(getTextSpy).toHaveBeenCalledTimes(1);
    expect(result.data.chapters).toEqual([
      {
        id: "chunk-1",
        name: "Gallery 001-003",
        order: 1,
        requestId: "chunk-1",
        storageChapterId: "Gallery",
        logicalKey: "chunk-1",
        extern: {
          chunkIndex: 1,
          chunkStart: 1,
          chunkEnd: 3,
          chunkSize: 200,
          totalPageCount: 3,
        },
      },
    ]);
  });

  test("test_getReadSnapshot_second_request_hits_cache_and_skips_network", async () => {
    const restoreBridge = installInMemoryBridgeCache();
    try {
      const getTextSpy = vi.spyOn(httpClient, "getText");
      getTextSpy.mockResolvedValueOnce(firstSnapshotPageFixture());

      const payload = {
        comicId: "123456/abcdef",
        chapterId: "123456/abcdef",
        extern: {
          chunkIndex: 1,
          chunkStart: 1,
          chunkEnd: 3,
        },
      };
      const first = await getReadSnapshot(payload);
      const second = await getReadSnapshot(payload);

      expect(first.data.chapter.pages).toHaveLength(3);
      expect(second.data.chapter.pages).toHaveLength(3);
      expect(getTextSpy).toHaveBeenCalledTimes(1);
    } finally {
      restoreBridge();
    }
  });

  test("test_getReadSnapshot_chunk_extern_loads_only_requested_200_page_window", async () => {
    const getTextSpy = vi.spyOn(httpClient, "getText").mockImplementation(async (url) => {
      const href = String(url);
      if (!href.includes("?p=")) {
        return thumbnailPageFixture(1);
      }
      const pageNo = Number(new URL(href).searchParams.get("p") ?? "0") + 1;
      return thumbnailPageFixture(pageNo);
    });

    const result = await getReadSnapshot({
      comicId: "123456/abcdef",
      chapterId: "123456/abcdef",
      extern: {
        chunkIndex: 2,
        chunkStart: 201,
        chunkEnd: 400,
      },
    });

    expect(result.data.chapter.name).toBe("Gallery 0201-0400");
    expect(result.data.chapter.pages).toHaveLength(200);
    expect(result.data.chapter.pages[0].id).toBe("201");
    expect(result.data.chapter.pages[199].id).toBe("400");
    expect(getTextSpy).toHaveBeenCalledTimes(11);
  });
});
