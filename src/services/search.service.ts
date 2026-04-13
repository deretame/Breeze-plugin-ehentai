import type { SearchResultContract } from "../domain/contracts";
import type { PluginSettings, SearchComicPayload } from "../domain/types";
import { mapSearchResult } from "../mappers/comic.mapper";
import { httpClient } from "../network/client";
import { buildSearchEndpoint, buildSearchNavigationEndpoint } from "../network/endpoints";
import { parseSearchPage } from "../parsers/search.parser";
import { asRecord, normalizeKeyword, normalizePage } from "../utils/guards";

export async function searchComicService(
  payload: SearchComicPayload,
  settings: PluginSettings,
): Promise<SearchResultContract> {
  const keyword = normalizeKeyword(payload.keyword);
  const page = normalizePage(payload.page, 1);
  const extern = asRecord(payload.extern);
  const nextUrlFromExtern = String(extern.nextUrl ?? "").trim();

  const endpoint =
    page > 1 && nextUrlFromExtern
      ? buildSearchNavigationEndpoint(nextUrlFromExtern, settings.site)
      : buildSearchEndpoint(keyword, page, settings.site);

  const html = await httpClient.getText(endpoint);
  const parsed = parseSearchPage(html);

  return mapSearchResult({ ...payload, page, extern }, parsed);
}
