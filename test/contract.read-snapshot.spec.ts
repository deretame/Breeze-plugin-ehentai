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
        id: "123456/abcdef",
        name: "Gallery",
        order: 1,
        extern: {},
      },
    ]);
  });

  test("test_getReadSnapshot_second_request_hits_cache_and_skips_network", async () => {
    const restoreBridge = installInMemoryBridgeCache();
    try {
      const getTextSpy = vi.spyOn(httpClient, "getText");
      getTextSpy.mockResolvedValueOnce(firstSnapshotPageFixture());

      const first = await getReadSnapshot({ comicId: "123456/abcdef", chapterId: "123456/abcdef" });
      const second = await getReadSnapshot({ comicId: "123456/abcdef", chapterId: "123456/abcdef" });

      expect(first.data.chapter.pages).toHaveLength(3);
      expect(second.data.chapter.pages).toHaveLength(3);
      expect(getTextSpy).toHaveBeenCalledTimes(1);
    } finally {
      restoreBridge();
    }
  });
});

