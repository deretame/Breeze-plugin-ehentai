import { pictureTools } from "breeze-plugin-kit";
import type {
  NativeApi,
  PreviewContentContract,
  PreviewItem,
  PreviewPayload,
} from "breeze-plugin-kit";
import { PREVIEW_IMAGE_KIND } from "../domain/constants";
import { buildDetailEndpoint } from "../network/endpoints";
import { httpClient } from "../network/client";
import type { PluginSettings } from "../domain/types";
import { parsePreviewPage, type PreviewParsedItem } from "../parsers/preview.parser";
import { contractError } from "../errors/plugin-error";
import { asRecord, requiredString, normalizePage } from "../utils/guards";
import { ensureAllowedMediaUrl } from "../utils/url";
import { requireNative } from "../utils/native";
import { buildPreviewItemPath, buildPreviewPlaceholderUrl } from "../utils/preview-image";
import {
  buildNonSearchSiteAttempts,
  buildRoutingExtern,
  readEhUnavailableExtern,
} from "./site-routing.service";

type PreviewGroup = {
  imageUrl: string;
  items: PreviewParsedItem[];
};

function groupByImageUrl(items: PreviewParsedItem[]): PreviewGroup[] {
  const groups = new Map<string, PreviewParsedItem[]>();
  for (const item of items) {
    const imageUrl = ensureAllowedMediaUrl(item.imageUrl);
    const group = groups.get(imageUrl) ?? [];
    group.push(item);
    groups.set(imageUrl, group);
  }
  return Array.from(groups, ([imageUrl, groupedItems]) => ({ imageUrl, items: groupedItems }));
}

async function freeNativeBuffers(native: NativeApi, ids: number[]): Promise<void> {
  await Promise.allSettled(ids.map((id) => native.free(id)));
}

async function putPreviewImages(
  groups: PreviewGroup[],
  requestConfig: { headers: Record<string, string> } | undefined,
): Promise<Map<number, number>> {
  const native = requireNative();
  const nativeIds: number[] = [];
  const result = new Map<number, number>();

  try {
    for (const group of groups) {
      const mergedImage = await httpClient.getBytes(group.imageUrl, undefined, requestConfig);
      const croppedImages = await pictureTools.cropImageByRegions(
        mergedImage,
        group.items.map((item) => item.region),
      );
      const croppedByNumber = new Map(croppedImages.map((item) => [item.number, item.imgData]));

      for (const item of group.items) {
        const imageData = croppedByNumber.get(item.region.number);
        if (!imageData) {
          throw contractError("preview crop result is missing", {
            number: item.region.number,
          });
        }
        const nativeId = await native.put(imageData);
        nativeIds.push(nativeId);
        result.set(item.index, nativeId);
      }
    }
    return result;
  } catch (error) {
    await freeNativeBuffers(native, nativeIds);
    throw error;
  }
}

function mapPreviewItems(
  comicId: string,
  parsedItems: PreviewParsedItem[],
  nativeIds: Map<number, number>,
): PreviewItem[] {
  const placeholderUrl = buildPreviewPlaceholderUrl();
  return parsedItems.map((item) => {
    const nativeBufferId = nativeIds.get(item.index);
    if (nativeBufferId == null) {
      throw contractError("preview native buffer is missing", { number: item.index });
    }
    return {
      id: String(item.index),
      name: item.name,
      path: buildPreviewItemPath(comicId, item.index),
      url: placeholderUrl,
      extern: {
        kind: PREVIEW_IMAGE_KIND,
        nativeBufferId,
      },
    };
  });
}

export async function getPreviewService(
  payload: PreviewPayload,
  settings: PluginSettings,
): Promise<PreviewContentContract> {
  const comicId = requiredString(payload.comicId, "comicId");
  const page = normalizePage(payload.page);
  const incomingEhUnavailable = readEhUnavailableExtern(payload.extern);
  const attempts = buildNonSearchSiteAttempts(settings, payload.extern);
  let lastError: unknown;

  for (const attempt of attempts) {
    try {
      const endpoint = buildDetailEndpoint(comicId, attempt.site, page - 1);
      const html = attempt.requestConfig
        ? await httpClient.getText(endpoint, attempt.requestConfig)
        : await httpClient.getText(endpoint);
      const parsed = parsePreviewPage(html, page);
      const nativeIds = await putPreviewImages(
        groupByImageUrl(parsed.items),
        attempt.requestConfig,
      );
      const ehUnavailable =
        settings.site === "EX" && (incomingEhUnavailable || attempt.site === "EX");

      return {
        source: "ehentai",
        comicId,
        extern: {
          ...asRecord(payload.extern),
          ...buildRoutingExtern(ehUnavailable),
        },
        scheme: {
          version: "1.0.0",
          type: "previewContent",
          source: "ehentai",
        },
        data: {
          preview: {
            items: mapPreviewItems(comicId, parsed.items, nativeIds),
            paging: {
              page: parsed.page,
              pages: parsed.pages,
              total: parsed.total,
              hasReachedMax: !parsed.hasNext,
            },
          },
        },
      };
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError ?? new Error("failed to load preview page");
}
