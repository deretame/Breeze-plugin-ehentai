import { FALLBACK_UNKNOWN } from "../domain/constants";

export function normalizeWhitespace(value: unknown): string {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .replace(/[\u0000-\u001F]/g, "")
    .trim();
}

export function toUnknown(value: unknown): string {
  const normalized = normalizeWhitespace(value);
  return normalized || FALLBACK_UNKNOWN;
}

export function toNotProvided(value: unknown): string {
  const normalized = normalizeWhitespace(value);
  return normalized || "Not provided";
}
