import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test, vi } from "vitest";
import { searchComic } from "../src/index";
import { httpClient } from "../src/network/client";

function fixture(name: string): string {
  return readFileSync(join(import.meta.dirname, "fixtures", name), "utf-8");
}

describe("search contract", () => {
  test("test_searchComic_valid_keyword_returns_search_result", async () => {
    vi.spyOn(httpClient, "getText").mockResolvedValueOnce(fixture("search.html"));

    const result = await searchComic({ keyword: "artist:a", page: 1 });
    expect(result.scheme.type).toBe("searchResult");
    expect(result.data.items).toHaveLength(1);
    expect(result.data.items[0]).toMatchObject({
      id: "123456/abcdef",
      title: "Sample English Title",
    });
    expect(result.data.items[0].cover.url).toBe("https://ehgt.org/c/1.jpg");
    expect(result.data.items[0].cover.path).toBe("123456_abcdef.jpg");
    expect(result.data.items[0].extern.href).toContain("/g/123456/abcdef/");
  });

  test("test_searchComic_invalid_cover_url_returns_empty_cover_url", async () => {
    vi.spyOn(httpClient, "getText").mockResolvedValueOnce(`
      <table class="itg">
        <tr>
          <td class="gl3c glname">
            <a href="https://e-hentai.org/g/123456/abcdef/"><div class="glink">Sample English Title</div></a>
          </td>
          <td class="gl2c"><img src="http://attacker.test/cover.jpg" /></td>
        </tr>
      </table>
    `);

    const result = await searchComic({ keyword: "artist:a", page: 1 });
    expect(result.data.items[0].cover.url).toBe("");
    expect(result.data.items[0].cover.path).toBe("");
  });

  test("test_searchComic_empty_result_returns_success_envelope", async () => {
    vi.spyOn(httpClient, "getText").mockResolvedValueOnce("<div class='itg'></div>");

    const result = await searchComic({ keyword: "nohit" });
    expect(result.scheme.type).toBe("searchResult");
    expect(result.data.items).toEqual([]);
    expect(result.data.paging.hasReachedMax).toBe(true);
  });

  test("test_searchComic_missing_keyword_throws_validation_error", async () => {
    await expect(searchComic({})).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
    });
  });

  test("test_searchComic_lazy_image_placeholder_uses_data_src_cover", async () => {
    vi.spyOn(httpClient, "getText").mockResolvedValueOnce(`
      <table class="itg gltc">
        <tbody>
          <tr>
            <td class="gl2c"><img src="https://ehgt.org/c/1.jpg" /></td>
            <td class="gl3c glname">
              <a href="https://e-hentai.org/g/3881537/23cc1145f4/"><div class="glink">First</div></a>
            </td>
          </tr>
          <tr>
            <td class="gl2c">
              <img
                src="data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw=="
                data-src="https://ehgt.org/w/02/339/51729-dj7t2evr.webp"
              />
            </td>
            <td class="gl3c glname">
              <a href="https://e-hentai.org/g/3875918/7cb5fa32d0/"><div class="glink">Second</div></a>
            </td>
          </tr>
        </tbody>
      </table>
    `);

    const result = await searchComic({ keyword: "test" });
    expect(result.data.items).toHaveLength(2);
    expect(result.data.items[1].cover.url).toBe("https://ehgt.org/w/02/339/51729-dj7t2evr.webp");
    expect(result.data.items[1].cover.path).toBe("3875918_7cb5fa32d0.webp");
  });

  test("test_searchComic_searchnav_dnext_anchor_marks_has_more", async () => {
    vi.spyOn(httpClient, "getText").mockResolvedValueOnce(`
      <div class="searchnav">
        <div><a id="dnext" href="https://e-hentai.org/?f_search=keqing&amp;next=3779110">Next &gt;</a></div>
      </div>
      <table class="itg gltc">
        <tbody>
          <tr>
            <td class="gl2c"><img src="https://ehgt.org/c/1.jpg" /></td>
            <td class="gl3c glname"><a href="https://e-hentai.org/g/123456/abcdef/"><div class="glink">Title</div></a></td>
          </tr>
        </tbody>
      </table>
    `);

    const result = await searchComic({ keyword: "keqing", page: 1 });
    expect(result.data.paging.hasReachedMax).toBe(false);
    expect(result.data.paging.page).toBe(1);
    expect(result.extern.nextUrl).toContain("next=3779110");
  });

  test("test_searchComic_searchnav_dnext_span_marks_reached_max", async () => {
    vi.spyOn(httpClient, "getText").mockResolvedValueOnce(`
      <div class="searchnav">
        <div><span id="dnext">Next &gt;</span></div>
      </div>
      <table class="itg gltc">
        <tbody>
          <tr>
            <td class="gl2c"><img src="https://ehgt.org/c/1.jpg" /></td>
            <td class="gl3c glname"><a href="https://e-hentai.org/g/123456/abcdef/"><div class="glink">Title</div></a></td>
          </tr>
        </tbody>
      </table>
    `);

    const result = await searchComic({ keyword: "keqing", page: 99 });
    expect(result.data.paging.hasReachedMax).toBe(true);
    expect(result.data.paging.page).toBe(99);
    expect(result.extern.nextUrl).toBe("");
  });

  test("test_searchComic_page2_uses_extern_next_url_instead_of_page_param", async () => {
    const getTextSpy = vi.spyOn(httpClient, "getText");
    getTextSpy.mockResolvedValueOnce(`
      <div class="searchnav">
        <div><span id="dnext">Next &gt;</span></div>
      </div>
      <table class="itg gltc"><tbody></tbody></table>
    `);

    await searchComic({
      keyword: "keqing",
      page: 2,
      extern: {
        nextUrl: "https://e-hentai.org/?f_search=keqing&next=3779110",
      },
    });

    expect(getTextSpy).toHaveBeenCalledTimes(1);
    const calledUrl = String(getTextSpy.mock.calls[0]?.[0] ?? "");
    expect(calledUrl).toContain("next=3779110");
    expect(calledUrl).not.toContain("page=");
  });
});
