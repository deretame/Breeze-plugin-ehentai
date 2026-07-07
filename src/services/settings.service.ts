import { flutterTools, pluginConfig, SettingsBundleContract } from "breeze-plugin-kit";
import {
  DEFAULT_SETTINGS,
  EH_FORUM_COOKIE_CONFIG_KEY,
  EH_IGNEOUS_CONFIG_KEY,
  EH_MEMBER_ID_CONFIG_KEY,
  EH_PASS_HASH_CONFIG_KEY,
  EX_BASE_URL,
} from "../domain/constants";
import type { PluginSettings } from "../domain/types";
import { mapSettingsBundle } from "../mappers/settings.mapper";
import { httpClient, type HttpTextResponseMeta } from "../network/client";
import { asRecord, validateSettingsInput } from "../utils/guards";

const COOKIE_NAME_BLACKLIST = new Set(["cf_clearance"]);
const EX_AUTH_REDIRECT_ALLOWED_HOSTS = new Set(["exhentai.org", "forums.e-hentai.org"]);
const EX_AUTH_REDIRECT_MAX_STEPS = 6;
const IGNEOUS_PLACEHOLDER_VALUES = new Set(["mystery"]);

let exAccessDeniedCached = false;
let exFallbackNotified = false;

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
      return decodeConfigString((parsed as Record<string, unknown>).value, fallback);
    }
    if (typeof parsed === "string" || typeof parsed === "number" || typeof parsed === "boolean") {
      return String(parsed);
    }
  } catch {
    // noop
  }
  return text;
}

