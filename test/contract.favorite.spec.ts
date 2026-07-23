import { afterEach, beforeEach, describe, expect, rs, test } from "@rstest/core";
import type { NativeApi } from "breeze-plugin-kit";
import {
  listFavoriteFolders,
  moveFavoriteToFolder,
  toggleFavorite,
} from "../src/index";
import { httpClient } from "../src/network/client";

describe("favorite contract", () => {
  beforeEach(() => {
    globalThis.native = {
      put: rs.fn<NativeApi["put"]>().mockResolvedValue(99),
    } as unknown as NativeApi;
  });

  afterEach(() => {
    rs.restoreAllMocks();
    delete (globalThis as { native?: unknown }).native;
  });

  test("toggleFavorite_add_returns_favorited_true", async () => {
    rs.spyOn(httpClient, "postForm").mockResolvedValueOnce({
      status: 200,
      data: '<p>Added to favorites</p>',
      headers: {},
    });

    const result = await toggleFavorite({
      comicId: "123456/abcdef",
      currentFavorite: false,
    });

    expect(result).toEqual({ favorited: true, nextStep: "none" });
  });

  test("toggleFavorite_remove_returns_favorited_false", async () => {
    rs.spyOn(httpClient, "postForm").mockResolvedValueOnce({
      status: 200,
      data: '<p>Removed from favorites</p>',
      headers: {},
    });

    const result = await toggleFavorite({
      comicId: "123456/abcdef",
      currentFavorite: true,
    });

    expect(result).toEqual({ favorited: false, nextStep: "none" });
  });

  test("toggleFavorite_already_in_favorites_returns_nextStep_none", async () => {
    rs.spyOn(httpClient, "postForm").mockResolvedValueOnce({
      status: 200,
      data: '<p>Already in favorites</p>',
      headers: {},
    });

    const result = await toggleFavorite({
      comicId: "123456/abcdef",
      currentFavorite: false,
    });

    expect(result.favorited).toBe(true);
    expect(result.nextStep).toBe("none");
  });

  test("toggleFavorite_returns_selectFolder_when_folders_present", async () => {
    rs.spyOn(httpClient, "postForm").mockResolvedValueOnce({
      status: 200,
      data: `
        <form method="post">
          <select name="fav">
            <option value="0">Favorites</option>
            <option value="1">Reading</option>
            <option value="2">To Read</option>
          </select>
          <input type="submit" name="submit" value="Add" />
        </form>
      `,
      headers: {},
    });

    const result = await toggleFavorite({
      comicId: "123456/abcdef",
      currentFavorite: false,
    });

    expect(result.favorited).toBe(true);
    expect(result.nextStep).toBe("selectFolder");
  });

  test("listFavoriteFolders_returns_parsed_folders", async () => {
    rs.spyOn(httpClient, "getTextWithMeta").mockResolvedValueOnce({
      status: 200,
      data: `
        <div id="favform">
          <select name="fav">
            <option value="0" selected>Favorites</option>
            <option value="1">Custom 1</option>
            <option value="2">Custom 2</option>
          </select>
        </div>
      `,
      headers: {},
    });

    const result = await listFavoriteFolders();

    expect(result.items).toEqual([
      { id: "0", name: "Favorites" },
      { id: "1", name: "Custom 1" },
      { id: "2", name: "Custom 2" },
    ]);
  });

  test("listFavoriteFolders_empty_when_no_select", async () => {
    rs.spyOn(httpClient, "getTextWithMeta").mockResolvedValueOnce({
      status: 200,
      data: '<div>No favorites yet</div>',
      headers: {},
    });

    const result = await listFavoriteFolders();

    expect(result.items).toEqual([]);
  });

  test("moveFavoriteToFolder_returns_ok", async () => {
    rs.spyOn(httpClient, "postForm").mockResolvedValueOnce({
      status: 200,
      data: '<p>Added to favorites</p>',
      headers: {},
    });

    const result = await moveFavoriteToFolder({
      comicId: "123456/abcdef",
      folderId: "1",
    });

    expect(result).toEqual({ ok: true });
  });

  test("moveFavoriteToFolder_defaults_to_folder_0", async () => {
    rs.spyOn(httpClient, "postForm").mockResolvedValueOnce({
      status: 200,
      data: '<p>Added to favorites</p>',
      headers: {},
    });

    const result = await moveFavoriteToFolder({
      comicId: "123456/abcdef",
    });

    expect(result).toEqual({ ok: true });
  });
});
