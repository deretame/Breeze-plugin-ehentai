import type { CheerioAPI } from "breeze-plugin-kit";
import type { SearchParsed } from "../domain/types";
import { toInt } from "../utils/number";
import { normalizeWhitespace } from "../utils/text";
import { parseGalleryListItems, parsePaging } from "./search.parser";

export type FavoriteFolderParsed = {
  id: string;
  name: string;
};

function parseFavoritesTotal($: CheerioAPI): number {
  let total = 0;
  $("h1 + .nosel .fp").each((_, node) => {
    total += toInt($(node).children("div").first().text(), 0);
  });
  return total;
}

const LOGIN_PAGE_MARKERS = ["act=Login", 'name="PassWord"'] as const;

export function isFavoritesLoginPage(html: string): boolean {
  const normalized = String(html ?? "");
  return LOGIN_PAGE_MARKERS.some((marker) => normalized.includes(marker));
}

export function parseFavoriteFoldersPage(html: string): FavoriteFolderParsed[] {
  const $ = BreezeHtml.load(html);
  const folders: FavoriteFolderParsed[] = [];

  $("h1 + .nosel .fp").each((_, node) => {
    const onclick = String($(node).attr("onclick") ?? "");
    const href = String($(node).find("a").first().attr("href") ?? "");
    const favcat =
      /[?&]favcat=(\d+)/i.exec(onclick)?.[1] ?? /[?&]favcat=(\d+)/i.exec(href)?.[1] ?? "";
    if (!/^[0-9]$/.test(favcat)) {
      return;
    }
    const name = normalizeWhitespace($(node).children("div").last().text());
    folders.push({
      id: favcat,
      name: name || `分类 ${Number(favcat) + 1}`,
    });
  });

  return folders.filter(
    (folder, index, items) =>
      /^\d+$/.test(folder.id) && items.findIndex((item) => item.id === folder.id) === index,
  );
}

export function parseFavoritesPage(html: string): SearchParsed {
  const $ = BreezeHtml.load(html);
  const items = parseGalleryListItems($, { categorySelector: ".cn, .cs" });
  const paging = parsePaging($);
  const total = parseFavoritesTotal($) || paging.total;

  return {
    items,
    page: paging.page,
    pages: paging.pages,
    total,
    hasNext: paging.hasNext,
    nextUrl: paging.nextUrl,
    prevUrl: paging.prevUrl,
  };
}
