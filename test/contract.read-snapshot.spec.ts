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
});

