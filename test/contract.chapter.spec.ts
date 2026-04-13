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
