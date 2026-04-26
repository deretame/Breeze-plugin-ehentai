import {
  DEFAULT_SETTINGS,
  EH_FORUM_COOKIE_CONFIG_KEY,
} from "../domain/constants";
import type { SettingsBundleContract } from "../domain/contracts";
import type { PluginSettings } from "../domain/types";
import { mapSettingsBundle } from "../mappers/settings.mapper";
import { pluginConfig } from "../tools";
import { asRecord, validateSettingsInput } from "../utils/guards";

const COOKIE_NAME_BLACKLIST = new Set(["cf_clearance"]);

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
  console.log("readSettings extern", extern);
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
  return {
    ...settings,
    forumCookie: sanitizeForumCookie(settings.forumCookie),
  };
}

export async function getSettingsBundleService(
  extern?: Record<string, unknown>,
): Promise<SettingsBundleContract> {
  const values = await readSettings(extern);
  return mapSettingsBundle(values);
}
