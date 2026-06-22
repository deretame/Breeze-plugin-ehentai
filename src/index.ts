import type {
  AdvancedSearchContract,
  CapabilitiesBundleContract,
  ChapterContentContract,
  ChapterPayload,
  ComicDetailContract,
  ComicDetailPayload,
  ComicPagedListContract,
  FetchImageBytesPayload,
  FilterBundleContract,
  InfoContract,
  ReadSnapshotContract,
  SearchResultContract,
  SettingsBundleContract,
} from "../types/type";
import {
  EH_COOKIE_POLL_INTERVAL_MS,
  EH_FORUM_COOKIE_CONFIG_KEY,
  EH_FORUM_LOGIN_REDIRECT_URL,
  EH_FORUM_LOGIN_URL,
  EH_IGNEOUS_CONFIG_KEY,
  EH_MEMBER_ID_CONFIG_KEY,
  EH_PASS_HASH_CONFIG_KEY,
  PLUGIN_SOURCE,
} from "./domain/constants";
import { normalizeError } from "./errors/normalize-error";
import { mapSearchResult } from "./mappers/comic.mapper";
import { httpClient } from "./network/client";
import { buildSearchNavigationEndpoint } from "./network/endpoints";
import { parseSearchPage } from "./parsers/search.parser";
import { getChapterService } from "./services/chapter.service";
import { getComicDetailService } from "./services/detail.service";
import { fetchImageBytesService } from "./services/image.service";
import { getInfoService } from "./services/info.service";
import { getReadSnapshotService } from "./services/read-snapshot.service";
import { searchComicService } from "./services/search.service";
import {
  buildRequestConfig,
  findCookieValue,
  getSettingsBundleService,
  migrateLegacyForumCookieIfNeeded,
  readSettings,
  removeCookieNames,
  resetExAccessProbeCache,
  saveCookiePart,
} from "./services/settings.service";
import { asRecord } from "./utils/guards";

type SearchComicPayload = {
  keyword?: string;
  page?: number;
  extern?: Record<string, unknown>;
};

function extractCookieFromPayload(payload: Record<string, unknown>): string {
  console.log(payload);
  const candidates = [
    payload.cookie,
    payload.cookies,
    payload.cookieString,
    payload.value,
    asRecord(payload.data).cookie,
    asRecord(payload.data).cookies,
    asRecord(payload.data).cookieString,
    asRecord(payload.raw).cookie,
    asRecord(payload.raw).cookies,
    asRecord(payload.raw).cookieString,
  ];

  for (const candidate of candidates) {
    const text = String(candidate ?? "").trim();
    if (text) {
      return text;
    }
  }
  return "";
}

function extractCookieNames(cookie: string): string[] {
  if (!cookie) {
    return [];
  }
  return cookie
    .split(";")
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item) => {
      const eqIndex = item.indexOf("=");
      if (eqIndex <= 0) {
        return "";
      }
      return item.slice(0, eqIndex).trim();
    })
    .filter(Boolean);
}

export async function searchComic(payload: SearchComicPayload = {}): Promise<SearchResultContract> {
  console.log("searchComic payload", payload);
  const payloadMap = asRecord(payload as unknown as Record<string, unknown>);
  try {
    const settings = await readSettings(payload.extern);
    return await searchComicService(
      {
        ...payloadMap,
        extern: asRecord(payload.extern),
      } as SearchComicPayload,
      settings,
    );
  } catch (error) {
    throw normalizeError(error);
  }
}

export async function getComicDetail(
  payload: ComicDetailPayload = {},
): Promise<ComicDetailContract> {
  try {
    const settings = await readSettings(payload.extern);
    return await getComicDetailService(payload, settings);
  } catch (error) {
    throw normalizeError(error);
  }
}

export async function getChapter(payload: ChapterPayload = {}): Promise<ChapterContentContract> {
  try {
    const settings = await readSettings(payload.extern);
    let data = await getChapterService(payload, settings);
    console.debug(data);
    return data;
  } catch (error) {
    throw normalizeError(error);
  }
}

export async function getReadSnapshot(payload: ChapterPayload = {}): Promise<ReadSnapshotContract> {
  console.log("getReadSnapshot payload", payload);
  try {
    const settings = await readSettings(payload.extern);
    return await getReadSnapshotService(payload, settings);
  } catch (error) {
    throw normalizeError(error);
  }
}

export async function fetchImageBytes(
  payload: FetchImageBytesPayload = {},
): Promise<Uint8Array<ArrayBufferLike>> {
  try {
    const settings = await readSettings(payload.extern);
    return await fetchImageBytesService(payload, settings);
  } catch (error) {
    throw normalizeError(error);
  }
}

