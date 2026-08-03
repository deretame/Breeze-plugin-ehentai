import { afterEach, describe, expect, test, rs } from "@rstest/core";
import { getFavorites } from "../src/index";
import { httpClient } from "../src/network/client";

type FavoritesFeed = {
  scheme: { type: string };
  data: {
    page: number;
    favcat: string;
    sort: string;
    total: number;
    hasReachedMax: boolean;
    items: Array<{
      id: string;
      title: string;
      subtitle: string;
      cover: { url: string; path: string };
      extern: { href: string };
    }>;
    raw: { nextUrl: string; prevUrl: string };
  };
};

const AUTH_EXTERN = {
  ipb_member_id: "123456",
  ipb_pass_hash: "deadbeef",
};

async function fetchFavorites(payload: Record<string, unknown> = {}): Promise<FavoritesFeed> {
  const extern = (payload.extern ?? {}) as Record<string, unknown>;
  return (await getFavorites({
    ...payload,
    extern: { ...AUTH_EXTERN, ...extern },
  })) as unknown as FavoritesFeed;
}

function favoritesPageHtml(options?: { withNext?: boolean }): string {
  const nextNav = options?.withNext
    ? `<div><a id="unext" href="https://e-hentai.org/favorites.php?next=1452536-1610434311">Next &gt;</a></div>`
    : `<div><span id="unext">Next &gt;</span></div>`;
  return `
    <div class="ido" style="min-width:930px">
      <h1 style="font-size:10pt; font-weight:bold; margin:3px; text-align:center">Favorites</h1>
      <div class="nosel" style="position:relative; width:825px; margin:10px auto 5px">
        <div class="fp fps" onclick="document.location='https://e-hentai.org/favorites.php?favcat=0'"><div style="font-weight:bold">117</div><div>Favorites 0</div></div>
        <div class="fp" onclick="document.location='https://e-hentai.org/favorites.php?favcat=1'"><div style="font-weight:bold">2</div><div>Favorites 1</div></div>
        <div class="fp" onclick="document.location='https://e-hentai.org/favorites.php?favcat=2'"><div style="font-weight:bold">1</div><div>Favorites 2</div></div>
      </div>
      <form name="favform">
      <table class="itg gltm">
        <tbody>
          <tr>
            <td class="gl1m glcat"><div class="cs ct1">Misc</div></td>
            <td class="gl2m"><div class="glthumb"><div><img style="height:251px;width:250px" src="https://ehgt.org/52/14/5214ac3c0edeb369320ab119d4ab226ddf4667cf-3766908-1536-1536-png_250.jpg" /></div></div></td>
            <td class="gl3m glname"><a href="https://e-hentai.org/g/2636342/54b539beb8/"><div class="glink">Miku and Others made by AI [AI Generated]</div></a></td>
            <td class="gl4m"><div class="ir"></div></td>
            <td class="glfm glfav">2023-07-06 01:41</td>
            <td class="glfm" style="text-align:center"><input type="checkbox" name="modifygids[]" value="2636342" /></td>
          </tr>
          <tr>
            <td class="gl1m glcat"><div class="cs ct2">Doujinshi</div></td>
            <td class="gl2m"><div class="glthumb"><div><img style="height:251px;width:250px" src="https://ehgt.org/12/34/1234-5678-png_250.jpg" /></div></div></td>
            <td class="gl3m glname"><a href="https://e-hentai.org/g/1452536/1610434311/"><div class="glink">[PATREON] HentaiWorkshop - AI futanari</div></a></td>
            <td class="gl4m"><div class="ir"></div></td>
            <td class="glfm glfav">2023-07-13 01:44</td>
            <td class="glfm" style="text-align:center"><input type="checkbox" name="modifygids[]" value="1452536" /></td>
          </tr>
        </tbody>
      </table>
      </form>
      <div class="searchnav">
        <div><span id="ufirst">&lt;&lt; First</span></div>
        <div><span id="uprev">&lt; Prev</span></div>
        ${nextNav}
      </div>
    </div>
  `;
}

afterEach(() => {
  rs.restoreAllMocks();
});

