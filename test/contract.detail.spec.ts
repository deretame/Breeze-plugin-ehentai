import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, test, vi } from "vitest";
import { getComicDetail } from "../src/index";
import { httpClient } from "../src/network/client";

function fixture(name: string): string {
  return readFileSync(join(import.meta.dirname, "fixtures", name), "utf-8");
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("detail contract", () => {
  test("test_getComicDetail_valid_comicId_returns_detail_with_eps", async () => {
    vi.spyOn(httpClient, "getText").mockResolvedValueOnce(fixture("detail.html"));

    const result = await getComicDetail({ comicId: "123456/abcdef" });
    expect(result.scheme.type).toBe("comicDetail");
    expect(result.data.normal.comicInfo.id).toBe("123456/abcdef");
    expect(result.data.normal.comicInfo.title).toBe("日本語タイトル");
    expect(result.data.normal.comicInfo.cover.url).toBe("https://ehgt.org/c/detail-cover.jpg");
    expect(result.data.normal.comicInfo.cover.path).toBe("123456_abcdef.jpg");
    expect(result.data.normal.comicInfo.titleMeta[0]).toMatchObject({
      name: "分类：Manga",
      onTap: {},
      extension: {},
    });
    expect(result.data.normal.comicInfo.titleMeta[2]).toMatchObject({
      name: "语言：English TR",
      onTap: {},
      extension: {},
    });
    expect(result.data.normal.comicInfo.metadata).toContainEqual({
      type: "tag:artist",
      name: "artist",
      value: [
        {
          name: "foo artist",
          onTap: {
            type: "openSearch",
            payload: {
              source: "ehentai",
              keyword: "artist:foo artist",
              extern: {},
            },
          },
          extension: {},
        },
      ],
    });
    expect(result.data.normal.eps).toHaveLength(1);
    expect(result.data.normal.eps[0].id).toBe("123456/abcdef");
  });

  test("test_getComicDetail_invalid_cover_url_returns_empty_cover_url", async () => {
    const poisonedHtml = fixture("detail.html").replace(
      "https://ehgt.org/c/detail-cover.jpg",
      "http://attacker.test/cover.jpg",
    );
    vi.spyOn(httpClient, "getText").mockResolvedValueOnce(poisonedHtml);

    const result = await getComicDetail({ comicId: "123456/abcdef" });
    expect(result.data.normal.comicInfo.cover.url).toBe("");
    expect(result.data.normal.comicInfo.cover.path).toBe("");
  });

  test("test_getComicDetail_invalid_payload_returns_validation_error", async () => {
    await expect(getComicDetail({})).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
    });
  });

  test("test_getComicDetail_cover_style_url_is_supported", async () => {
    const styledHtml = fixture("detail.html").replace(
      `<div id="gd1"><img src="https://ehgt.org/c/detail-cover.jpg" /></div>`,
      `<div id="gd1"><div style="background-image:url('https://s.exhentai.org/t/detail-cover.jpg')"></div></div>`,
    );
    vi.spyOn(httpClient, "getText").mockResolvedValueOnce(styledHtml);

    const result = await getComicDetail({ comicId: "123456/abcdef" });
    expect(result.data.normal.comicInfo.cover.url).toBe("https://s.exhentai.org/t/detail-cover.jpg");
    expect(result.data.normal.comicInfo.cover.path).toBe("123456_abcdef.jpg");
  });

  test("test_getComicDetail_disowned_favorited_rating_mapped_into_titleMeta", async () => {
    vi.spyOn(httpClient, "getText").mockResolvedValueOnce(`
      <div id="gd1"><img src="https://ehgt.org/c/detail-cover.jpg" /></div>
      <div id="gn">Sample</div>
      <div id="gdc"><div class="cs">Misc</div></div>
      <div id="gdn" style="opacity: 0.5; font-style: italic">(Disowned)</div>
      <div id="gdd">
        <table>
          <tr><td class="gdt1">Posted:</td><td class="gdt2">2026-02-07 10:46</td></tr>
          <tr><td class="gdt1">Language:</td><td class="gdt2">Japanese</td></tr>
          <tr><td class="gdt1">File Size:</td><td class="gdt2">26.20 MiB</td></tr>
          <tr><td class="gdt1">Length:</td><td class="gdt2">93 pages</td></tr>
          <tr><td class="gdt1">Favorited:</td><td class="gdt2" id="favcount">94 times</td></tr>
        </table>
      </div>
      <span id="rating_count">27</span>
      <td id="rating_label" colspan="3">Average: 2.52</td>
      <div id="taglist"></div>
    `);

    const result = await getComicDetail({ comicId: "123456/abcdef" });
    const names = result.data.normal.comicInfo.titleMeta.map((item) => item.name);
    expect(names).toContain("上传者：Disowned");
    expect(names).toContain("收藏：94 次");
    expect(names).toContain("评分：2.52（27）");
    expect(result.data.normal.comicInfo.metadata).toEqual([]);
  });

  test("test_getComicDetail_taglist_rows_mapped_to_clickable_metadata", async () => {
    vi.spyOn(httpClient, "getText").mockResolvedValueOnce(`
      <div id="gd1"><img src="https://ehgt.org/c/detail-cover.jpg" /></div>
      <div id="gn">Sample</div>
      <div id="gdc"><div class="cs">Misc</div></div>
      <div id="gdn"><a>uploader-name</a></div>
      <div id="gdd"><table><tr><td class="gdt1">Length:</td><td class="gdt2">2 pages</td></tr></table></div>
      <div id="taglist">
        <table>
          <tr>
            <td class="tc">parody:</td>
            <td><a href="https://e-hentai.org/tag/parody:genshin+impact">genshin impact</a></td>
          </tr>
          <tr>
            <td class="tc">female:</td>
            <td>
              <a href="https://e-hentai.org/tag/female:sole+female">sole female</a>
              <a href="https://e-hentai.org/tag/female:twintails">twintails</a>
            </td>
          </tr>
        </table>
      </div>
    `);

    const result = await getComicDetail({ comicId: "123456/abcdef" });
    expect(result.data.normal.comicInfo.metadata).toContainEqual({
      type: "tag:parody",
      name: "parody",
      value: [
        {
          name: "genshin impact",
          onTap: {
            type: "openSearch",
            payload: {
              source: "ehentai",
              keyword: "parody:genshin impact",
              extern: {},
            },
          },
          extension: {},
        },
      ],
    });
    expect(result.data.normal.comicInfo.metadata).toContainEqual({
      type: "tag:female",
      name: "female",
      value: [
        {
          name: "sole female",
          onTap: {
            type: "openSearch",
            payload: {
              source: "ehentai",
              keyword: "female:sole female",
              extern: {},
            },
          },
          extension: {},
        },
        {
          name: "twintails",
          onTap: {
            type: "openSearch",
            payload: {
              source: "ehentai",
              keyword: "female:twintails",
              extern: {},
            },
          },
          extension: {},
        },
      ],
    });
  });

  test("test_getComicDetail_title_prefers_chinese_over_japanese_and_english", async () => {
    vi.spyOn(httpClient, "getText").mockResolvedValueOnce(`
      <div id="gd1"><img src="https://ehgt.org/c/detail-cover.jpg" /></div>
      <div id="gn">刻晴与旅行者</div>
      <div id="gj">けいせい</div>
      <div id="gdc"><div class="cs">Misc</div></div>
      <div id="gdn"><a>uploader-name</a></div>
      <div id="gdd">
        <table>
          <tr><td class="gdt1">Language:</td><td class="gdt2">Chinese</td></tr>
          <tr><td class="gdt1">Length:</td><td class="gdt2">2 pages</td></tr>
        </table>
      </div>
      <div id="taglist"></div>
    `);

    const result = await getComicDetail({ comicId: "123456/abcdef" });
    expect(result.data.normal.comicInfo.title).toBe("刻晴与旅行者");
  });

  test("test_getComicDetail_invalid_comicId_path_segment_returns_validation_error", async () => {
    await expect(getComicDetail({ comicId: "123456/abc?x=1" })).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
    });
  });
});
