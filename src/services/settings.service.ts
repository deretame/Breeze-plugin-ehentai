import {
  DEFAULT_SETTINGS,
  EH_FORUM_COOKIE_CONFIG_KEY,
  EX_BASE_URL,
} from "../domain/constants";
import type { SettingsBundleContract } from "../domain/contracts";
import type { PluginSettings, SiteSetting } from "../domain/types";
import { mapSettingsBundle } from "../mappers/settings.mapper";
import { httpClient, type HttpTextResponseMeta } from "../network/client";
import { pluginConfig } from "../tools";
import { asRecord, validateSettingsInput } from "../utils/guards";

const COOKIE_NAME_BLACKLIST = new Set(["cf_clearance"]);
const EX_AUTH_REDIRECT_ALLOWED_HOSTS = new Set([
  "exhentai.org",
  "forums.e-hentai.org",
]);
const EX_AUTH_REDIRECT_MAX_STEPS = 6;

let exAccessDeniedCached = false;

function decodeConfigString(raw: unknown, fallback = ""): string {
  if (raw === undefined || raw === null) {
    return fallback;
  }
  if (typeof raw === "object") {
    const map = raw as Record<string, unknown>;
    if (map.ok === true && "value" in map) {
      return decodeConfigString(map.value, fallback);
    }
    return fallback;
  }
  const text = String(raw);
  if (!text.trim()) {
    return fallback;
  }
  try {
    const parsed = JSON.parse(text.trim());
    if (
      parsed &&
      typeof parsed === "object" &&
      (parsed as Record<string, unknown>).ok === true &&
      "value" in (parsed as Record<string, unknown>)
    ) {
      return decodeConfigString(
        (parsed as Record<string, unknown>).value,
        fallback,
      );
    }
    if (
      typeof parsed === "string" ||
      typeof parsed === "number" ||
      typeof parsed === "boolean"
    ) {
      return String(parsed);
    }
  } catch {
    // noop
  }
  return text;
}

function splitCookiePair(
  rawPair: string,
): { name: string; value: string } | null {
  const token = String(rawPair ?? "").trim();
  if (!token) {
    return null;
  }
  const separator = token.indexOf("=");
  if (separator <= 0) {
    return null;
  }
  const name = token.slice(0, separator).trim();
  const value = token.slice(separator + 1).trim();
  if (!name) {
    return null;
  }
  return { name, value };
}

export function removeCookieNames(
  rawCookie: unknown,
  cookieNames: string[],
): string {
  const normalized = sanitizeForumCookie(rawCookie);
  if (!normalized) {
    return "";
  }

  const denyList = new Set(
    (Array.isArray(cookieNames) ? cookieNames : [])
      .map((item) =>
        String(item ?? "")
          .trim()
          .toLowerCase(),
      )
      .filter(Boolean),
  );
  if (!denyList.size) {
    return normalized;
  }

  return normalized
    .split(";")
    .map((item) => item.trim())
    .filter(Boolean)
    .map((token) => splitCookiePair(token))
    .filter((pair): pair is { name: string; value: string } => Boolean(pair))
    .filter((pair) => !denyList.has(pair.name.toLowerCase()))
    .map((pair) => `${pair.name}=${pair.value}`)
    .join("; ");
}

function findCookieValue(rawCookie: string, name: string): string {
  const normalized = sanitizeForumCookie(rawCookie);
  if (!normalized) {
    return "";
  }
  const target = name.toLowerCase();
  const tokens = normalized
    .split(";")
    .map((item) => item.trim())
    .filter(Boolean);
  for (const token of tokens) {
    const pair = splitCookiePair(token);
    if (!pair) {
      continue;
    }
    if (pair.name.toLowerCase() === target) {
      return pair.value;
    }
  }
  return "";
}

function readHeaderValue(
  headers: HttpTextResponseMeta["headers"],
  name: string,
): string {
  const raw = headers[name.toLowerCase()];
  if (Array.isArray(raw)) {
    return String(raw[0] ?? "").trim();
  }
  return String(raw ?? "").trim();
}

function readSetCookiePairs(
  headers: HttpTextResponseMeta["headers"],
): string[] {
  const raw = headers["set-cookie"];
  const setCookieEntries = Array.isArray(raw)
    ? raw
    : typeof raw === "string"
      ? [raw]
      : [];
  const pairs: string[] = [];
  for (const entry of setCookieEntries) {
    const firstToken =
      String(entry ?? "")
        .split(";")[0]
        ?.trim() ?? "";
    const pair = splitCookiePair(firstToken);
    if (!pair) {
      continue;
    }
    pairs.push(`${pair.name}=${pair.value}`);
  }
  return pairs;
}

function mergeCookiePairs(baseCookie: string, pairs: string[]): string {
  if (!pairs.length) {
    return sanitizeForumCookie(baseCookie);
  }
  return sanitizeForumCookie([baseCookie, ...pairs].join("; "));
}

function resolveRedirectUrl(location: string, currentUrl: string): string {
  const rawLocation = String(location ?? "").trim();
  if (!rawLocation) {
    return "";
  }
  let parsed: URL;
  try {
    parsed = new URL(rawLocation, currentUrl);
  } catch {
    return "";
  }
  if (parsed.protocol !== "https:") {
    return "";
  }
  if (!EX_AUTH_REDIRECT_ALLOWED_HOSTS.has(parsed.hostname)) {
    return "";
  }
  return parsed.toString();
}

