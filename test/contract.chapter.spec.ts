import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, test, rs } from "@rstest/core";
import { getChapter } from "../src/index";
import { httpClient } from "../src/network/client";
import { DEFERRED_IMAGE_PATH } from "../src/domain/constants";

function fixture(name: string): string {
  return readFileSync(join(import.meta.dirname, "fixtures", name), "utf-8");
}

afterEach(() => {
  rs.restoreAllMocks();
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

function installWrappedInMemoryBridgeCache(): () => void {
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
        return {
          ok: true,
          value: cacheStore.has(key) ? cacheStore.get(key) : fallback,
        };
      }
      if (name === "cache.set") {
        const key = String(args[0] ?? "");
        cacheStore.set(key, args[1]);
        return true;
      }
      if (name === "cache.delete") {
        const key = String(args[0] ?? "");
        cacheStore.delete(key);
        return true;
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

function thumbnailFixtureWithHrefs(hrefs: string[]): string {
  const anchors = hrefs
    .map((href, index) => `<a href="${href}"><div data-orghash="abcdefghij${index}"></div></a>`)
    .join("\n");

  return `
    <div class="gtb"><p class="gpc">Showing 1 - ${hrefs.length} of ${hrefs.length} images</p></div>
    <div class="ptds"><a>1</a></div>
    <div class="ptt"><table><tbody><tr><td></td><td><a>1</a></td><td></td></tr></tbody></table></div>
    <div id="gdt">${anchors}</div>
  `;
}

function paginatedThumbnailFixture(
  pageNo: number,
  pageCount: number,
  imageStartNo: number,
  imageTotal: number,
  hrefs: string[],
): string {
  const anchors = hrefs
    .map(
      (href, index) =>
        `<a href="${href}"><div data-orghash="abcdefghij${imageStartNo + index}"></div></a>`,
    )
    .join("\n");
  const imageEndNo = imageStartNo + hrefs.length - 1;

  return `
    <div class="gtb"><p class="gpc">Showing ${imageStartNo} - ${imageEndNo} of ${imageTotal} images</p></div>
    <div class="ptds"><a>${pageNo}</a></div>
    <div class="ptt">
      <table>
        <tbody>
          <tr><td></td><td><a>${pageNo}</a></td><td><a>${pageCount}</a></td><td></td></tr>
        </tbody>
      </table>
    </div>
    <div id="gdt">${anchors}</div>
  `;
}

describe("chapter contract", () => {
  test("test_getChapter_valid_payload_returns_ordered_docs", async () => {
    const getTextSpy = rs.spyOn(httpClient, "getText");
    getTextSpy.mockResolvedValueOnce(fixture("thumbnail-page-1.html"));

    const result = await getChapter({
      comicId: "123456/abcdef",
      chapterId: "123456/abcdef",
      page: 1,
    });
    expect(result.source).toBe("ehentai");
    expect(result.data.comic.id).toBe("123456/abcdef");
    expect(result.data.chapter.id).toBe("123456/abcdef");
    expect(result.data.chapter.pages).toHaveLength(3);
    expect(result.data.chapter.pages[0].id).toBe("1");
    expect(result.data.chapter.pages[2].id).toBe("3");
    expect(result.data.chapter.storageChapterId).toBe("Gallery");
    const deferredUrl = new URL(result.data.chapter.pages[0].url);
    expect(deferredUrl.pathname).toBe(DEFERRED_IMAGE_PATH);
  });

  test("test_getChapter_first_page_merges_all_thumbnail_pages_for_download", async () => {
    const getTextSpy = rs.spyOn(httpClient, "getText");
    getTextSpy.mockImplementation(async (url: string) => {
      if (url.includes("/g/123456/abcdef/") && url.includes("p=1")) {
        return paginatedThumbnailFixture(2, 2, 3, 4, [
          "https://e-hentai.org/s/a3/123-3",
          "https://e-hentai.org/s/a4/123-4",
        ]);
      }
      if (url.includes("/g/123456/abcdef/")) {
        return paginatedThumbnailFixture(1, 2, 1, 4, [
          "https://e-hentai.org/s/a1/123-1",
          "https://e-hentai.org/s/a2/123-2",
        ]);
      }
      throw new Error(`unexpected url: ${url}`);
    });

    const result = await getChapter({ comicId: "123456/abcdef", page: 1 });
    expect(result.data.chapter.pages).toHaveLength(4);
    expect(result.data.chapter.pages.map((doc) => doc.id)).toEqual(["1", "2", "3", "4"]);
    expect(result.data.chapter.extern).toMatchObject({
      chunkIndex: 1,
      chunkStart: 1,
      chunkEnd: 4,
      chunkSize: 200,
      totalPageCount: 4,
    });
    expect(getTextSpy).toHaveBeenCalledWith(expect.stringContaining("p=1"));
  });

  test("test_getChapter_with_chunk_extern_only_returns_requested_chunk_docs", async () => {
    const getTextSpy = rs.spyOn(httpClient, "getText");
    getTextSpy.mockImplementation(async (url: string) => {
      if (url.includes("/g/123456/abcdef/") && url.includes("p=1")) {
        return paginatedThumbnailFixture(2, 2, 3, 4, [
          "https://e-hentai.org/s/a3/123-3",
          "https://e-hentai.org/s/a4/123-4",
        ]);
      }
      if (url.includes("/g/123456/abcdef/")) {
        return paginatedThumbnailFixture(1, 2, 1, 4, [
          "https://e-hentai.org/s/a1/123-1",
          "https://e-hentai.org/s/a2/123-2",
        ]);
      }
      throw new Error(`unexpected url: ${url}`);
    });

    const result = await getChapter({
      comicId: "123456/abcdef",
      page: 1,
      extern: {
        chunkIndex: 2,
        chunkStart: 3,
        chunkEnd: 4,
        chunkSize: 2,
        totalPageCount: 4,
      },
    });
    expect(result.data.chapter.id).toBe("chunk-2");
    expect(result.data.chapter.order).toBe(2);
    expect(result.data.chapter.pages).toHaveLength(2);
    expect(result.data.chapter.pages.map((doc) => doc.id)).toEqual(["3", "4"]);
    expect(getTextSpy).toHaveBeenCalledWith(expect.stringContaining("p=1"));
  });

  test("test_getChapter_second_request_hits_cache_and_skips_network", async () => {
    const restoreBridge = installInMemoryBridgeCache();
    try {
      const getTextSpy = rs.spyOn(httpClient, "getText");
      getTextSpy.mockResolvedValueOnce(fixture("thumbnail-page-1.html"));

      const first = await getChapter({ comicId: "123456/abcdef", page: 1 });
      const second = await getChapter({ comicId: "123456/abcdef", page: 1 });

      expect(first.data.chapter.pages).toHaveLength(3);
      expect(second.data.chapter.pages).toHaveLength(3);
      expect(getTextSpy).toHaveBeenCalledTimes(1);
    } finally {
      restoreBridge();
    }
  });

  test("test_getChapter_wrapped_cache_get_value_still_hits_cache", async () => {
    const restoreBridge = installWrappedInMemoryBridgeCache();
    try {
      const getTextSpy = rs.spyOn(httpClient, "getText");
      getTextSpy.mockResolvedValueOnce(fixture("thumbnail-page-1.html"));

      await getChapter({ comicId: "123456/abcdef", page: 1 });
      await getChapter({ comicId: "123456/abcdef", page: 1 });

      expect(getTextSpy).toHaveBeenCalledTimes(1);
    } finally {
      restoreBridge();
    }
  });

  test("test_getChapter_missing_comicId_returns_validation_error", async () => {
    await expect(getChapter({})).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
    });
  });

  test("test_getChapter_invalid_comicId_path_segment_returns_validation_error", async () => {
    await expect(
      getChapter({ comicId: "123456/%2fabc", chapterId: "123456/%2fabc", page: 1 }),
    ).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
    });
  });

  test("test_getChapter_mpv_href_returns_deferred_image_doc", async () => {
    const getTextSpy = rs.spyOn(httpClient, "getText");
    getTextSpy.mockResolvedValueOnce(
      thumbnailFixtureWithHrefs(["https://e-hentai.org/mpv/123456/sampletoken#page1"]),
    );

    const result = await getChapter({ comicId: "123456/abcdef", page: 1 });
    expect(result.data.chapter.pages).toHaveLength(1);
    const deferredUrl = new URL(result.data.chapter.pages[0].url);
    expect(deferredUrl.pathname).toBe(DEFERRED_IMAGE_PATH);
    expect(result.data.chapter.pages[0].extern).toMatchObject({
      href: "https://e-hentai.org/s/abcdefghij/123456-1",
    });
  });
});
