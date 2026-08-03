import type { SearchResultContract } from "breeze-plugin-kit";
import type { PluginSettings } from "../domain/types";
import { authRequiredError } from "../errors/plugin-error";
import { mapSearchResult } from "../mappers/comic.mapper";
import { httpClient } from "../network/client";
import { buildFavoritesEndpoint, buildSearchNavigationEndpoint } from "../network/endpoints";
import { isFavoritesLoginPage, parseFavoritesPage } from "../parsers/favorites.parser";
import { asRecord, normalizePage } from "../utils/guards";
import { buildRequestConfig } from "./settings.service";

export type FavoritesPayload = {
  page?: number;
  favcat?: string | number;
  sort?: string;
  extern?: Record<string, unknown>;
};

export function normalizeFavcat(value: unknown): string {
  const raw = String(value ?? "")
    .trim()
    .toLowerCase();
  if (!raw || raw === "a" || raw === "all") {
    return "";
  }
  return raw;
}

export async function getFavoritesService(
  payload: FavoritesPayload,
  settings: PluginSettings,
): Promise<SearchResultContract> {
  const extern = asRecord(payload.extern);
  const page = normalizePage(payload.page ?? extern.page, 1);
  const favcat = normalizeFavcat(payload.favcat ?? extern.favcat);
  const sort = String(payload.sort ?? extern.sort ?? "").trim();
  const nextUrlFromExtern = String(extern.nextUrl ?? "").trim();

  const endpoint =
    page > 1 && nextUrlFromExtern
      ? buildSearchNavigationEndpoint(nextUrlFromExtern, settings.site)
      : buildFavoritesEndpoint(page, settings.site, { favcat, sort });

  const requestConfig = buildRequestConfig(settings);
  if (!requestConfig) {
    throw authRequiredError("请先登录后再查看收藏");
  }

  const html = await httpClient.getText(endpoint, requestConfig);
  if (isFavoritesLoginPage(html)) {
    throw authRequiredError("登录状态已失效，请重新登录");
  }
  const parsed = parseFavoritesPage(html);

  return mapSearchResult(
    { ...payload, page, extern: { ...extern, favcat: favcat || "a", sort } },
    parsed,
  );
}
