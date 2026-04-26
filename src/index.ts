import type {
  ChapterContentContract,
  ComicDetailContract,
  FetchImageBytesContract,
  InfoContract,
  ReadPagesCompatContract,
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
import {
  EH_COOKIE_POLL_INTERVAL_MS,
  EH_FORUM_LOGIN_REDIRECT_URL,
  EH_FORUM_LOGIN_URL,
  PLUGIN_SOURCE,
} from "./domain/constants";
import { normalizeError } from "./errors/normalize-error";
import {
  getChapterService,
  getReadPagesService,
} from "./services/chapter.service";
import { getComicDetailService } from "./services/detail.service";
import { fetchImageBytesService } from "./services/image.service";
import { getInfoService } from "./services/info.service";
import { getReadSnapshotService } from "./services/read-snapshot.service";
import { searchComicService } from "./services/search.service";
import {
  getSettingsBundleService,
  readSettings,
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

export async function searchComic(
  payload: SearchComicPayload = {},
): Promise<SearchResultContract> {
  console.log("searchComic payload", payload);
  try {
    const settings = await readSettings(payload.extern);
    return await searchComicService(payload, settings);
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

export async function getChapter(
  payload: ChapterPayload = {},
): Promise<ChapterContentContract> {
  try {
    const settings = await readSettings(payload.extern);
    return await getChapterService(payload, settings);
  } catch (error) {
    throw normalizeError(error);
  }
}

export async function getReadPages(
  payload: ChapterPayload = {},
): Promise<ReadPagesCompatContract> {
  try {
    const settings = await readSettings(payload.extern);
    return await getReadPagesService(payload, settings);
  } catch (error) {
    throw normalizeError(error);
  }
}

export async function getReadSnapshot(
  payload: ChapterPayload = {},
): Promise<ReadSnapshotContract> {
  try {
    const settings = await readSettings(payload.extern);
    return await getReadSnapshotService(payload, settings);
  } catch (error) {
    throw normalizeError(error);
  }
}

export async function fetchImageBytes(
  payload: FetchImageBytesPayload = {},
): Promise<FetchImageBytesContract> {
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

export async function getSettingsBundle(): Promise<SettingsBundleContract> {
  return getSettingsBundleService();
}

export async function getCapabilitiesBundle(): Promise<
  Record<string, unknown>
> {
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

export async function startEhentaiWebLogin(
  payload: Record<string, unknown> = {},
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
  const incomingCookieNames = extractCookieNames(String(rawCookie ?? ""));
  console.log(
    "[EH] setEhentaiForumCookie incoming",
    incomingCookieNames.length,
    incomingCookieNames,
  );
  const sanitizedCookie = await saveForumCookie(rawCookie);
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

export default {
  getInfo,
  searchComic,
  getComicDetail,
  getChapter,
  getReadPages,
  getReadSnapshot,
  fetchImageBytes,
  getSettingsBundle,
  getCapabilitiesBundle,
  startEhentaiWebLogin,
  setEhentaiForumCookie,
};
