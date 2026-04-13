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
  return parsed.toString();
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
    return parsed.toString();
  } catch {
    return "";
  }
}