async function tryResolveExhentaiIgneous(rawCookie: string): Promise<string> {
  let currentCookie = sanitizeForumCookie(rawCookie);
  if (!currentCookie) {
    return currentCookie;
  }

  let currentUrl = EX_BASE_URL;
  for (let step = 0; step < EX_AUTH_REDIRECT_MAX_STEPS; step += 1) {
    const response = await httpClient.getTextWithMeta(currentUrl, {
      headers: { Cookie: currentCookie },
    });

    const setCookiePairs = readSetCookiePairs(response.headers);
    currentCookie = mergeCookiePairs(currentCookie, setCookiePairs);

    if (findCookieValue(currentCookie, "igneous")) {
      return await saveForumCookie(currentCookie);
    }

    if (step === 0 && response.status === 200 && !response.data.trim()) {
      exAccessDeniedCached = true;
      return sanitizeForumCookie(rawCookie);
    }

    if (response.status !== 302) {
      return currentCookie;
    }

    const nextUrl = resolveRedirectUrl(
      readHeaderValue(response.headers, "location"),
      currentUrl,
    );
    if (!nextUrl) {
      return currentCookie;
    }
    currentUrl = nextUrl;
  }

  return currentCookie;
}

async function maybeRefreshExhentaiCookie(
  site: SiteSetting,
  forumCookie: string,
): Promise<string> {
  const normalizedCookie = sanitizeForumCookie(forumCookie);
  if (site !== "EX" || !normalizedCookie) {
    return normalizedCookie;
  }
  if (findCookieValue(normalizedCookie, "igneous")) {
    return normalizedCookie;
  }
  if (exAccessDeniedCached) {
    return normalizedCookie;
  }
  try {
    return await tryResolveExhentaiIgneous(normalizedCookie);
  } catch (error) {
    console.warn("[EH] EX igneous refresh failed", error);
    return normalizedCookie;
  }
}

export function sanitizeForumCookie(rawCookie: unknown): string {
  const raw = String(rawCookie ?? "").trim();
  if (!raw) {
    return "";
  }

  const pairs = new Map<string, string>();
  const tokens = raw
    .split(";")
    .map((item) => item.trim())
    .filter(Boolean);

  for (const token of tokens) {
    const pair = splitCookiePair(token);
    if (!pair) {
      continue;
    }
    if (COOKIE_NAME_BLACKLIST.has(pair.name.toLowerCase())) {
      continue;
    }
    pairs.set(pair.name, pair.value);
  }

  return Array.from(pairs.entries())
    .map(([name, value]) => `${name}=${value}`)
    .join("; ");
}

export function buildRequestHeaders(
  settings: PluginSettings,
): Record<string, string> {
  const cookie = sanitizeForumCookie(settings.forumCookie);
  if (!cookie) {
    return {};
  }
  return { Cookie: cookie };
}

export function buildRequestConfig(
  settings: PluginSettings,
): { headers: Record<string, string> } | undefined {
  const headers = buildRequestHeaders(settings);
  if (!Object.keys(headers).length) {
    return undefined;
  }
  return { headers };
}

async function loadConfigString(key: string, fallback = ""): Promise<string> {
  try {
    const raw = await pluginConfig.load(key, fallback);
    const normalized = decodeConfigString(raw, fallback);
    const currentRaw =
      typeof raw === "string" ? raw : raw == null ? "" : String(raw);
    if (currentRaw !== normalized) {
      try {
        await pluginConfig.save(key, normalized);
      } catch {
        // ignore normalize write errors
      }
    }
    return normalized;
  } catch {
    return fallback;
  }
}

export async function saveForumCookie(rawCookie: unknown): Promise<string> {
  const cookie = sanitizeForumCookie(rawCookie);
  try {
    await pluginConfig.save(EH_FORUM_COOKIE_CONFIG_KEY, cookie);
  } catch {
    // In local tests there is no host bridge; keep graceful fallback.
  }
  return cookie;
}

export function resetExAccessProbeCache(): void {
  exAccessDeniedCached = false;
}

function readExternString(
  extern: Record<string, unknown>,
  key: string,
): string {
  if (extern[key] === undefined || extern[key] === null) {
    return "";
  }
  return String(extern[key] ?? "").trim();
}

export async function readSettings(
  extern?: Record<string, unknown>,
): Promise<PluginSettings> {
  const externMap = asRecord(extern);
  const [storedSite, storedImageProxyEnabled, storedForumCookie] =
    await Promise.all([
      loadConfigString("site", DEFAULT_SETTINGS.site),
      loadConfigString(
        "imageProxyEnabled",
        String(DEFAULT_SETTINGS.imageProxyEnabled),
      ),
      loadConfigString(
        EH_FORUM_COOKIE_CONFIG_KEY,
        DEFAULT_SETTINGS.forumCookie,
      ),
    ]);

  const merged = {
    site: readExternString(externMap, "site") || storedSite,
    imageProxyEnabled:
      externMap.imageProxyEnabled !== undefined
        ? externMap.imageProxyEnabled
        : storedImageProxyEnabled,
    forumCookie:
      readExternString(externMap, EH_FORUM_COOKIE_CONFIG_KEY) ||
      readExternString(externMap, "cookie") ||
      storedForumCookie,
  };

  const settings = validateSettingsInput(merged);
  const forumCookie = await maybeRefreshExhentaiCookie(
    settings.site,
    settings.forumCookie,
  );
  return {
    ...settings,
    forumCookie: sanitizeForumCookie(forumCookie),
  };
}

export async function getSettingsBundleService(
  extern?: Record<string, unknown>,
): Promise<SettingsBundleContract> {
  const values = await readSettings(extern);
  return mapSettingsBundle(values);
}
