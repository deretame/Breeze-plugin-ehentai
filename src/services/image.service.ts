import { DEFERRED_IMAGE_PATH } from "../domain/constants";
import type { FetchImageBytesPayload, PluginSettings } from "../domain/types";
import { contractError, PluginError } from "../errors/plugin-error";
import { httpClient } from "../network/client";
import { buildImagePageEndpoint } from "../network/endpoints";
import {
  extractReloadKeyFromImagePage,
  isRetryableImagePageHtml,
  parseImagePage,
} from "../parsers/reader.parser";
import { parseDeferredImageUrl } from "../utils/deferred-image";
import { requiredString } from "../utils/guards";
import { ensureAllowedHostUrl, ensureAllowedMediaUrl } from "../utils/url";
import { isPreviewPlaceholderUrl, readPreviewNativeBufferId } from "../utils/preview-image";
import { requireNative } from "../utils/native";
import {
  buildNonSearchSiteAttempts,
  remapGalleryHostForSite,
  type RequestConfig,
} from "./site-routing.service";

async function resolveImageUrlFromImagePage(
  imagePageHref: string,
  requestConfig: RequestConfig,
): Promise<string> {
  const safeImagePageHref = ensureAllowedHostUrl(imagePageHref);
  const imagePageHtml = requestConfig
    ? await httpClient.getText(buildImagePageEndpoint(safeImagePageHref), requestConfig)
    : await httpClient.getText(buildImagePageEndpoint(safeImagePageHref));

  try {
    const parsed = parseImagePage(safeImagePageHref, imagePageHtml);
    return ensureAllowedMediaUrl(parsed.imageUrl);
  } catch (error) {
    if (error instanceof PluginError && error.code === "UPSTREAM_BLOCKED") {
      throw error;
    }

    const reloadKey = extractReloadKeyFromImagePage(imagePageHtml);
    if (!reloadKey || !isRetryableImagePageHtml(imagePageHtml)) {
      throw error;
    }

    const retriedHtml = requestConfig
      ? await httpClient.getText(
          buildImagePageEndpoint(safeImagePageHref, reloadKey),
          requestConfig,
        )
      : await httpClient.getText(buildImagePageEndpoint(safeImagePageHref, reloadKey));
    const retried = parseImagePage(safeImagePageHref, retriedHtml);
    return ensureAllowedMediaUrl(retried.imageUrl);
  }
}

function readDeferredImagePageHref(
  payload: FetchImageBytesPayload,
  rawUrl: string,
): string | undefined {
  const extern = payload.extern ?? {};
  const externHref = String(extern.href ?? "").trim();
  if (externHref) {
    return ensureAllowedHostUrl(externHref);
  }

  const deferred = parseDeferredImageUrl(rawUrl);
  if (deferred) {
    return deferred.imagePageHref;
  }

  return undefined;
}

function isDeferredPlaceholderUrl(rawUrl: string): boolean {
  try {
    const parsed = new URL(rawUrl);
    return parsed.pathname === DEFERRED_IMAGE_PATH;
  } catch {
    return false;
  }
}

export async function fetchImageBytesService(
  payload: FetchImageBytesPayload,
  settings: PluginSettings,
) {
  const rawUrl = requiredString(payload.url, "url");
  const previewNativeBufferId = readPreviewNativeBufferId(payload.extern);
  if (previewNativeBufferId != null) {
    return await requireNative().take(previewNativeBufferId);
  }
  if (isPreviewPlaceholderUrl(rawUrl)) {
    throw contractError("missing preview native buffer", {
      url: rawUrl,
      extern: payload.extern ?? {},
    });
  }
  const deferredImagePageHref = readDeferredImagePageHref(payload, rawUrl);
  const attempts = buildNonSearchSiteAttempts(settings, payload.extern);

  if (!deferredImagePageHref && isDeferredPlaceholderUrl(rawUrl)) {
    throw contractError("missing deferred image page href", {
      url: rawUrl,
      extern: payload.extern ?? {},
    });
  }

  let lastError: unknown;
  for (const attempt of attempts) {
    try {
      const imagePageHref = deferredImagePageHref
        ? remapGalleryHostForSite(deferredImagePageHref, attempt.site)
        : undefined;
      const mediaUrl = remapGalleryHostForSite(rawUrl, attempt.site);

      const imageUrl = imagePageHref
        ? await resolveImageUrlFromImagePage(imagePageHref, attempt.requestConfig)
        : ensureAllowedMediaUrl(mediaUrl);

      const imageBytes = attempt.requestConfig
        ? await httpClient.getBytes(imageUrl, payload.timeoutMs, attempt.requestConfig)
        : await httpClient.getBytes(imageUrl, payload.timeoutMs);
      return imageBytes;
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError ?? contractError("failed to fetch image bytes");
}
