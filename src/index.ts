import {
  EH_COOKIE_POLL_INTERVAL_MS,
  EH_FORUM_LOGIN_REDIRECT_URL,
  EH_FORUM_LOGIN_URL,
  PLUGIN_SOURCE,
} from "./domain/constants";
import type {
  ChapterContentContract,
  ComicDetailContract,
  InfoContract,
  ReadSnapshotContract,
  SearchResultContract,
  SettingsBundleContract,
} from "./domain/contracts";
import type {
  ChapterPayload,
  ComicDetailPayload,
  FetchImageBytesPayload,
  SearchComicPayload,
} from "./domain/types";
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
  getSettingsBundleService,
  readSettings,
  removeCookieNames,
  resetExAccessProbeCache,
  sanitizeForumCookie,
  saveForumCookie,
} from "./services/settings.service";
import { asRecord } from "./utils/guards";

function extractCookieFromPayload(payload: Record<string, unknown>): string {
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

function countCookiePairs(cookie: string): number {
  const normalized = sanitizeForumCookie(cookie);
  if (!normalized) {
    return 0;
  }
  return normalized
    .split(";")
    .map((item) => item.trim())
    .filter(Boolean).length;
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

export async function fetchImageBytes(payload: FetchImageBytesPayload = {}) {
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
): Promise<Record<string, unknown>> {
  return getFunctionPage({
    ...payload,
    extern: { ...payload.extern, source: "latest" },
  });
}

export async function getPopularData(
  payload: SearchComicPayload = {},
): Promise<Record<string, unknown>> {
  return getFunctionPage({
    ...payload,
    extern: { ...payload.extern, source: "popular" },
  });
}

export async function getRankingData(
  payload: SearchComicPayload = {},
): Promise<Record<string, unknown>> {
  return getFunctionPage({
    ...payload,
    extern: { ...payload.extern, source: "ranking" },
  });
}

export async function getFunctionPage(
  payload: Record<string, unknown> = {},
): Promise<Record<string, unknown>> {
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
      extern: mapped.extern,
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
          nextUrl: mapped.extern.nextUrl,
          prevUrl: mapped.extern.prevUrl,
        },
      },
    };
  } catch (error) {
    throw normalizeError(error);
  }
}

export async function getRankingFilterBundle(): Promise<Record<string, unknown>> {
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
      defaults: {
        rankType: "day",
      },
    },
  };
}

export async function getSettingsBundle(): Promise<SettingsBundleContract> {
  return getSettingsBundleService();
}

export async function getCapabilitiesBundle(): Promise<Record<string, unknown>> {
  return {
    source: PLUGIN_SOURCE,
    scheme: {
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
): Promise<Record<string, unknown>> {
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

  const result = {
    source: PLUGIN_SOURCE,
    scheme: {
      version: "1.0.0",
      type: "advancedSearch",
      title: "高级搜索",
      fields: [
        {
          key: "categories",
          kind: "multiChoice",
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
        { key: "f_sh", kind: "switch", label: "搜索 Expunged 内容" },
        { key: "f_sto", kind: "switch", label: "只看有种子的画廊" },
        { key: "f_spf", kind: "text", label: "最少页数" },
        { key: "f_spt", kind: "text", label: "最多页数" },
        { key: "f_srdd", kind: "text", label: "最低评分" },
        { key: "f_sfl", kind: "switch", label: "禁用语言过滤" },
        { key: "f_sfu", kind: "switch", label: "禁用上传者过滤" },
        { key: "f_sft", kind: "switch", label: "禁用标签过滤" },
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
  return result;
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

export async function setEhentaiForumCookie(
  payload: Record<string, unknown> = {},
): Promise<Record<string, unknown>> {
  const payloadMap = asRecord(payload);
  const rawCookie = extractCookieFromPayload(payloadMap);
  const sanitizedIncomingCookie = removeCookieNames(rawCookie, ["igneous", "cf_clearance"]);
  const incomingCookieNames = extractCookieNames(String(rawCookie ?? ""));
  console.log(
    "[EH] setEhentaiForumCookie incoming",
    incomingCookieNames.length,
    incomingCookieNames,
  );
  const sanitizedCookie = await saveForumCookie(sanitizedIncomingCookie);
  const cookieCount = countCookiePairs(sanitizedCookie);
  const persistedCookieNames = extractCookieNames(sanitizedCookie);
  console.log(
    "[EH] setEhentaiForumCookie persisted",
    persistedCookieNames.length,
    persistedCookieNames,
  );

  if (!sanitizedCookie || cookieCount <= 0) {
    throw new Error("未检测到可用 cookie（已过滤 cf_clearance）");
  }

  resetExAccessProbeCache();

  return {
    source: PLUGIN_SOURCE,
    data: {
      ok: true,
      cookie: sanitizedCookie,
      cookieCount,
      ignoredCookieNames: ["cf_clearance"],
      valuesPatch: {
        forumCookie: sanitizedCookie,
      },
      message: `已保存 ${cookieCount} 条论坛 cookie`,
    },
  };
}

export async function setEhentaiManualCookie(
  payload: Record<string, unknown> = {},
): Promise<Record<string, unknown>> {
  const payloadMap = asRecord(payload);
  const rawCookie = extractCookieFromPayload(payloadMap);
  const sanitizedIncomingCookie = removeCookieNames(rawCookie, ["cf_clearance"]);
  const sanitizedCookie = await saveForumCookie(sanitizedIncomingCookie);
  const cookieCount = countCookiePairs(sanitizedCookie);
  const persistedCookieNames = extractCookieNames(sanitizedCookie);
  console.log(
    "[EH] setEhentaiManualCookie persisted",
    persistedCookieNames.length,
    persistedCookieNames,
  );

  resetExAccessProbeCache();

  return {
    source: PLUGIN_SOURCE,
    data: {
      ok: true,
      cookie: sanitizedCookie,
      cookieCount,
      valuesPatch: {
        forumCookie: sanitizedCookie,
      },
      message: cookieCount ? `已保存 ${cookieCount} 条 cookie` : "cookie 已清空",
    },
  };
}

export async function init() {
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
  setEhentaiManualCookie,
};
