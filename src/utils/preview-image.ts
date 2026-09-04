import { EH_BASE_URL, PREVIEW_IMAGE_KIND, PREVIEW_IMAGE_PATH } from "../domain/constants";
import { asRecord } from "./guards";

export function buildPreviewPlaceholderUrl(): string {
  return new URL(PREVIEW_IMAGE_PATH, EH_BASE_URL).toString();
}

export function isPreviewPlaceholderUrl(input: string): boolean {
  try {
    return new URL(input).pathname === PREVIEW_IMAGE_PATH;
  } catch {
    return false;
  }
}

export function readPreviewNativeBufferId(
  extern: Record<string, unknown> | undefined,
): number | null {
  const value = asRecord(extern);
  if (value.kind !== PREVIEW_IMAGE_KIND) {
    return null;
  }

  const id = Number(value.nativeBufferId);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

export function buildPreviewItemPath(comicId: string, imageIndex: number): string {
  const safeComicId = comicId.replace(/[^A-Za-z0-9._-]+/g, "_");
  return `preview-${safeComicId}-${imageIndex}.webp`;
}