export async function getInfo(): Promise<InfoContract> {
  return getInfoService();
}

function resolveFunctionPageBySource(source: string): string {
  switch (source) {
    case "popular":
      return "/popular";
    case "ranking":
      return "/toplist.php?tl=15";
    case "latest":
    default:
      return "/";
  }
}

function resolveRankTl(rankType: string): number {
  switch (rankType) {
    case "month":
      return 13;
    case "year":
      return 12;
    case "allTime":
      return 11;
    case "day":
    default:
      return 15;
  }
}

export async function getLatestData(
  payload: SearchComicPayload = {},
): Promise<ComicPagedListContract> {
  return getFunctionPage({
    ...payload,
    extern: { ...payload.extern, source: "latest" },
  });
}

export async function getPopularData(
  payload: SearchComicPayload = {},
): Promise<ComicPagedListContract> {
  return getFunctionPage({
    ...payload,
    extern: { ...payload.extern, source: "popular" },
  });
}

export async function getRankingData(
  payload: SearchComicPayload = {},
): Promise<ComicPagedListContract> {
  return getFunctionPage({
    ...payload,
    extern: { ...payload.extern, source: "ranking" },
  });
}

export async function getFunctionPage(
  payload: Record<string, unknown> = {},
): Promise<ComicPagedListContract> {
  try {
    const extern = asRecord(payload.extern);
    const source = String(extern.source ?? payload.source ?? "latest")
      .trim()
      .toLowerCase();
    const page = Math.max(1, Number(payload.page ?? extern.page ?? 1) || 1);
    const nextUrlFromExtern = String(extern.nextUrl ?? "").trim();
    const keyword = String(payload.keyword ?? extern.keyword ?? "").trim();
    const rankType = String(extern.rankType ?? payload.rankType ?? "day").trim();

    const settings = await readSettings(extern);
    const requestConfig = buildRequestConfig(settings);

    let endpoint = "";
    if (page > 1 && nextUrlFromExtern) {
      endpoint = buildSearchNavigationEndpoint(nextUrlFromExtern, settings.site);
    } else if (source === "ranking") {
      const tl = resolveRankTl(rankType);
      const rankingSite = settings.site === "EX" ? "EH" : settings.site;
      endpoint = buildSearchNavigationEndpoint(
        `/toplist.php?tl=${tl}&p=${Math.max(0, page - 1)}`,
        rankingSite,
      );
    } else {
      endpoint = buildSearchNavigationEndpoint(resolveFunctionPageBySource(source), settings.site);
      if (keyword) {
        const url = new URL(endpoint);
        url.searchParams.set("f_search", keyword);
        endpoint = buildSearchNavigationEndpoint(url.toString(), settings.site);
      }
    }

    const html = requestConfig
      ? await httpClient.getText(endpoint, requestConfig)
      : await httpClient.getText(endpoint);

    const parsed = parseSearchPage(html);
    const mapped = mapSearchResult({ page, extern: { ...extern, source } }, parsed);

    return {
      source: PLUGIN_SOURCE,
      extern: mapped.extern ?? undefined,
      scheme: {
        version: "1.0.0",
        type: `${source || "latest"}Feed`,
        card: "comic",
      },
      data: {
        page,
        keyword,
        rankType,
        total: mapped.data.paging.total,
        hasReachedMax: mapped.data.paging.hasReachedMax,
        items: mapped.data.items,
        raw: {
          page: mapped.data.paging.page,
          pages: mapped.data.paging.pages,
          nextUrl: mapped.extern?.nextUrl ?? "",
          prevUrl: mapped.extern?.prevUrl ?? "",
        },
      },
    } as ComicPagedListContract;
  } catch (error) {
    throw normalizeError(error);
  }
}

export async function getRankingFilterBundle(): Promise<FilterBundleContract> {
  return {
    source: PLUGIN_SOURCE,
    scheme: {
      version: "1.0.0",
      type: "rankingFilter",
      title: "筛选排行榜",
      fields: [
        {
          key: "rankType",
          kind: "choice",
          label: "榜单类型",
          options: [
            {
              label: "日榜",
              value: "day",
              result: { extern: { rankType: "day" } },
            },
            {
              label: "月榜",
              value: "month",
              result: { extern: { rankType: "month" } },
            },
            {
              label: "年榜",
              value: "year",
              result: { extern: { rankType: "year" } },
            },
            {
              label: "总榜",
              value: "allTime",
              result: { extern: { rankType: "allTime" } },
            },
          ],
        },
      ],
    },
    data: {
      values: {
        rankType: "day",
      },
    },
  };
}

export async function getSettingsBundle(): Promise<SettingsBundleContract> {
  return getSettingsBundleService();
}