function splitCookiePair(rawPair: string): { name: string; value: string } | null {
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

export function removeCookieNames(rawCookie: unknown, cookieNames: string[]): string {
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

export function findCookieValue(rawCookie: string, name: string): string {
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

function hasUsableIgneous(rawCookie: string): boolean {
  const value = findCookieValue(rawCookie, "igneous").trim().toLowerCase();
  if (!value) {
    return false;
  }
  if (IGNEOUS_PLACEHOLDER_VALUES.has(value)) {
    return false;
  }
  return true;
}

function readHeaderValue(headers: HttpTextResponseMeta["headers"], name: string): string {
  const raw = headers[name.toLowerCase()];
  if (Array.isArray(raw)) {
    return String(raw[0] ?? "").trim();
  }
  return String(raw ?? "").trim();
}

function readSetCookiePairs(headers: HttpTextResponseMeta["headers"]): string[] {
  const raw = headers["set-cookie"];
  const setCookieEntries = Array.isArray(raw) ? raw : typeof raw === "string" ? [raw] : [];
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

    if (step === 0 && response.status === 200 && !response.data.trim()) {
      exAccessDeniedCached = true;
      return removeCookieNames(currentCookie, ["igneous"]);
    }

    if (hasUsableIgneous(currentCookie)) {
      await saveCookiePart(EH_IGNEOUS_CONFIG_KEY, findCookieValue(currentCookie, "igneous"));
      return currentCookie;
    }

    if (response.status !== 302) {
      return currentCookie;
    }

    const nextUrl = resolveRedirectUrl(readHeaderValue(response.headers, "location"), currentUrl);
    if (!nextUrl) {
      return currentCookie;
    }
    currentUrl = nextUrl;
  }

  return currentCookie;
}

async function maybeRefreshExhentaiCookie(settings: PluginSettings): Promise<PluginSettings> {
  const normalizedCookie = sanitizeForumCookie(settings.forumCookie);
  if (settings.site !== "EX" || !normalizedCookie) {
    return settings;
  }

  if (hasUsableIgneous(normalizedCookie)) {
    return settings;
  }
  if (exAccessDeniedCached) {
    await saveCookiePart(EH_IGNEOUS_CONFIG_KEY, "");
    return validateSettingsInput({ ...settings, igneous: "" });
  }
  try {
    const resolvedCookie = await tryResolveExhentaiIgneous(normalizedCookie);
    return validateSettingsInput({
      ...settings,
      ipb_member_id: findCookieValue(resolvedCookie, "ipb_member_id") || settings.ipb_member_id,
      ipb_pass_hash: findCookieValue(resolvedCookie, "ipb_pass_hash") || settings.ipb_pass_hash,
      igneous: findCookieValue(resolvedCookie, "igneous"),
    });
  } catch (error) {
    console.warn("[EH] EX igneous refresh failed", error);
    return settings;
  }
}

async function fallbackToEhIfExAccessDenied(settings: PluginSettings): Promise<PluginSettings> {
  if (settings.site !== "EX" || !exAccessDeniedCached) {
    return settings;
  }

  try {
    await pluginConfig.save("site", "EH");
  } catch {
    // ignore persist failure and still fallback for current request
  }

  if (!exFallbackNotified) {
    exFallbackNotified = true;
    try {
      await flutterTools.showToast({
        message: "ehentai 无里站权限，已回退",
        level: "warning",
      });
    } catch {
      // ignore toast failure
    }
  }

  return {
    ...settings,
    site: "EH",
  };
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

export function buildRequestHeaders(settings: PluginSettings): Record<string, string> {
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
    const currentRaw = typeof raw === "string" ? raw : raw == null ? "" : String(raw);
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

export function buildForumCookie(parts: {
  ipb_member_id?: string;
  ipb_pass_hash?: string;
  igneous?: string;
}): string {
  const pairs = [
    parts.ipb_member_id ? `ipb_member_id=${parts.ipb_member_id}` : "",
    parts.ipb_pass_hash ? `ipb_pass_hash=${parts.ipb_pass_hash}` : "",
    parts.igneous ? `igneous=${parts.igneous}` : "",
  ].filter(Boolean);
  return sanitizeForumCookie(pairs.join("; "));
}

export async function saveCookiePart(key: string, rawValue: unknown): Promise<string> {
  const value = String(rawValue ?? "").trim();
  try {
    await pluginConfig.save(key, value);
  } catch {
    // In local tests there is no host bridge; keep graceful fallback.
  }
  return value;
}

export function resetExAccessProbeCache(): void {
  exAccessDeniedCached = false;
  exFallbackNotified = false;
}

export async function migrateLegacyForumCookieIfNeeded(): Promise<boolean> {
  const [legacyForumCookie, memberId, passHash, igneous] = await Promise.all([
    loadConfigString(EH_FORUM_COOKIE_CONFIG_KEY, ""),
    loadConfigString(EH_MEMBER_ID_CONFIG_KEY, ""),
    loadConfigString(EH_PASS_HASH_CONFIG_KEY, ""),
    loadConfigString(EH_IGNEOUS_CONFIG_KEY, ""),
  ]);

  if (!legacyForumCookie) {
    return false;
  }
  if (memberId || passHash || igneous) {
    return false;
  }

  const legacyMemberId = findCookieValue(legacyForumCookie, "ipb_member_id");
  const legacyPassHash = findCookieValue(legacyForumCookie, "ipb_pass_hash");
  const legacyIgneous = findCookieValue(legacyForumCookie, "igneous");

  await Promise.all([
    legacyMemberId ? saveCookiePart(EH_MEMBER_ID_CONFIG_KEY, legacyMemberId) : Promise.resolve(),
    legacyPassHash ? saveCookiePart(EH_PASS_HASH_CONFIG_KEY, legacyPassHash) : Promise.resolve(),
    legacyIgneous ? saveCookiePart(EH_IGNEOUS_CONFIG_KEY, legacyIgneous) : Promise.resolve(),
  ]);

  try {
    await pluginConfig.save(EH_FORUM_COOKIE_CONFIG_KEY, "");
  } catch {
    // ignore clear failure
  }

  return true;
}

function readExternString(extern: Record<string, unknown>, key: string): string {
  if (extern[key] === undefined || extern[key] === null) {
    return "";
  }
  return String(extern[key] ?? "").trim();
}

export async function readSettings(
  extern?: Record<string, unknown>,
  options?: { skipExProbe?: boolean },
): Promise<PluginSettings> {
  const externMap = asRecord(extern);
  const [storedSite, storedImageProxyEnabled, storedMemberId, storedPassHash, storedIgneous] =
    await Promise.all([
      loadConfigString("site", DEFAULT_SETTINGS.site),
      loadConfigString("imageProxyEnabled", String(DEFAULT_SETTINGS.imageProxyEnabled)),
      loadConfigString(EH_MEMBER_ID_CONFIG_KEY, DEFAULT_SETTINGS.ipb_member_id),
      loadConfigString(EH_PASS_HASH_CONFIG_KEY, DEFAULT_SETTINGS.ipb_pass_hash),
      loadConfigString(EH_IGNEOUS_CONFIG_KEY, DEFAULT_SETTINGS.igneous),
    ]);

  const merged = {
    site: readExternString(externMap, "site") || storedSite,
    imageProxyEnabled:
      externMap.imageProxyEnabled !== undefined
        ? externMap.imageProxyEnabled
        : storedImageProxyEnabled,
    ipb_member_id: readExternString(externMap, EH_MEMBER_ID_CONFIG_KEY) || storedMemberId,
    ipb_pass_hash: readExternString(externMap, EH_PASS_HASH_CONFIG_KEY) || storedPassHash,
    igneous: readExternString(externMap, EH_IGNEOUS_CONFIG_KEY) || storedIgneous,
  };

  // Backward compatibility: legacy extern aggregate cookie overrides parts.
  const legacyExternCookie =
    readExternString(externMap, EH_FORUM_COOKIE_CONFIG_KEY) ||
    readExternString(externMap, "cookie");
  if (legacyExternCookie) {
    merged.ipb_member_id =
      findCookieValue(legacyExternCookie, "ipb_member_id") || merged.ipb_member_id;
    merged.ipb_pass_hash =
      findCookieValue(legacyExternCookie, "ipb_pass_hash") || merged.ipb_pass_hash;
    merged.igneous = findCookieValue(legacyExternCookie, "igneous") || merged.igneous;
  }

  let settings = validateSettingsInput(merged);
  settings = { ...settings, forumCookie: buildForumCookie(settings) };

  if (!options?.skipExProbe) {
    settings = await maybeRefreshExhentaiCookie(settings);
    settings = { ...settings, forumCookie: buildForumCookie(settings) };
    settings = await fallbackToEhIfExAccessDenied(settings);
  }

  return {
    ...settings,
    forumCookie: buildForumCookie(settings),
  };
}

export async function getSettingsBundleService(
  extern?: Record<string, unknown>,
): Promise<SettingsBundleContract> {
  const values = await readSettings(extern, { skipExProbe: true });
  return mapSettingsBundle(values);
}
