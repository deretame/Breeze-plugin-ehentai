import type { ComicDetailContract } from "../domain/contracts";
import type { PluginSettings, ComicDetailPayload } from "../domain/types";
import { mapComicDetail } from "../mappers/detail.mapper";
import { httpClient } from "../network/client";
import { buildDetailEndpoint } from "../network/endpoints";
import { parseDetailPage } from "../parsers/detail.parser";
import { requiredString } from "../utils/guards";

export async function getComicDetailService(
  payload: ComicDetailPayload,
  settings: PluginSettings,
): Promise<ComicDetailContract> {
  const comicId = requiredString(payload.comicId, "comicId");

  const html = await httpClient.getText(buildDetailEndpoint(comicId, settings.site));
  const detail = parseDetailPage(html, comicId);
  return mapComicDetail(comicId, detail);
}