export async function getCapabilitiesBundle(): Promise<CapabilitiesBundleContract> {
  return {
    source: PLUGIN_SOURCE,
    scheme: {
      version: "1.0.0" as const,
      type: "capabilities" as const,
      actions: [
        {
          title: "前往网页登录",
          fnPath: "startEhentaiWebLogin",
        },
      ],
    },
    data: {},
  };
}

export async function getAdvancedSearchScheme(
  payload: { extern?: Record<string, unknown> } = {},
): Promise<AdvancedSearchContract> {
  const extern = asRecord(payload.extern);

  const boolOr = (value: unknown, fallback: boolean) => {
    if (typeof value === "boolean") return value;
    if (typeof value === "string") {
      if (value.toLowerCase() === "true") return true;
      if (value.toLowerCase() === "false") return false;
    }
    return fallback;
  };
  const selectedCategories = (() => {
    const raw = extern.categories;
    if (Array.isArray(raw)) {
      return raw.map((item) => String(item ?? "")).filter(Boolean);
    }
    if (raw && typeof raw === "object") {
      return Object.entries(raw as Record<string, unknown>)
        .filter(([, checked]) => checked === true || String(checked).toLowerCase() === "true")
        .map(([key]) => String(key).trim())
        .filter(Boolean);
    }
    return [
      "misc",
      "doujinshi",
      "manga",
      "artistcg",
      "gamecg",
      "western",
      "nonh",
      "imageset",
      "cosplay",
      "asianporn",
    ];
  })();

  return {
    source: PLUGIN_SOURCE,
    scheme: {
      version: "1.0.0" as const,
      type: "advancedSearch" as const,
      title: "高级搜索",
      fields: [
        {
          key: "categories",
          kind: "multiChoice" as const,
          label: "分类选择",
          options: [
            { label: "Misc", value: "misc" },
            { label: "Doujinshi", value: "doujinshi" },
            { label: "Manga", value: "manga" },
            { label: "Artist CG", value: "artistcg" },
            { label: "Game CG", value: "gamecg" },
            { label: "Western", value: "western" },
            { label: "Non-H", value: "nonh" },
            { label: "Image Set", value: "imageset" },
            { label: "Cosplay", value: "cosplay" },
            { label: "Asian Porn", value: "asianporn" },
          ],
        },
        { key: "f_sh", kind: "switch" as const, label: "搜索 Expunged 内容" },
        { key: "f_sto", kind: "switch" as const, label: "只看有种子的画廊" },
        { key: "f_spf", kind: "text" as const, label: "最少页数" },
        { key: "f_spt", kind: "text" as const, label: "最多页数" },
        { key: "f_srdd", kind: "text" as const, label: "最低评分" },
        { key: "f_sfl", kind: "switch" as const, label: "禁用语言过滤" },
        { key: "f_sfu", kind: "switch" as const, label: "禁用上传者过滤" },
        { key: "f_sft", kind: "switch" as const, label: "禁用标签过滤" },
      ],
    },
    data: {
      values: {
        categories: selectedCategories,
        f_sh: boolOr(extern.f_sh, false),
        f_sto: boolOr(extern.f_sto, false),
        f_spf: String(extern.f_spf ?? ""),
        f_spt: String(extern.f_spt ?? ""),
        f_srdd: String(extern.f_srdd ?? ""),
        f_sfl: boolOr(extern.f_sfl, false),
        f_sfu: boolOr(extern.f_sfu, false),
        f_sft: boolOr(extern.f_sft, false),
      },
    },
  };
}

export async function startEhentaiWebLogin(
  _payload: Record<string, unknown> = {},
): Promise<Record<string, unknown>> {
  return {
    source: PLUGIN_SOURCE,
    data: {
      accepted: true,
      openUrl: EH_FORUM_LOGIN_URL,
      redirectWatchUrl: EH_FORUM_LOGIN_REDIRECT_URL,
      cookiePollIntervalMs: EH_COOKIE_POLL_INTERVAL_MS,
      ignoreCookieNames: ["cf_clearance"],
      setCookieFnPath: "setEhentaiForumCookie",
      action: {
        type: "openWeb",
        payload: {
          title: "E-Hentai 论坛登录",
          url: EH_FORUM_LOGIN_URL,
        },
      },
      message: "请在 WebView 登录后回传 cookie 到 setEhentaiForumCookie",
    },
  };
}

function asSetterPayload(payload: Record<string, unknown>): {
  extern: Record<string, unknown>;
  key: string;
  value: unknown;
} {
  return {
    extern: asRecord(payload.extern),
    key: String(payload.key ?? "").trim(),
    value: payload.value,
  };
}

