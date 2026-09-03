import { afterEach, describe, expect, test, rs } from "@rstest/core";
import { continueFavoriteAction, getComicDetail, startFavoriteAction } from "../src/index";
import { httpClient } from "../src/network/client";

const AUTH_EXTERN = {
  ipb_member_id: "123456",
  ipb_pass_hash: "deadbeef",
};

const FAVORITE_PAGE_HTML = `
  <h1>Favorites</h1>
  <div class="nosel">
    <div class="fp" onclick="document.location='/favorites.php?favcat=0'"><div>117</div><div>阅读</div></div>
    <div class="fp" onclick="document.location='/favorites.php?favcat=1'"><div>2</div><div>稍后</div></div>
    <div class="fp" onclick="document.location='/favorites.php?favcat=2'"><div>1</div><div>精品</div></div>
    <div class="fp"><div></div><div></div></div>
  </div>
`;

const FAVORITE_MUTATION_HTML = `<script>window.opener.document.getElementById("favoritelink")</script>`;

afterEach(() => {
  rs.restoreAllMocks();
});

describe("favorite action contract", () => {
  test("test_start_and_continue_add_favorite_uses_selected_category", async () => {
    rs.spyOn(httpClient, "getText").mockResolvedValueOnce(FAVORITE_PAGE_HTML);
    const start = await startFavoriteAction({
      comicId: "123456/abcdef",
      action: "add",
      extern: AUTH_EXTERN,
    });

    expect(start).toMatchObject({
      status: "awaitingInput",
      favorited: false,
      committed: false,
      input: {
        type: "select",
        key: "favcat",
        allowCreate: false,
      },
    });
    expect(start.input?.options).toEqual([
      { id: "0", label: "阅读" },
      { id: "1", label: "稍后" },
      { id: "2", label: "精品" },
    ]);

    const postTextSpy = rs
      .spyOn(httpClient, "postText")
      .mockResolvedValueOnce(FAVORITE_MUTATION_HTML);
    const completed = await continueFavoriteAction({
      comicId: "123456/abcdef",
      action: "add",
      continuationToken: String(start.continuationToken),
      input: { value: "2" },
      extern: AUTH_EXTERN,
    });

    expect(completed).toMatchObject({
      status: "completed",
      favorited: true,
      committed: true,
    });
    expect(postTextSpy).toHaveBeenCalledWith(
      "https://e-hentai.org/gallerypopups.php?gid=123456&t=abcdef&act=addfav",
      {
        favcat: "2",
        favnote: "",
        apply: "Add to Favorites",
        update: "1",
      },
      expect.objectContaining({
        headers: { Cookie: "ipb_member_id=123456; ipb_pass_hash=deadbeef" },
      }),
    );
  });

  test("test_remove_all_favorite_posts_favdel", async () => {
    const postTextSpy = rs
      .spyOn(httpClient, "postText")
      .mockResolvedValueOnce(FAVORITE_MUTATION_HTML);

    const result = await startFavoriteAction({
      comicId: "123456-abcdef",
      action: "removeAll",
      currentFavorite: true,
      extern: AUTH_EXTERN,
    });

    expect(result).toMatchObject({
      status: "completed",
      favorited: false,
      committed: true,
    });
    expect(postTextSpy.mock.calls[0]?.[1]).toEqual({
      favcat: "favdel",
      favnote: "",
      apply: "Apply Changes",
      update: "1",
    });
  });

  test("test_detail_exposes_collection_capability", async () => {
    rs.spyOn(httpClient, "getText").mockResolvedValueOnce(`
      <div id="gn">Sample</div>
      <div id="gdc"><div class="cs">Manga</div></div>
      <div id="gdd"><table><tr><td>Length:</td><td>1 pages</td></tr></table></div>
    `);

    const result = await getComicDetail({ comicId: "123456/abcdef" });

    expect(result.data.normal.allowCollected).toBe(true);
  });
});
