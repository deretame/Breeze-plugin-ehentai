const INVALID_PATH_CHARS_REGEX = /[<>:"/\\|?*\x00-\x1F]/g;
const NON_ASCII_SAFE_REGEX = /[^A-Za-z0-9._-]/g;
const EXTENSION_REGEX = /\.([a-z0-9]{1,8})$/i;

function sanitizeMediaId(id: string): string {
  const trimmed = String(id).trim();
  const replaced = trimmed
    .replace(INVALID_PATH_CHARS_REGEX, "_")
    .replace(/\s+/g, "_")
    .replace(NON_ASCII_SAFE_REGEX, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");

  return replaced || "media";
}

function extractExtension(mediaUrl: string): string {
  try {
    const parsed = new URL(mediaUrl);
    const pathname = parsed.pathname || "";
    const extension = EXTENSION_REGEX.exec(pathname)?.[1]?.toLowerCase();
    return extension || "jpg";
  } catch {
    return "jpg";
  }
}

export function buildMediaPath(id: string, mediaUrl: string): string {
  const normalizedUrl = String(mediaUrl ?? "").trim();
  if (!normalizedUrl) {
    return "";
  }

  const safeId = sanitizeMediaId(id);
  const extension = extractExtension(normalizedUrl);
  return `${safeId}.${extension}`;
}