describe("favorites contract", () => {
  test("test_getFavorites_valid_page_returns_feed_with_total", async () => {
    rs.spyOn(httpClient, "getText").mockResolvedValueOnce(favoritesPageHtml({ withNext: true }));

    const result = await fetchFavorites({ page: 1 });

    expect(result.scheme.type).toBe("favoritesFeed");
    expect(result.data.items).toHaveLength(2);
    expect(result.data.total).toBe(120);
    expect(result.data.hasReachedMax).toBe(false);
    expect(result.data.items[0]).toMatchObject({
      id: "2636342-54b539beb8",
      title: "Miku and Others made by AI [AI Generated]",
      subtitle: "Misc",
    });
    expect(result.data.items[0].cover.url).toBe(
      "https://ehgt.org/52/14/5214ac3c0edeb369320ab119d4ab226ddf4667cf-3766908-1536-1536-png_250.jpg",
    );
    expect(result.data.raw.nextUrl).toContain("next=1452536-1610434311");
  });

  test("test_getFavorites_last_page_marks_reached_max", async () => {
    rs.spyOn(httpClient, "getText").mockResolvedValueOnce(favoritesPageHtml());

    const result = await fetchFavorites({ page: 2 });

    expect(result.data.items).toHaveLength(2);
    expect(result.data.hasReachedMax).toBe(true);
    expect(result.data.raw.nextUrl).toBe("");
  });

  test("test_getFavorites_favcat_and_sort_are_sent_as_query", async () => {
    const getTextSpy = rs.spyOn(httpClient, "getText");
    getTextSpy.mockResolvedValueOnce(favoritesPageHtml());

    await fetchFavorites({ favcat: "2", sort: "p" });

    expect(getTextSpy).toHaveBeenCalledTimes(1);
    const calledUrl = String(getTextSpy.mock.calls[0]?.[0] ?? "");
    expect(calledUrl).toContain("favorites.php");
    expect(calledUrl).toContain("favcat=2");
    expect(calledUrl).toContain("inline_set=fs_p");
  });

  test("test_getFavorites_default_all_favcat_omits_param", async () => {
    const getTextSpy = rs.spyOn(httpClient, "getText");
    getTextSpy.mockResolvedValueOnce(favoritesPageHtml());

    await fetchFavorites({});

    const calledUrl = String(getTextSpy.mock.calls[0]?.[0] ?? "");
    expect(calledUrl).not.toContain("favcat=");
    expect(calledUrl).not.toContain("inline_set=");
  });

  test("test_getFavorites_page2_uses_extern_next_url", async () => {
    const getTextSpy = rs.spyOn(httpClient, "getText");
    getTextSpy.mockResolvedValueOnce(favoritesPageHtml());

    await fetchFavorites({
      page: 2,
      extern: {
        nextUrl: "https://e-hentai.org/favorites.php?next=1452536-1610434311",
      },
    });

    expect(getTextSpy).toHaveBeenCalledTimes(1);
    const calledUrl = String(getTextSpy.mock.calls[0]?.[0] ?? "");
    expect(calledUrl).toContain("next=1452536-1610434311");
    expect(calledUrl).not.toContain("page=");
  });

  test("test_getFavorites_empty_result_returns_success_envelope", async () => {
    rs.spyOn(httpClient, "getText").mockResolvedValueOnce(
      "<h1>Favorites</h1><table class='itg'><tbody></tbody></table>",
    );

    const result = await fetchFavorites({});

    expect(result.scheme.type).toBe("favoritesFeed");
    expect(result.data.items).toEqual([]);
    expect(result.data.hasReachedMax).toBe(true);
  });

  test("test_getFavorites_without_auth_cookie_throws_auth_required", async () => {
    const getTextSpy = rs.spyOn(httpClient, "getText");

    await expect(getFavorites({})).rejects.toMatchObject({
      code: "AUTH_REQUIRED",
      retryable: false,
    });
    expect(getTextSpy).not.toHaveBeenCalled();
  });

  test("test_getFavorites_stale_cookie_login_page_throws_auth_required", async () => {
    rs.spyOn(httpClient, "getText").mockResolvedValueOnce(`
      <html><body>
        <form action="index.php?act=Login&CODE=01" method="post">
          <input type="text" name="UserName" />
          <input type="password" name="PassWord" />
        </form>
      </body></html>
    `);

    await expect(fetchFavorites({})).rejects.toMatchObject({
      code: "AUTH_REQUIRED",
      retryable: false,
    });
  });
});
