import type { CommentFeedContract, CommentFeedPayload } from "breeze-plugin-kit";
import { PLUGIN_SOURCE } from "../domain/constants";
import type { PluginSettings } from "../domain/types";
import { httpClient } from "../network/client";
import { buildCommentsEndpoint } from "../network/endpoints";
import { parseCommentsPage } from "../parsers/comments.parser";
import { normalizeComicId, normalizePage } from "../utils/guards";
import { buildNonSearchSiteAttempts } from "./site-routing.service";

function buildCommentFeed(
  payload: CommentFeedPayload,
  topItems: CommentFeedContract["data"]["topItems"],
  items: CommentFeedContract["data"]["items"],
): CommentFeedContract {
  return {
    source: PLUGIN_SOURCE,
    extern: payload.extern ?? null,
    scheme: {
      version: "1.0.0",
      type: "commentFeed",
    },
    data: {
      topItems,
      items,
      paging: { hasReachedMax: true },
      replyMode: "embedded",
      canComment: {
        comic: false,
        reply: false,
      },
    },
  };
}

export async function getCommentFeedService(
  payload: CommentFeedPayload,
  settings: PluginSettings,
): Promise<CommentFeedContract> {
  const comicId = normalizeComicId(payload.comicId, "comicId");
  const page = normalizePage(payload.page, 1);

  if (page > 1) {
    return buildCommentFeed(payload, [], []);
  }

  const attempts = buildNonSearchSiteAttempts(settings, payload.extern);
  let lastError: unknown;

  for (const attempt of attempts) {
    try {
      const endpoint = buildCommentsEndpoint(comicId, attempt.site);
      const requestConfig = attempt.requestConfig;
      const html = requestConfig
        ? await httpClient.getText(endpoint, requestConfig)
        : await httpClient.getText(endpoint);
      if (!html.trim()) {
        continue;
      }

      const parsed = parseCommentsPage(html);
      return buildCommentFeed(payload, parsed.topItems, parsed.items);
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError ?? new Error("failed to load comments");
}
