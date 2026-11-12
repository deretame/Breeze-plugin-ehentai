import { ALLOWED_ENDPOINT_HOSTS, ALLOWED_MEDIA_HOSTS, EH_BASE_URL } from "../domain/constants";
import { validationError } from "../errors/plugin-error";

export function isValidHttpUrl(input: string): boolean {
  try {
    const parsed = new URL(input);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

export function ensureAllowedHostUrl(input: string, base = EH_BASE_URL): string {
  let parsed: URL;
  try {
    parsed = new URL(input, base);
  } catch {
    throw validationError(`invalid url: ${input}`);
  }

  if (parsed.protocol !== "https:") {
    throw validationError(`unsupported protocol: ${parsed.protocol}`);
  }
  if (!ALLOWED_ENDPOINT_HOSTS.has(parsed.hostname)) {
    throw validationError(`disallowed host: ${parsed.hostname}`);
  }

  return parsed.toString();
}

function isAllowedMediaHost(hostname: string): boolean {
  return (
    ALLOWED_MEDIA_HOSTS.has(hostname) ||
    hostname.endsWith(".ehgt.org") ||
    hostname.endsWith(".hath.network")
  );
}

/**
 * 里站（exhentai）的列表封面、详情缩略图、正文图会走 `s.exhentai.org`。
 * 该域名在墙内基本不可达（DNS 污染 + TLS SNI RST），而 `ehgt.org` 提供
 * 同路径同文件。JHenTai 从 v7.1.2 起就在展示层做同样的替换
 * （`EHImage._replaceEXUrl`，见 jiangtian616/JHenTai#203）。
 *
 * 这里放在 URL 出口统一归一化，好处是宿主 DB 里已经缓存的旧
 * `s.exhentai.org` URL 在 `fetchImageBytes` 下载前也会被改写，用户不必清缓存。
 */
const MEDIA_HOST_ALIASES: Record<string, string> = {
  "s.exhentai.org": "ehgt.org",
};

function normalizeMediaHost(parsed: URL): URL {
  const alias = MEDIA_HOST_ALIASES[parsed.hostname.toLowerCase()];
  if (alias) {
    parsed.hostname = alias;
  }
  return parsed;
}

export function ensureAllowedMediaUrl(input: string, base = EH_BASE_URL): string {
  let parsed: URL;
  try {
    parsed = new URL(input, base);
  } catch {
    throw validationError(`invalid media url: ${input}`);
  }

  if (parsed.protocol !== "https:") {
    throw validationError(`unsupported media protocol: ${parsed.protocol}`);
  }
  if (!isAllowedMediaHost(parsed.hostname)) {
    throw validationError(`disallowed media host: ${parsed.hostname}`);
  }
  return normalizeMediaHost(parsed).toString();
}

export function sanitizeMediaUrl(input: string | null | undefined, base = EH_BASE_URL): string {
  const raw = String(input ?? "").trim();
  if (!raw) {
    return "";
  }

  try {
    const parsed = new URL(raw, base);
    if (parsed.protocol !== "https:") {
      return "";
    }
    if (!isAllowedMediaHost(parsed.hostname)) {
      return "";
    }
    return normalizeMediaHost(parsed).toString();
  } catch {
    return "";
  }
}
