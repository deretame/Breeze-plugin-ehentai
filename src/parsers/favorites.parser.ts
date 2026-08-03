import type { CheerioAPI } from "breeze-plugin-kit";
import type { SearchParsed } from "../domain/types";
import { toInt } from "../utils/number";
import { parseGalleryListItems, parsePaging } from "./search.parser";

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
