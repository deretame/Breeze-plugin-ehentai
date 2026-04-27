import type { PluginSettings, SiteSetting } from "../domain/types";
import { buildRequestConfig, removeCookieNames } from "./settings.service";
import { asRecord } from "../utils/guards";

export type RequestConfig = { headers: Record<string, string> } | undefined;
export const EH_UNAVAILABLE_EXTERN_KEY = "ehUnavailable";

export type SiteAttempt = {
  site: SiteSetting;
  requestConfig: RequestConfig;
};

function toBoolean(value: unknown): boolean {
  if (typeof value === "boolean") {
    return value;
  }
  const text = String(value ?? "").trim().toLowerCase();
  return text === "1" || text === "true" || text === "yes";
}

export function readEhUnavailableExtern(
  extern?: Record<string, unknown>,
): boolean {
  const externMap = asRecord(extern);
  return toBoolean(externMap[EH_UNAVAILABLE_EXTERN_KEY]);
}

export function buildRoutingExtern(
  ehUnavailable: boolean,
): Record<string, unknown> {
  if (!ehUnavailable) {
    return {};
  }
  return {
    [EH_UNAVAILABLE_EXTERN_KEY]: true,
  };
}

export function buildNonSearchSiteAttempts(
  settings: PluginSettings,
  extern?: Record<string, unknown>,
): SiteAttempt[] {
  if (settings.site !== "EX") {
    return [
      {
        site: settings.site,
        requestConfig: buildRequestConfig(settings),
      },
    ];
  }

  if (readEhUnavailableExtern(extern)) {
    return [
      {
        site: "EX",
        requestConfig: buildRequestConfig(settings),
      },
    ];
  }

  const ehFirstSettings: PluginSettings = {
    ...settings,
    site: "EH",
    forumCookie: removeCookieNames(settings.forumCookie, ["igneous"]),
  };

  return [
    {
      site: "EH",
      requestConfig: buildRequestConfig(ehFirstSettings),
    },
    {
      site: "EX",
      requestConfig: buildRequestConfig(settings),
    },
  ];
}

export function remapGalleryHostForSite(
  input: string,
  site: SiteSetting,
): string {
  const raw = String(input ?? "").trim();
  if (!raw) {
    return raw;
  }

  try {
    const parsed = new URL(raw);
    if (site === "EH" && parsed.hostname === "exhentai.org") {
      parsed.hostname = "e-hentai.org";
    } else if (site === "EX" && parsed.hostname === "e-hentai.org") {
      parsed.hostname = "exhentai.org";
    }
    return parsed.toString();
  } catch {
    return raw;
  }
}
