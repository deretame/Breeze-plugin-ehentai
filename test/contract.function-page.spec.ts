import { afterEach, describe, expect, test, rs } from "@rstest/core";
import { getLatestData, getPopularData, getRankingData } from "../src/index";
import { httpClient } from "../src/network/client";

type FunctionPageFeed = {
  scheme: { type: string };
  data: {
    page: number;
    keyword: string;
    total: number;
    hasReachedMax: boolean;
    items: Array<{ id: string; title: string }>;
    raw: { nextUrl: string; prevUrl: string };
  };
};

function listPageHtml(
  options?: {
    withNext?: boolean;
    nextHref?: string;
    gidA?: string;
    tokenA?: string;
    titleA?: string;
    gidB?: string;
    tokenB?: string;
    titleB?: string;
  },
): string {
  const nextHref = options?.nextHref ?? "https://e-hentai.org/?next=7770001";
  const nextNav = options?.withNext
    ? `<div><a id="unext" href="${nextHref}">Next &gt;</a></div>`
    : `<div><span id="unext">Next &gt;</span></div>`;
  const gidA = options?.gidA ?? "1110001";
  const tokenA = options?.tokenA ?? "aaa111aaaa";
  const titleA = options?.titleA ?? "Latest gallery A";
  const gidB = options?.gidB ?? "1110002";
  const tokenB = options?.tokenB ?? "bbb222bbbb";
  const titleB = options?.titleB ?? "Latest gallery B";
  return `
    <table class="itg gltc"><tbody>
      <tr>
        <td class="gl3c glname"><a href="https://e-hentai.org/g/${gidA}/${tokenA}/"><div class="glink">${titleA}</div></a></td>
      </tr>
      <tr>
        <td class="gl3c glname"><a href="https://e-hentai.org/g/${gidB}/${tokenB}/"><div class="glink">${titleB}</div></a></td>
      </tr>
    </tbody></table>
    <div class="searchnav">
      <div><span id="ufirst">&lt;&lt; First</span></div>
      <div><span id="uprev">&lt; Prev</span></div>
      ${nextNav}
    </div>
  `;
}

async function fetchLatest(payload: Record<string, unknown> = {}): Promise<FunctionPageFeed> {
  return (await getLatestData(payload)) as unknown as FunctionPageFeed;
}

afterEach(() => {
  rs.restoreAllMocks();
});

describe("function page contract", () => {
  test("test_latest_page1_requests_home_without_page_param", async () => {
    const getTextSpy = rs.spyOn(httpClient, "getText");
    getTextSpy.mockResolvedValueOnce(listPageHtml({ withNext: true }));

    const result = await fetchLatest({ page: 1 });

    expect(getTextSpy).toHaveBeenCalledTimes(1);
    const calledUrl = String(getTextSpy.mock.calls[0]?.[0] ?? "");
    expect(calledUrl).toBe("https://e-hentai.org/");
    expect(result.scheme.type).toBe("latestFeed");
    expect(result.data.items).toHaveLength(2);
    expect(result.data.items[0]).toMatchObject({
      id: "1110001-aaa111aaaa",
      title: "Latest gallery A",
    });
    expect(result.data.hasReachedMax).toBe(false);
    expect(result.data.raw.nextUrl).toContain("next=7770001");
  });

  test("test_latest_page2_with_cursor_uses_next_url", async () => {
    const getTextSpy = rs.spyOn(httpClient, "getText");
    getTextSpy.mockResolvedValueOnce(listPageHtml());

    const result = await fetchLatest({
      page: 2,
      extern: { nextUrl: "https://e-hentai.org/?next=7770001" },
    });

    expect(getTextSpy).toHaveBeenCalledTimes(1);
    const calledUrl = String(getTextSpy.mock.calls[0]?.[0] ?? "");
    expect(calledUrl).toContain("next=7770001");
    expect(result.data.items).toHaveLength(2);
    expect(result.data.hasReachedMax).toBe(true);
  });

  test("test_latest_page2_without_cursor_follows_next_chain", async () => {
    const getTextSpy = rs.spyOn(httpClient, "getText");
    getTextSpy.mockResolvedValueOnce(listPageHtml({ withNext: true }));
    getTextSpy.mockResolvedValueOnce(
      listPageHtml({
        gidA: "2220001",
        tokenA: "ccc333cccc",
        titleA: "Second page gallery A",
        gidB: "2220002",
        tokenB: "ddd444dddd",
        titleB: "Second page gallery B",
      }),
    );

    const result = await fetchLatest({ page: 2 });

    // 首页不支持 `?page=`，无游标时应从第一页跟随 next 跳转，而不是重取首页。
    expect(getTextSpy).toHaveBeenCalledTimes(2);
    const firstUrl = String(getTextSpy.mock.calls[0]?.[0] ?? "");
    const secondUrl = String(getTextSpy.mock.calls[1]?.[0] ?? "");
    expect(firstUrl).toBe("https://e-hentai.org/");
    expect(secondUrl).toContain("next=7770001");
    expect(result.data.items).toHaveLength(2);
    expect(result.data.items[0]).toMatchObject({
      id: "2220001-ccc333cccc",
      title: "Second page gallery A",
    });
    expect(result.data.hasReachedMax).toBe(true);
    expect(result.data.raw.nextUrl).toBe("");
  });

  test("test_latest_page_beyond_end_returns_empty", async () => {
    const getTextSpy = rs.spyOn(httpClient, "getText");
    getTextSpy.mockResolvedValueOnce(listPageHtml({ withNext: true }));
    getTextSpy.mockResolvedValueOnce(listPageHtml());

    const result = await fetchLatest({ page: 3 });

    expect(getTextSpy).toHaveBeenCalledTimes(2);
    expect(result.data.items).toEqual([]);
    expect(result.data.hasReachedMax).toBe(true);
  });

  test("test_popular_page1_requests_popular_path", async () => {
    const getTextSpy = rs.spyOn(httpClient, "getText");
    getTextSpy.mockResolvedValueOnce(listPageHtml());

    const result = (await getPopularData({ page: 1 })) as unknown as FunctionPageFeed;

    expect(getTextSpy).toHaveBeenCalledTimes(1);
    expect(String(getTextSpy.mock.calls[0]?.[0] ?? "")).toBe("https://e-hentai.org/popular");
    expect(result.scheme.type).toBe("popularFeed");
  });

  test("test_ranking_page2_keeps_page_param", async () => {
    const getTextSpy = rs.spyOn(httpClient, "getText");
    getTextSpy.mockResolvedValueOnce(listPageHtml());

    await getRankingData({ page: 2 });

    // 排行榜是真正的页码式翻页，保持 `?p=` 逻辑不变。
    expect(getTextSpy).toHaveBeenCalledTimes(1);
    const calledUrl = String(getTextSpy.mock.calls[0]?.[0] ?? "");
    expect(calledUrl).toContain("toplist.php");
    expect(calledUrl).toContain("p=1");
  });

  test("test_latest_keyword_is_sent_as_f_search", async () => {
    const getTextSpy = rs.spyOn(httpClient, "getText");
    getTextSpy.mockResolvedValueOnce(listPageHtml());

    const result = await fetchLatest({ keyword: "blue archive" });

    expect(getTextSpy).toHaveBeenCalledTimes(1);
    expect(String(getTextSpy.mock.calls[0]?.[0] ?? "")).toContain("f_search=blue+archive");
    expect(result.data.keyword).toBe("blue archive");
  });
});
