import type { CheerioAPI, ImageCropRegion } from "breeze-plugin-kit";
import { parseError } from "../errors/plugin-error";
import { normalizePage } from "../utils/guards";
import { normalizeWhitespace } from "../utils/text";

export type PreviewParsedItem = {
  index: number;
  name: string;
  href: string;
  imageUrl: string;
  region: ImageCropRegion;
};

export type PreviewPageParsed = {
  page: number;
  pages: number;
  total: number;
  hasNext: boolean;
  items: PreviewParsedItem[];
};

function parseDimension(style: string, property: "width" | "height"): number | null {
  const match = new RegExp(`(?:^|;)\\s*${property}\\s*:\\s*(\\d+(?:\\.\\d+)?)px`, "i").exec(style);
  if (!match) {
    return null;
  }
  const value = Math.trunc(Number(match[1]));
  return Number.isSafeInteger(value) && value > 0 ? value : null;
}

function parseBackground(style: string): {
  imageUrl: string;
  x: number;
  y: number;
} | null {
  const match = /url\((['"]?)(.*?)\1\)\s+(-?\d+(?:\.\d+)?)px?\s+(-?\d+(?:\.\d+)?)(?:px)?/i.exec(
    style,
  );
  if (!match) {
    return null;
  }

  const x = Number(match[3]);
  const y = Number(match[4]);
  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    return null;
  }

  return {
    imageUrl: String(match[2]).trim(),
    x: Math.max(0, Math.trunc(-x)),
    y: Math.max(0, Math.trunc(-y)),
  };
}

function parsePageDescription($: CheerioAPI): { first: number; last: number; total: number } {
  const text = normalizeWhitespace(String($(".gtb .gpc").first().text() ?? "")).replace(/,/g, "");
  const match = /showing\s+(\d+)\s*-\s*(\d+)\s+of\s+(\d+)\s+images/i.exec(text);
  if (!match) {
    throw parseError("failed to parse preview page range");
  }
  return {
    first: Number(match[1]),
    last: Number(match[2]),
    total: Number(match[3]),
  };
}

function parsePageNumberFromHref(href: string): number | null {
  try {
    const url = new URL(href, "https://e-hentai.org/");
    const raw = url.searchParams.get("p");
    if (raw == null || !/^\d+$/.test(raw)) {
      return 1;
    }
    return Number(raw) + 1;
  } catch {
    return null;
  }
}

function parsePageLinks($: CheerioAPI): { pages: number; hasNext: boolean } {
  let pages = 1;
  let hasNext = false;
  $(".ptt a, .ptb a").each((_, node) => {
    const text = normalizeWhitespace(String($(node).text() ?? ""));
    const href = String($(node).attr("href") ?? "").trim();
    const page = parsePageNumberFromHref(href);
    if (page != null) {
      pages = Math.max(pages, page);
    }
    if (text === ">" && href) {
      hasNext = true;
    }
  });
  return { pages, hasNext };
}

function parsePreviewItem($: CheerioAPI, node: unknown, fallbackIndex: number): PreviewParsedItem {
  const element = $(node as never);
  const style = String(element.attr("style") ?? "");
  const background = parseBackground(style);
  const width = parseDimension(style, "width");
  const height = parseDimension(style, "height");
  if (!background || !width || !height) {
    throw parseError("failed to parse preview crop region");
  }

  const title = normalizeWhitespace(String(element.attr("title") ?? ""));
  const titleMatch = /^Page\s+(\d+)\s*:\s*(.*)$/i.exec(title);
  const index = titleMatch ? Number(titleMatch[1]) : fallbackIndex;
  const name = titleMatch?.[2]?.trim() || `${index}.webp`;
  const href = String(element.parent().attr("href") ?? "").trim();

  return {
    index,
    name,
    href,
    imageUrl: background.imageUrl,
    region: {
      number: index,
      x: background.x,
      y: background.y,
      width,
      height,
    },
  };
}

export function parsePreviewPage(html: string, page: number): PreviewPageParsed {
  const $ = BreezeHtml.load(html);
  const range = parsePageDescription($);
  const links = parsePageLinks($);
  const items: PreviewParsedItem[] = [];

  $("#gdt > a > div").each((offset, node) => {
    items.push(parsePreviewItem($, node, range.first + offset));
  });

  if (!items.length) {
    throw parseError("failed to parse preview items");
  }

  return {
    page: normalizePage(page),
    pages: links.pages,
    total: range.total,
    hasNext: links.hasNext,
    items,
  };
}
