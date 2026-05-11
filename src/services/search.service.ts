import type { SearchResultContract } from "../domain/contracts";
import type { PluginSettings, SearchComicPayload } from "../domain/types";
import { mapSearchResult } from "../mappers/comic.mapper";
import { httpClient } from "../network/client";
import { buildSearchEndpoint, buildSearchNavigationEndpoint } from "../network/endpoints";
import { parseSearchPage } from "../parsers/search.parser";
import { asRecord, normalizeKeyword, normalizePage } from "../utils/guards";
import { buildRequestConfig } from "./settings.service";

function toEnabledFlag(value: unknown): "on" | undefined {
  if (value === true) {
    return "on";
  }
  if (typeof value === "string" && value.toLowerCase() === "true") {
    return "on";
  }
  return undefined;
}

function readPositiveInt(value: unknown): string | undefined {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) {
    return undefined;
  }
  return String(Math.floor(n));
}

function pickValue(
  extern: Record<string, unknown>,
  payloadMap: Record<string, unknown>,
  key: string,
): unknown {
  if (extern[key] !== undefined) {
    return extern[key];
  }
  return payloadMap[key];
}

function readSelectedCategories(value: unknown): Set<string> | undefined {
  if (Array.isArray(value)) {
    return new Set(
      value
        .map((item) =>
          String(item ?? "")
            .trim()
            .toLowerCase(),
        )
        .filter(Boolean),
    );
  }

  if (value && typeof value === "object") {
    const map = value as Record<string, unknown>;
    const selected = Object.entries(map)
      .filter(([, checked]) => checked === true || String(checked).toLowerCase() === "true")
      .map(([key]) => key.trim().toLowerCase())
      .filter(Boolean);
    return new Set(selected);
  }
  return undefined;
}

function computeFCatsBySelectedCategories(selectedCategories: Set<string>): string {
  let fCats = 0;
  if (!selectedCategories.has("misc")) fCats += 1;
  if (!selectedCategories.has("doujinshi")) fCats += 2;
  if (!selectedCategories.has("manga")) fCats += 4;
  if (!selectedCategories.has("artistcg")) fCats += 8;
  if (!selectedCategories.has("gamecg")) fCats += 16;
  if (!selectedCategories.has("imageset")) fCats += 32;
  if (!selectedCategories.has("cosplay")) fCats += 64;
  if (!selectedCategories.has("asianporn")) fCats += 128;
  if (!selectedCategories.has("nonh")) fCats += 256;
  if (!selectedCategories.has("western")) fCats += 512;
  return String(fCats);
}

function buildAdvancedQuery(
  extern: Record<string, unknown>,
  payloadMap: Record<string, unknown>,
): Record<string, unknown> {
  const query: Record<string, unknown> = {};
  const selectedCategories = readSelectedCategories(pickValue(extern, payloadMap, "categories"));
  if (selectedCategories) {
    query.f_cats = computeFCatsBySelectedCategories(selectedCategories);
  } else {
    const fCats = readPositiveInt(pickValue(extern, payloadMap, "f_cats"));
    if (fCats) {
      query.f_cats = fCats;
    }
  }

  const fSh = toEnabledFlag(pickValue(extern, payloadMap, "f_sh"));
  if (fSh) {
    query.f_sh = fSh;
  }

  const fSto = toEnabledFlag(pickValue(extern, payloadMap, "f_sto"));
  if (fSto) {
    query.f_sto = fSto;
  }

  const fSpf = readPositiveInt(pickValue(extern, payloadMap, "f_spf"));
  if (fSpf) {
    query.f_spf = fSpf;
  }

  const fSpt = readPositiveInt(pickValue(extern, payloadMap, "f_spt"));
  if (fSpt) {
    query.f_spt = fSpt;
  }

  const fSrdd = readPositiveInt(pickValue(extern, payloadMap, "f_srdd"));
  if (fSrdd) {
    query.f_srdd = fSrdd;
  }

  const fSfl = toEnabledFlag(pickValue(extern, payloadMap, "f_sfl"));
  if (fSfl) {
    query.f_sfl = fSfl;
  }

  const fSfu = toEnabledFlag(pickValue(extern, payloadMap, "f_sfu"));
  if (fSfu) {
    query.f_sfu = fSfu;
  }

  const fSft = toEnabledFlag(pickValue(extern, payloadMap, "f_sft"));
  if (fSft) {
    query.f_sft = fSft;
  }

  return query;
}

export async function searchComicService(
  payload: SearchComicPayload,
  settings: PluginSettings,
): Promise<SearchResultContract> {
  const payloadMap = asRecord(payload as unknown as Record<string, unknown>);
  const keyword = normalizeKeyword(payload.keyword);
  const page = normalizePage(payload.page, 1);
  const extern = asRecord(payload.extern);
  const nextUrlFromExtern = String(extern.nextUrl ?? "").trim();
  const advancedQuery = buildAdvancedQuery(extern, payloadMap);

  const endpoint =
    page > 1 && nextUrlFromExtern
      ? buildSearchNavigationEndpoint(nextUrlFromExtern, settings.site)
      : buildSearchEndpoint(keyword, page, settings.site, advancedQuery);

  const requestConfig = buildRequestConfig(settings);
  const html = requestConfig
    ? await httpClient.getText(endpoint, requestConfig)
    : await httpClient.getText(endpoint);
  const parsed = parseSearchPage(html);

  return mapSearchResult({ ...payload, page, extern }, parsed);
}
