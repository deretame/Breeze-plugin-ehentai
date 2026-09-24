import type { SearchResultContract } from "breeze-plugin-kit";
import type { PluginSettings, SearchParsed } from "../domain/types";
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

  const requestConfig = buildRequestConfig(settings);
  if (!requestConfig) {
    throw authRequiredError("请先登录后再查看收藏");
  }

  async function fetchFavoritesPage(endpoint: string): Promise<SearchParsed> {
    const html = await httpClient.getText(endpoint, requestConfig);
    if (isFavoritesLoginPage(html)) {
      throw authRequiredError("登录状态已失效，请重新登录");
    }
    return parseFavoritesPage(html);
  }

  const mappedExtern = { ...extern, favcat: favcat || "a", sort };
  const mapPage = (parsed: SearchParsed) =>
    mapSearchResult({ ...payload, page, extern: mappedExtern }, parsed);

  // 第 1 页：直接取收藏首页。
  if (page <= 1) {
    return mapPage(
      await fetchFavoritesPage(
        buildFavoritesEndpoint(settings.site, { favcat, sort }),
      ),
    );
  }

  // 第 N 页且调用方透传了上一页返回的 nextUrl：直接跳转（1 次请求）。
  // 无限滚动等正常翻页流程走这里，extern.nextUrl 由 mapSearchResult 透出。
  if (nextUrlFromExtern) {
    return mapPage(
      await fetchFavoritesPage(
        buildSearchNavigationEndpoint(nextUrlFromExtern, settings.site),
      ),
    );
  }

  // 第 N 页但没有游标：收藏页不支持 `?page=`（会被服务端忽略并返回第一页），
  // 只能从第一页开始跟随 nextUrl 逐页跳转到目标页。调用方透传 nextUrl 时
  // 走上面的快速路径，不会产生额外请求。
  let parsed = await fetchFavoritesPage(
    buildFavoritesEndpoint(settings.site, { favcat, sort }),
  );
  let current = 1;
  while (current < page) {
    const next = parsed.nextUrl;
    if (!next) {
      // 目标页超出实际页数：返回空列表并标记到底，总数沿用已知 total。
      return mapPage({
        items: [],
        page,
        pages: page,
        total: parsed.total,
        hasNext: false,
        nextUrl: undefined,
        prevUrl: parsed.prevUrl,
      });
    }
    parsed = await fetchFavoritesPage(
      buildSearchNavigationEndpoint(next, settings.site),
    );
    current += 1;
  }
  return mapPage(parsed);
}
