import { EH_BASE_URL, EX_BASE_URL } from "../domain/constants";
import type { SiteSetting } from "../domain/types";
import { splitComicId } from "../utils/guards";
import { validationError } from "../errors/plugin-error";
import { ensureAllowedHostUrl } from "../utils/url";

function resolveSiteBase(site: SiteSetting): string {
  return site === "EX" ? EX_BASE_URL : EH_BASE_URL;
}

export function buildSearchEndpoint(
  keyword: string,
  page: number,
  site: SiteSetting,
  extraQuery?: Record<string, unknown>,
): string {
  const url = new URL("/", resolveSiteBase(site));
  url.searchParams.set("f_search", keyword);
  for (const [key, rawValue] of Object.entries(extraQuery ?? {})) {
    if (rawValue === undefined || rawValue === null) {
      continue;
    }
    const value = String(rawValue).trim();
    if (!value) {
      continue;
    }
    url.searchParams.set(key, value);
  }
  if (page > 1) {
    url.searchParams.set("page", String(page - 1));
  }
  return ensureAllowedHostUrl(url.toString());
}

export function buildSearchNavigationEndpoint(navigationUrl: string, site: SiteSetting): string {
  return ensureAllowedHostUrl(navigationUrl, resolveSiteBase(site));
}

export function buildDetailEndpoint(comicId: string, site: SiteSetting, page = 0): string {
  const { gid, token } = splitComicId(comicId);
  if (!gid || !token) {
    throw validationError("comicId format is invalid");
  }
  const url = new URL(`/g/${gid}/${token}/`, resolveSiteBase(site));
  if (page > 0) {
    url.searchParams.set("p", String(page));
  }
  return ensureAllowedHostUrl(url.toString());
}

export function buildImagePageEndpoint(imagePageUrl: string, reloadKey?: string): string {
  const url = new URL(ensureAllowedHostUrl(imagePageUrl));
  const normalizedReloadKey = String(reloadKey ?? "").trim();
  if (normalizedReloadKey) {
    url.searchParams.set("nl", normalizedReloadKey);
  }
  return ensureAllowedHostUrl(url.toString());
}
