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

export function buildFavoritesEndpoint(
  site: SiteSetting,
  options?: { favcat?: string; sort?: string },
): string {
  const url = new URL("/favorites.php", resolveSiteBase(site));
  const favcat = String(options?.favcat ?? "")
    .trim()
    .toLowerCase();
  if (favcat && favcat !== "a" && favcat !== "all") {
    url.searchParams.set("favcat", favcat);
  }
  const sort = String(options?.sort ?? "")
    .trim()
    .toLowerCase();
  if (sort && sort !== "f") {
    url.searchParams.set("inline_set", `fs_${sort}`);
  }
  // 注意：e-hentai / exhentai 的收藏页会忽略 `?page=` 参数（实测 `?page=1`
  // 与 `?page=2` 返回与第一页完全相同的内容），翻页必须使用页面导航里的
  // `next` 游标（`favorites.php?next=...`）。因此这里不再拼接 `page` 参数，
  // 取第 N 页时由 getFavoritesService 从第一页开始跟随 nextUrl 逐页跳转。
  return ensureAllowedHostUrl(url.toString());
}

export function buildFavoritePopupEndpoint(comicId: string, site: SiteSetting): string {
  const { gid, token } = splitComicId(comicId);
  if (!gid || !token) {
    throw validationError("comicId format is invalid");
  }
  const url = new URL("/gallerypopups.php", resolveSiteBase(site));
  url.searchParams.set("gid", gid);
  url.searchParams.set("t", token);
  url.searchParams.set("act", "addfav");
  return ensureAllowedHostUrl(url.toString());
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

export function buildCommentsEndpoint(comicId: string, site: SiteSetting): string {
  const url = new URL(buildDetailEndpoint(comicId, site));
  url.searchParams.set("hc", "1");
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