function normalizeCookiePartValue(value: unknown, key: string): string {
  const raw = String(value ?? "").trim();
  const parsed = findCookieValue(raw, key);
  return parsed || raw;
}

async function setEhentaiCookiePart(
  payload: Record<string, unknown> = {},
  expectedKey: string,
): Promise<Record<string, unknown>> {
  const payloadMap = asRecord(payload);
  const { value, key } = asSetterPayload(payloadMap);
  if (key && key !== expectedKey) {
    console.warn(`[EH] ${expectedKey} setter received unexpected key: ${key}`);
  }
  const sanitizedValue = normalizeCookiePartValue(value, expectedKey);
  await saveCookiePart(expectedKey, sanitizedValue);
  resetExAccessProbeCache();
  return {
    source: PLUGIN_SOURCE,
    data: {
      ok: true,
      key: expectedKey,
      value: sanitizedValue,
      valuesPatch: {
        [expectedKey]: sanitizedValue,
      },
      message: sanitizedValue ? `已保存 ${expectedKey}` : `已清空 ${expectedKey}`,
    },
  };
}

export async function setEhentaiIpbMemberId(
  payload: Record<string, unknown> = {},
): Promise<Record<string, unknown>> {
  return setEhentaiCookiePart(payload, EH_MEMBER_ID_CONFIG_KEY);
}

export async function setEhentaiIpbPassHash(
  payload: Record<string, unknown> = {},
): Promise<Record<string, unknown>> {
  return setEhentaiCookiePart(payload, EH_PASS_HASH_CONFIG_KEY);
}

export async function setEhentaiIgneous(
  payload: Record<string, unknown> = {},
): Promise<Record<string, unknown>> {
  return setEhentaiCookiePart(payload, EH_IGNEOUS_CONFIG_KEY);
}

export async function setEhentaiForumCookie(
  payload: Record<string, unknown> = {},
): Promise<Record<string, unknown>> {
  const payloadMap = asRecord(payload);
  const { value, key } = asSetterPayload(payloadMap);

  const rawCookie =
    key === EH_FORUM_COOKIE_CONFIG_KEY || key === "cookie" || !key
      ? extractCookieFromPayload(payloadMap) || String(value ?? "").trim()
      : String(value ?? "").trim();

  const sanitizedIncomingCookie = removeCookieNames(rawCookie, ["igneous", "cf_clearance"]);
  const incomingCookieNames = extractCookieNames(String(rawCookie ?? ""));
  console.log(
    "[EH] setEhentaiForumCookie incoming",
    incomingCookieNames.length,
    incomingCookieNames,
  );

  const memberId = findCookieValue(sanitizedIncomingCookie, "ipb_member_id");
  const passHash = findCookieValue(sanitizedIncomingCookie, "ipb_pass_hash");

  await Promise.all([
    saveCookiePart(EH_MEMBER_ID_CONFIG_KEY, memberId),
    saveCookiePart(EH_PASS_HASH_CONFIG_KEY, passHash),
    saveCookiePart(EH_IGNEOUS_CONFIG_KEY, ""),
  ]);

  const persistedCookieNames = extractCookieNames(sanitizedIncomingCookie).filter(
    (name) => name === "ipb_member_id" || name === "ipb_pass_hash",
  );
  console.log(
    "[EH] setEhentaiForumCookie persisted",
    persistedCookieNames.length,
    persistedCookieNames,
  );

  resetExAccessProbeCache();

  return {
    source: PLUGIN_SOURCE,
    data: {
      ok: true,
      valuesPatch: {
        [EH_MEMBER_ID_CONFIG_KEY]: memberId,
        [EH_PASS_HASH_CONFIG_KEY]: passHash,
        [EH_IGNEOUS_CONFIG_KEY]: "",
      },
      message:
        memberId && passHash
          ? "已保存论坛 cookie"
          : "未检测到有效的论坛 cookie（已过滤 cf_clearance / igneous）",
    },
  };
}

export async function init() {
  await migrateLegacyForumCookieIfNeeded();
  // Proactively resolve EX igneous (or fall back to EH) on plugin load so the
  // user does not have to trigger a request first.
  await readSettings(undefined, { skipExProbe: false });
  return {};
}

export default {
  init,
  getInfo,
  getFunctionPage,
  getLatestData,
  getPopularData,
  getRankingData,
  getRankingFilterBundle,
  searchComic,
  getComicDetail,
  getChapter,
  getReadSnapshot,
  fetchImageBytes,
  getSettingsBundle,
  getAdvancedSearchScheme,
  getCapabilitiesBundle,
  startEhentaiWebLogin,
  setEhentaiForumCookie,
  setEhentaiIpbMemberId,
  setEhentaiIpbPassHash,
  setEhentaiIgneous,
};
