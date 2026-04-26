import { runtime } from "../../types/runtime-api";
import { DEFERRED_IMAGE_PATH } from "../domain/constants";
import type { FetchImageBytesContract } from "../domain/contracts";
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
import { buildRequestConfig } from "./settings.service";

type RequestConfig = { headers: Record<string, string> } | undefined;

function normalizeNativeBufferId(value: unknown): number {
  const nativeBufferId = Number(value);
  if (!Number.isInteger(nativeBufferId) || nativeBufferId < 0) {
    throw contractError("invalid native buffer id", value);
  }
  return nativeBufferId;
}

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
      ? await httpClient.getText(buildImagePageEndpoint(safeImagePageHref, reloadKey), requestConfig)
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
): Promise<FetchImageBytesContract> {
  const rawUrl = requiredString(payload.url, "url");
  const deferredImagePageHref = readDeferredImagePageHref(payload, rawUrl);
  const requestConfig = buildRequestConfig(settings);

  if (!deferredImagePageHref && isDeferredPlaceholderUrl(rawUrl)) {
    throw contractError("missing deferred image page href", {
      url: rawUrl,
      extern: payload.extern ?? {},
    });
  }

  const imageUrl = deferredImagePageHref
    ? await resolveImageUrlFromImagePage(deferredImagePageHref, requestConfig)
    : ensureAllowedMediaUrl(rawUrl);

  const imageBytes = requestConfig
    ? await httpClient.getBytes(imageUrl, payload.timeoutMs, requestConfig)
    : await httpClient.getBytes(imageUrl, payload.timeoutMs);
  const nativeBufferId = await runtime.native.put(imageBytes);
  return {
    nativeBufferId: normalizeNativeBufferId(nativeBufferId),
  };
}
