import { PLUGIN_SOURCE } from "../domain/constants";
import type { SearchResultContract } from "../domain/contracts";
import type { SearchParsed, SearchComicPayload } from "../domain/types";
import { buildMediaPath } from "../utils/media-path";
import { sanitizeMediaUrl } from "../utils/url";

export function mapSearchResult(payload: SearchComicPayload, parsed: SearchParsed): SearchResultContract {
  const currentPage = Math.max(1, Number(payload.page ?? parsed.page ?? 1));
  const pages = Math.max(parsed.pages, currentPage + (parsed.hasNext ? 1 : 0));
  const extern = {
    ...(payload.extern ?? {}),
    nextUrl: parsed.nextUrl ?? "",
    prevUrl: parsed.prevUrl ?? "",
  };

  return {
    source: PLUGIN_SOURCE,
    extern,
    scheme: { version: "1.0.0", type: "searchResult" },
    data: {
      paging: {
        page: currentPage,
        pages,
        total: parsed.total,
        hasReachedMax: !parsed.hasNext,
      },
      items: parsed.items.map((item) => {
        const coverUrl = sanitizeMediaUrl(item.coverUrl);
        return {
          source: PLUGIN_SOURCE,
          id: item.id,
          title: item.title,
          subtitle: item.category,
          finished: false,
          likesCount: 0,
          viewsCount: 0,
          updatedAt: "",
          cover: {
            id: item.id,
            url: coverUrl,
            path: buildMediaPath(item.id, coverUrl),
            extern: {},
          },
          metadata: [
            { type: "category", name: "Category", value: item.category ? [item.category] : [] },
            { type: "uploader", name: "Uploader", value: item.uploader ? [item.uploader] : [] },
          ],
          raw: {
            href: item.href,
          },
          extern: {
            href: item.href,
            uploader: item.uploader,
          },
        };
      }),
    },
  };
}
