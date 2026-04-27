import type { ComicDetailContract } from "../domain/contracts";
import type { PluginSettings, ComicDetailPayload } from "../domain/types";
import { mapComicDetail } from "../mappers/detail.mapper";
import { httpClient } from "../network/client";
import { buildDetailEndpoint } from "../network/endpoints";
import { parseDetailPage } from "../parsers/detail.parser";
import { requiredString } from "../utils/guards";
import {
  buildNonSearchSiteAttempts,
  buildRoutingExtern,
  readEhUnavailableExtern,
} from "./site-routing.service";

export async function getComicDetailService(
  payload: ComicDetailPayload,
  settings: PluginSettings,
): Promise<ComicDetailContract> {
  const comicId = requiredString(payload.comicId, "comicId");
  const incomingEhUnavailable = readEhUnavailableExtern(payload.extern);
  const attempts = buildNonSearchSiteAttempts(settings, payload.extern);
  let lastError: unknown;

  for (const attempt of attempts) {
    const endpoint = buildDetailEndpoint(comicId, attempt.site);
    try {
      const html = attempt.requestConfig
        ? await httpClient.getText(endpoint, attempt.requestConfig)
        : await httpClient.getText(endpoint);
      if (!html.trim()) {
        continue;
      }
      const detail = parseDetailPage(html, comicId);
      const mapped = mapComicDetail(comicId, detail);
      const ehUnavailable =
        settings.site === "EX" &&
        (incomingEhUnavailable || attempt.site === "EX");
      mapped.extern = buildRoutingExtern(ehUnavailable);
      mapped.data.normal.comicInfo.extension = {
        ...mapped.data.normal.comicInfo.extension,
        ...buildRoutingExtern(ehUnavailable),
      };
      mapped.data.normal.eps = mapped.data.normal.eps.map((ep) => ({
        ...ep,
        extension: {
          ...ep.extension,
          ...buildRoutingExtern(ehUnavailable),
        },
      }));
      return mapped;
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError ?? new Error("failed to load detail page");
}
