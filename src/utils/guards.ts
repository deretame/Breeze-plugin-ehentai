import type { PluginSettings, SiteSetting } from "../domain/types";
import { validationError } from "../errors/plugin-error";

const COMIC_ID_PATTERN = /^(?:\d+|\d+\/[A-Za-z0-9-]+)$/;
const COMIC_ID_TOKENIZED_PATTERN = /^(\d+)-([A-Za-z0-9-]+)$/;

export function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

export function requiredString(value: unknown, label: string): string {
  if (!isNonEmptyString(value)) {
    throw validationError(`${label} is required`);
  }
  return value.trim();
}

export function normalizeComicId(value: unknown, label = "comicId"): string {
  const comicId = requiredString(value, label);
  const lower = comicId.toLowerCase();
  if (
    comicId.includes("?") ||
    comicId.includes("#") ||
    comicId.includes("\\") ||
    comicId.includes("..") ||
    lower.includes("%2f") ||
    lower.includes("%5c") ||
    (!COMIC_ID_PATTERN.test(comicId) && !COMIC_ID_TOKENIZED_PATTERN.test(comicId))
  ) {
    throw validationError(`${label} format is invalid`);
  }
  return comicId;
}

export function buildTokenizedComicId(gid: string, token: string): string {
  const safeGid = String(gid ?? "").trim();
  const safeToken = String(token ?? "").trim();
  if (!safeGid || !safeToken) {
    return safeGid;
  }
  return `${safeGid}-${safeToken}`;
}

export function splitComicId(comicIdValue: unknown): { gid: string; token: string } {
  const comicId = normalizeComicId(comicIdValue);
  const slashMatch = /^(\d+)\/([A-Za-z0-9-]+)$/.exec(comicId);
  if (slashMatch) {
    return {
      gid: slashMatch[1],
      token: slashMatch[2],
    };
  }
  const hyphenMatch = COMIC_ID_TOKENIZED_PATTERN.exec(comicId);
  if (hyphenMatch) {
    return {
      gid: hyphenMatch[1],
      token: hyphenMatch[2],
    };
  }
  return {
    gid: comicId,
    token: "",
  };
}

export function ensureArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

export function normalizeKeyword(value: unknown): string {
  const keyword = String(value ?? "")
    .replace(/\s+/g, " ")
    .trim();
  if (!keyword) {
    throw validationError("keyword is required");
  }
  return keyword.slice(0, 120);
}

export function normalizePage(value: unknown, fallback = 1): number {
  const page = Number(value ?? fallback);
  if (!Number.isFinite(page)) {
    return fallback;
  }
  return Math.max(1, Math.trunc(page));
}

export function validateSettingsInput(input: Record<string, unknown>): PluginSettings {
  const siteRaw = String(input.site ?? "EH").toUpperCase();
  const site: SiteSetting = siteRaw === "EX" ? "EX" : "EH";

  const imageProxyEnabled =
    typeof input.imageProxyEnabled === "boolean"
      ? input.imageProxyEnabled
      : String(input.imageProxyEnabled ?? "false").toLowerCase() === "true";

  const ipb_member_id = String(input.ipb_member_id ?? "").trim();
  const ipb_pass_hash = String(input.ipb_pass_hash ?? "").trim();
  const igneous = String(input.igneous ?? "").trim();

  return {
    site,
    imageProxyEnabled,
    ipb_member_id,
    ipb_pass_hash,
    igneous,
    forumCookie: "",
  };
}
