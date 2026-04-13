import * as cheerio from "cheerio";
import type { SearchParsed } from "../domain/types";
import { parseError } from "../errors/plugin-error";
import { toInt } from "../utils/number";
import { normalizeWhitespace } from "../utils/text";

const DETAIL_ID_REGEX = /\/g\/(\d+\/[a-zA-Z0-9-]+)\/?/;
const STYLE_URL_REGEX = /url\((['"]?)(.*?)\1\)/i;
const COVER_ATTRIBUTES = ["data-src", "data-lazy-src", "data-original", "src"] as const;
const PLACEHOLDER_MARKERS = ["data:image", "base64,", "blank.gif", "spacer", "/img/blank"];

function parsePaging($: cheerio.CheerioAPI): {
  page: number;
  pages: number;
  total: number;
  hasNext: boolean;
  nextUrl?: string;
  prevUrl?: string;
} {
  function normalizeNavHref(input: string): string {
    const href = String(input ?? "").trim();
    if (!href || href.toLowerCase().startsWith("javascript:")) {
      return "";
    }
    return href;
  }

  function findNavHref(ids: string[]): string {
    for (const id of ids) {
      const node = $(`#${id}`).first();
      if (node.is("a[href]")) {
        const href = normalizeNavHref(String(node.attr("href") ?? ""));
        if (href) {
          return href;
        }
      }
    }
    return "";
  }

  const selectedPage = toInt($(".ptds").first().text(), 1);
  const pageCandidates = $(".ptt a")
    .map((_, node) => toInt($(node).text(), 0))
    .get()
    .filter((value) => value > 0);
  const pages = pageCandidates.length
    ? Math.max(...pageCandidates)
    : selectedPage;

  const totalText = normalizeWhitespace($(".ip").first().text());
  const totalMatch = /(\d[\d,]*)\s+results?/i.exec(totalText);
  const total = toInt(totalMatch?.[1], 0);
  const nextUrl = findNavHref(["dnext", "unext"]);
  const prevUrl = findNavHref(["dprev", "uprev"]);
  const hasNextByPages = pages > selectedPage;
  const hasNext = hasNextByPages || Boolean(nextUrl);

  return {
    page: Math.max(1, selectedPage),
    pages: Math.max(1, pages),
    total,
    hasNext,
    nextUrl: nextUrl || undefined,
    prevUrl: prevUrl || undefined,
  };
}

export function parseSearchPage(html: string): SearchParsed {
  const $ = cheerio.load(html);

  function normalizeCoverCandidate(input: string): string {
    const value = String(input ?? "").trim().replace(/^['"]|['"]$/g, "");
    if (!value) {
      return "";
    }
    const lowered = value.toLowerCase();
    if (lowered.startsWith("data:")) {
      return "";
    }
    if (PLACEHOLDER_MARKERS.some((marker) => lowered.includes(marker))) {
      return "";
    }
    if (value.startsWith("//")) {
      return `https:${value}`;
    }
    return value;
  }

  function extractStyleUrl(style: string): string {
    return STYLE_URL_REGEX.exec(String(style ?? ""))?.[2] ?? "";
  }

  function resolveCoverUrl(root: cheerio.Cheerio<any>): string {
    const scopes = [
      root.closest("tr"),
      root.closest(".itg > div"),
      root.closest("div"),
    ];

    const candidates: string[] = [];

    for (const scope of scopes) {
      if (!scope.length) {
        continue;
      }

      scope.find("img").each((_, img) => {
        for (const attrName of COVER_ATTRIBUTES) {
          const attrValue = String($(img).attr(attrName) ?? "").trim();
          if (attrValue) {
            candidates.push(attrValue);
          }
        }

        const parentStyle = String($(img).parent().attr("style") ?? "").trim();
        const inlineStyle = String($(img).attr("style") ?? "").trim();
        const parentStyleUrl = extractStyleUrl(parentStyle);
        const inlineStyleUrl = extractStyleUrl(inlineStyle);
        if (parentStyleUrl) {
          candidates.push(parentStyleUrl);
        }
        if (inlineStyleUrl) {
          candidates.push(inlineStyleUrl);
        }
      });

      scope.find("[style*='url(']").each((_, node) => {
        const styleUrl = extractStyleUrl(String($(node).attr("style") ?? ""));
        if (styleUrl) {
          candidates.push(styleUrl);
        }
      });
    }

    for (const candidate of candidates) {
      const normalized = normalizeCoverCandidate(candidate);
      if (normalized) {
        return normalized;
      }
    }

    return "";
  }

  const items = $(".itg .gl3c.glname, .itg .gl3m.glname, .itg .glname")
    .map((_, node) => {
      const root = $(node);
      const anchor = root.find("a").first();
      const href = String(anchor.attr("href") ?? "").trim();
      const id = DETAIL_ID_REGEX.exec(href)?.[1] ?? "";
      const title = normalizeWhitespace(
        root.find(".glink").text() || anchor.text(),
      );
      const coverUrl = resolveCoverUrl(root);
      const category = normalizeWhitespace(
        root.closest("tr").find(".cn").text(),
      );
      const uploader = normalizeWhitespace(
        root.closest("tr").find(".gl4c a, .gl5m a").first().text(),
      );

      return {
        id,
        href,
        title,
        coverUrl,
        category,
        uploader,
      };
    })
    .get()
    .filter((item) => item.id && item.title);

  const paging = parsePaging($);

  if (!Array.isArray(items)) {
    throw parseError("failed to parse search items");
  }

  return {
    items,
    page: paging.page,
    pages: paging.pages,
    total: paging.total,
    hasNext: paging.hasNext,
    nextUrl: paging.nextUrl,
    prevUrl: paging.prevUrl,
  };
}
