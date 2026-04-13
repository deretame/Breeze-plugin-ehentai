import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test, vi } from "vitest";
import { getChapter, getComicDetail, searchComic } from "../src/index";
import { httpClient } from "../src/network/client";

function fixture(name: string): string {
  return readFileSync(join(import.meta.dirname, "fixtures", name), "utf-8");
}

describe("integration smoke", () => {
  test("test_search_to_detail_to_chapter_flow_returns_stable_contracts", async () => {
    const getTextSpy = vi.spyOn(httpClient, "getText");

    getTextSpy.mockResolvedValueOnce(fixture("search.html"));
    getTextSpy.mockResolvedValueOnce(fixture("detail.html"));
    getTextSpy.mockResolvedValueOnce(fixture("thumbnail-page-1.html"));
    getTextSpy.mockResolvedValueOnce(fixture("image-page.html"));
    getTextSpy.mockResolvedValueOnce(fixture("image-page.html"));
    getTextSpy.mockResolvedValueOnce(fixture("image-page.html"));

    const search = await searchComic({ keyword: "sample" });
    const comicId = search.data.items[0].id;
    expect(comicId).toBe("123456/abcdef");

    const detail = await getComicDetail({ comicId });
    expect(detail.data.normal.eps[0].id).toBe(comicId);

    const chapter = await getChapter({ comicId, chapterId: comicId, page: 1 });
    expect(chapter.data.chapter.docs.map((doc) => doc.id)).toEqual(["1", "2", "3"]);
  });
});
