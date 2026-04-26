import type { ComicDetailContract } from "../domain/contracts";
import type { PluginSettings, ComicDetailPayload } from "../domain/types";
import { mapComicDetail } from "../mappers/detail.mapper";
import { httpClient } from "../network/client";
import { buildDetailEndpoint } from "../network/endpoints";
import { parseDetailPage } from "../parsers/detail.parser";
import { requiredString } from "../utils/guards";
import { buildRequestConfig } from "./settings.service";

export async function getComicDetailService(
  payload: ComicDetailPayload,
  settings: PluginSettings,
): Promise<ComicDetailContract> {
  const comicId = requiredString(payload.comicId, "comicId");

  const endpoint = buildDetailEndpoint(comicId, settings.site);
  const requestConfig = buildRequestConfig(settings);
  const html = requestConfig
    ? await httpClient.getText(endpoint, requestConfig)
    : await httpClient.getText(endpoint);
  const detail = parseDetailPage(html, comicId);
  return mapComicDetail(comicId, detail);
}
