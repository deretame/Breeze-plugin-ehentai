import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, test, vi } from "vitest";
import { getChapter, getReadPages } from "../src/index";
import { httpClient } from "../src/network/client";

function fixture(name: string): string {
  return readFileSync(join(import.meta.dirname, "fixtures", name), "utf-8");
}

afterEach(() => {
  vi.restoreAllMocks();
});

function installInMemoryBridgeCache(): () => void {
  const host = globalThis as { bridge?: { call: (name: string, ...args: unknown[]) => Promise<unknown> } };
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
  const host = globalThis as { bridge?: { call: (name: string, ...args: unknown[]) => Promise<unknown> } };
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
    .map((href, index) => `<a href="${href}"><div data-orghash="abcdefghij${imageStartNo + index}"></div></a>`)
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
    const getTextSpy = vi.spyOn(httpClient, "getText");
    getTextSpy.mockResolvedValueOnce(fixture("thumbnail-page-1.html"));
    getTextSpy.mockResolvedValueOnce(fixture("image-page.html"));
    getTextSpy.mockResolvedValueOnce(fixture("image-page.html"));
    getTextSpy.mockResolvedValueOnce(fixture("image-page.html"));

    const result = await getChapter({ comicId: "123456/abcdef", chapterId: "123456/abcdef", page: 1 });
    expect(result.scheme.type).toBe("chapterContent");
    expect(result.data.chapter.length).toBe(3);
    expect(result.data.chapter.docs[0].id).toBe("1");
    expect(result.data.chapter.docs[2].id).toBe("3");
  });

  test("test_getChapter_first_page_merges_all_thumbnail_pages_for_download", async () => {
    const getTextSpy = vi.spyOn(httpClient, "getText");
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
      if (url.includes("/s/")) {
        return fixture("image-page.html");
      }
      throw new Error(`unexpected url: ${url}`);
    });

    const result = await getChapter({ comicId: "123456/abcdef", page: 1 });
    expect(result.data.chapter.length).toBe(4);
    expect(result.data.chapter.docs.map((doc) => doc.id)).toEqual(["1", "2", "3", "4"]);
    expect(result.extern).toMatchObject({
      page: 1,
      pageCount: 1,
      hasReachedMax: true,
      thumbnailPageCount: 2,
      mergedAllThumbnailPages: true,
    });
    expect(getTextSpy).toHaveBeenCalledWith(expect.stringContaining("p=1"));
  });

  test("test_getReadPages_compat_alias_returns_read_pages_shape", async () => {
    const getTextSpy = vi.spyOn(httpClient, "getText");
    getTextSpy.mockResolvedValueOnce(fixture("thumbnail-page-1.html"));
    getTextSpy.mockResolvedValueOnce(fixture("image-page.html"));
    getTextSpy.mockResolvedValueOnce(fixture("image-page.html"));
    getTextSpy.mockResolvedValueOnce(fixture("image-page.html"));

    const result = await getReadPages({ comicId: "123456/abcdef", page: 1 });
    expect(result.scheme.type).toBe("readPages");
    expect(result.data.items).toHaveLength(3);
    expect(result.data.items[0].extern.reloadKey).toBe("WZG-474997");
  });

  test("test_getChapter_second_request_hits_cache_and_skips_network", async () => {
    const restoreBridge = installInMemoryBridgeCache();
    try {
      const getTextSpy = vi.spyOn(httpClient, "getText");
      getTextSpy.mockResolvedValueOnce(fixture("thumbnail-page-1.html"));
      getTextSpy.mockResolvedValueOnce(fixture("image-page.html"));
      getTextSpy.mockResolvedValueOnce(fixture("image-page.html"));
      getTextSpy.mockResolvedValueOnce(fixture("image-page.html"));

      const first = await getChapter({ comicId: "123456/abcdef", page: 1 });
      const second = await getChapter({ comicId: "123456/abcdef", page: 1 });

      expect(first.data.chapter.docs).toHaveLength(3);
      expect(second.data.chapter.docs).toHaveLength(3);
      expect(getTextSpy).toHaveBeenCalledTimes(4);
    } finally {
      restoreBridge();
    }
  });

  test("test_getChapter_wrapped_cache_get_value_still_hits_cache", async () => {
    const restoreBridge = installWrappedInMemoryBridgeCache();
    try {
      const getTextSpy = vi.spyOn(httpClient, "getText");
      getTextSpy.mockResolvedValueOnce(fixture("thumbnail-page-1.html"));
      getTextSpy.mockResolvedValueOnce(fixture("image-page.html"));
      getTextSpy.mockResolvedValueOnce(fixture("image-page.html"));
      getTextSpy.mockResolvedValueOnce(fixture("image-page.html"));

      await getChapter({ comicId: "123456/abcdef", page: 1 });
      await getChapter({ comicId: "123456/abcdef", page: 1 });

      expect(getTextSpy).toHaveBeenCalledTimes(4);
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
    await expect(getChapter({ comicId: "123456/%2fabc", chapterId: "123456/%2fabc", page: 1 })).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
    });
  });

  test("test_getChapter_mpv_href_retry_with_nl_returns_image_doc", async () => {
    const getTextSpy = vi.spyOn(httpClient, "getText");
    getTextSpy.mockResolvedValueOnce(
      thumbnailFixtureWithHrefs(["https://e-hentai.org/mpv/123456/sampletoken#page1"]),
    );
    getTextSpy.mockResolvedValueOnce(`
      <div id="loadfail" onclick="return nl('WZG-RETRY-KEY')"></div>
      <div>An error has occurred.</div>
    `);
    getTextSpy.mockResolvedValueOnce(fixture("image-page.html"));

    const result = await getChapter({ comicId: "123456/abcdef", page: 1 });
    expect(result.data.chapter.docs).toHaveLength(1);
    expect(result.data.chapter.docs[0].url).toBe("https://ehgt.org/full/1.jpg");
    expect(getTextSpy.mock.calls[1]?.[0]).toContain("/s/abcdefghij/123456-1");
    expect(getTextSpy.mock.calls[2]?.[0]).toContain("nl=WZG-RETRY-KEY");
  });

  test("test_getChapter_partial_parse_failure_keeps_valid_pages", async () => {
    const getTextSpy = vi.spyOn(httpClient, "getText");
    getTextSpy.mockResolvedValueOnce(
      thumbnailFixtureWithHrefs([
        "https://e-hentai.org/s/a1/123-1",
        "https://e-hentai.org/s/a2/123-2",
      ]),
    );
    getTextSpy.mockResolvedValueOnce(fixture("image-page.html"));
    getTextSpy.mockResolvedValueOnce("<html><body>broken image page</body></html>");

    const result = await getChapter({ comicId: "123456/abcdef", page: 1 });
    expect(result.data.chapter.docs).toHaveLength(1);
    expect(result.data.chapter.docs[0].id).toBe("1");
  });

  test("test_getChapter_limit_page_returns_upstream_blocked", async () => {
    const getTextSpy = vi.spyOn(httpClient, "getText");
    getTextSpy.mockImplementation(async (url: string) => {
      if (url.includes("/g/123456/abcdef/")) {
        return thumbnailFixtureWithHrefs([
          "https://e-hentai.org/s/a1/123-1",
          "https://e-hentai.org/s/a2/123-2",
        ]);
      }
      if (url.includes("/s/a1/123-1")) {
        return "<html><body>You have reached the image limit.</body></html>";
      }
      return fixture("image-page.html");
    });

    await expect(getChapter({ comicId: "123456/abcdef", page: 1 })).rejects.toMatchObject({
      code: "UPSTREAM_BLOCKED",
    });
  });

  test("test_getChapter_509_placeholder_returns_upstream_blocked", async () => {
    const getTextSpy = vi.spyOn(httpClient, "getText");
    getTextSpy.mockResolvedValueOnce(
      thumbnailFixtureWithHrefs(["https://e-hentai.org/s/a1/123-1"]),
    );
    getTextSpy.mockResolvedValueOnce(`
      <div id="i3"><img id="img" src="https://ehgt.org/g/509.gif" /></div>
      <a id="loadfail" onclick="return nl('WZG-509')">reload</a>
    `);

    await expect(getChapter({ comicId: "123456/abcdef", page: 1 })).rejects.toMatchObject({
      code: "UPSTREAM_BLOCKED",
    });
  });
});
