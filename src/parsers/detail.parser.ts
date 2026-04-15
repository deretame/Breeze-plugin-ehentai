import * as cheerio from "cheerio";
import type { DetailParsed } from "../domain/types";
import { parseError } from "../errors/plugin-error";
import { parsePageCount, toInt } from "../utils/number";
import { normalizeWhitespace } from "../utils/text";

function parseCoverUrl($: cheerio.CheerioAPI): string {
  const style = String($("#gd1 > div").attr("style") ?? "").trim();
  const styleMatch = /url\((['"]?)(.*?)\1\)/i.exec(style);
  if (styleMatch?.[2]) {
    return String(styleMatch[2]).trim();
  }

  return String($("#gd1 img").attr("src") ?? "").trim();
}

function parseTagsByNamespace($: cheerio.CheerioAPI): Record<string, string[]> {
  const tagsByNamespaceSet = new Map<string, Set<string>>();

  function pushTag(namespaceRaw: string, tagRaw: string): void {
    const namespace = normalizeWhitespace(namespaceRaw).replace(/:$/, "").toLowerCase();
    const tag = normalizeWhitespace(tagRaw);
    if (!namespace || !tag) {
      return;
    }
    const bucket = tagsByNamespaceSet.get(namespace) ?? new Set<string>();
    bucket.add(tag);
    tagsByNamespaceSet.set(namespace, bucket);
  }

  // Primary path: parse rendered row labels + anchor text (matches real EH/EX taglist layout).
  $("#taglist tr").each((_, tr) => {
    const namespace = String($(tr).find("td.tc").first().text() ?? "");
    const valueCell = $(tr).find("td").eq(1);
    if (!normalizeWhitespace(namespace) || !valueCell.length) {
      return;
    }
    valueCell.find("a").each((__, anchor) => {
      pushTag(namespace, String($(anchor).text() ?? ""));
    });
  });

  // Fallback path: parse id tokens (helps on simplified/fixture html).
  $("#taglist [id*=':']").each((_, element) => {
    const rawId = String($(element).attr("id") ?? "");
    if (!rawId.includes(":")) {
      return;
    }
    const [left, right] = rawId.split(":", 2);
    const namespace = left.split("_").pop() ?? "";
    const text = normalizeWhitespace(String($(element).text() ?? ""));
    const fallbackTag = right.replace(/_/g, " ");
    pushTag(namespace, text || fallbackTag);
  });

  return Array.from(tagsByNamespaceSet.entries()).reduce<Record<string, string[]>>((acc, [namespace, tags]) => {
    acc[namespace] = Array.from(tags);
    return acc;
  }, {});
}

export function parseDetailPage(html: string, comicId: string): DetailParsed {
  const $ = cheerio.load(html);
  const englishTitle = normalizeWhitespace($("#gn").text());
  const japaneseTitle = normalizeWhitespace($("#gj").text());
  if (!englishTitle && !japaneseTitle) {
    throw parseError("failed to parse detail title");
  }

  const tableRows = $("#gdd table tr")
    .map((_, tr) => {
      const cells = $(tr).find("td");
      const key = normalizeWhitespace(cells.first().text()).replace(":", "").toLowerCase();
      const value = normalizeWhitespace(cells.last().text());
      return { key, value };
    })
    .get();

  const tableMap = tableRows.reduce<Record<string, string>>((acc, row) => {
    if (row.key) {
      acc[row.key] = row.value;
    }
    return acc;
  }, {});

  const tokenMatch = /\/g\/(\d+)\/([a-zA-Z0-9-]+)/.exec(comicId);
  const gid = tokenMatch?.[1] ?? comicId.split("/")[0] ?? comicId;
  const token = tokenMatch?.[2] ?? comicId.split("/")[1] ?? "";

  const coverUrl = parseCoverUrl($);
  const uploader = normalizeWhitespace($("#gdn a").first().text() || $("#gdn").first().text())
    .replace(/^\((.*)\)$/, "$1")
    .trim();
  const favoritedCount = toInt(/(\d[\d,]*)/.exec(tableMap.favorited ?? "")?.[1], 0);
  const ratingAverageFromDom = normalizeWhitespace(String($("#rating_label").first().text() ?? ""))
    .replace(/^Average:\s*/i, "")
    .trim();
  const ratingAverageFromHtml = /Average:\s*([0-9]+(?:\.[0-9]+)?)/i.exec(html)?.[1] ?? "";
  const ratingAverage = ratingAverageFromDom || ratingAverageFromHtml;
  const ratingCount = toInt(normalizeWhitespace(String($("#rating_count").first().text() ?? "")), 0);
  const language = tableMap.language || "";

  const title = englishTitle || japaneseTitle;

  return {
    gid,
    token,
    title,
    englishTitle: englishTitle || undefined,
    japaneseTitle: japaneseTitle || undefined,
    category: normalizeWhitespace($("#gdc .cs").text()) || undefined,
    uploader: uploader || undefined,
    language: language || undefined,
    fileSize: tableMap["file size"] || undefined,
    pageCount: parsePageCount(tableMap["length"] ?? ""),
    posted: tableMap.posted || undefined,
    favoritedCount: favoritedCount > 0 ? favoritedCount : undefined,
    ratingAverage: ratingAverage || undefined,
    ratingCount: ratingCount > 0 ? ratingCount : undefined,
    tagsByNamespace: parseTagsByNamespace($),
    coverUrl,
  };
}
