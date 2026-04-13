import { DEFERRED_IMAGE_PATH } from "../domain/constants";
import { ensureAllowedHostUrl } from "./url";

export function buildDeferredImageUrl(imagePageHref: string): string {
  const safeImagePageHref = ensureAllowedHostUrl(imagePageHref);
  const parsed = new URL(safeImagePageHref);
  const deferred = new URL(DEFERRED_IMAGE_PATH, `${parsed.protocol}//${parsed.host}`);
  return deferred.toString();
}

export function parseDeferredImageUrl(input: string): { imagePageHref: string } | null {
  let parsed: URL;
  try {
    parsed = new URL(input);
  } catch {
    return null;
  }

  if (parsed.pathname !== DEFERRED_IMAGE_PATH) {
    return null;
  }

  const href = String(parsed.searchParams.get("href") ?? "").trim();
  if (!href) {
    return null;
  }

  return {
    imagePageHref: ensureAllowedHostUrl(href),
  };
}
