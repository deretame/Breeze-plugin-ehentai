import { FALLBACK_UNKNOWN, PLUGIN_SOURCE } from "../domain/constants";
import type { ComicDetailContract } from "../domain/contracts";
import type { DetailParsed } from "../domain/types";
import { buildMediaPath } from "../utils/media-path";
import { translateNamespace, translateTag } from "../utils/tag-translation";
import { sanitizeMediaUrl } from "../utils/url";

function actionItem(
  value?: string | number,
  onTap: Record<string, unknown> = {},
  extension: Record<string, unknown> = {},
): {
  name: string;
  onTap: Record<string, unknown>;
  extension: Record<string, unknown>;
} {
  const text =
    value == null || String(value).trim() === ""
      ? FALLBACK_UNKNOWN
      : String(value);
  return {
    name: text,
    onTap,
    extension,
  };
}

function withLabel(
  label: string,
  value?: string | number,
): {
  name: string;
  onTap: Record<string, unknown>;
  extension: Record<string, unknown>;
} {
  const normalizedValue =
    value == null || String(value).trim() === ""
      ? FALLBACK_UNKNOWN
      : String(value);
  return actionItem(`${label}：${normalizedValue}`);
}

function openSearchAction(keyword: string): Record<string, unknown> {
  return {
    type: "openSearch",
    payload: {
      source: PLUGIN_SOURCE,
      keyword,
      extern: {},
    },
  };
}

function buildTagMetadata(detail: DetailParsed): Array<{
  type: string;
  name: string;
  value: Array<{
    name: string;
    onTap: Record<string, unknown>;
    extension: Record<string, unknown>;
  }>;
}> {
  return Object.entries(detail.tagsByNamespace)
    .map(([namespace, tags]) => {
      const normalizedNamespace = String(namespace ?? "")
        .trim()
        .toLowerCase();
      const normalizedTags = Array.from(
        new Set(
          (Array.isArray(tags) ? tags : [])
            .map((tag) => String(tag ?? "").trim())
            .filter((tag) => tag.length > 0),
        ),
      );
      if (!normalizedNamespace || !normalizedTags.length) {
        return null;
      }
      return {
        type: `tag:${normalizedNamespace}`,
        name: translateNamespace(normalizedNamespace),
        value: normalizedTags.map((tag) =>
          actionItem(
            translateTag(normalizedNamespace, tag),
            openSearchAction(`${normalizedNamespace}:${tag}`),
          ),
        ),
      };
    })
    .filter(
      (
        item,
      ): item is {
        type: string;
        name: string;
        value: Array<{
          name: string;
          onTap: Record<string, unknown>;
          extension: Record<string, unknown>;
        }>;
      } => Boolean(item),
    );
}

export function mapComicDetail(
  comicId: string,
  detail: DetailParsed,
): ComicDetailContract {
  const coverUrl = sanitizeMediaUrl(detail.coverUrl);
  const titleMeta: Array<{
    name: string;
    onTap: Record<string, unknown>;
    extension: Record<string, unknown>;
  }> = [];

  if (detail.englishTitle && detail.japaneseTitle) {
    titleMeta.push(withLabel("副标题", detail.japaneseTitle));
  }

  titleMeta.push(
    withLabel("分类", detail.category),
    withLabel("上传者", detail.uploader),
    withLabel("语言", detail.language),
    withLabel("文件大小", detail.fileSize),
    withLabel(
      "页数",
      detail.pageCount == null ? undefined : `${detail.pageCount} 页`,
    ),
    withLabel("发布时间", detail.posted),
  );

  if (detail.favoritedCount != null) {
    titleMeta.push(withLabel("收藏", `${detail.favoritedCount} 次`));
  }
  if (detail.ratingAverage || detail.ratingCount != null) {
    const ratingText =
      detail.ratingCount != null
        ? `${detail.ratingAverage ?? FALLBACK_UNKNOWN}（${detail.ratingCount}）`
        : String(detail.ratingAverage ?? FALLBACK_UNKNOWN);
    titleMeta.push(withLabel("评分", ratingText));
  }
  const metadata = buildTagMetadata(detail);

  return {
    source: PLUGIN_SOURCE,
    comicId,
    extern: {},
    scheme: { version: "1.0.0", type: "comicDetail" },
    data: {
      normal: {
        comicInfo: {
          source: PLUGIN_SOURCE,
          id: comicId,
          title: detail.title,
          subtitle: detail.category ?? "",
          description: "",
          likesCount: 0,
          viewsCount: 0,
          cover: {
            id: comicId,
            url: coverUrl,
            name: "",
            path: buildMediaPath(comicId, coverUrl),
            extension: {},
          },
          creator: {
            id: "",
            name: "",
            subtitle: "",
            avatar: {
              id: "",
              url: "",
              name: "",
              path: "",
              extension: {},
            },
            onTap: {},
            extension: {},
          },
          titleMeta,
          metadata,
          extension: {
            tagsByNamespace: detail.tagsByNamespace,
          },
        },
        eps: [
          {
            id: comicId,
            name: "Gallery",
            order: 1,
            extension: {
              pageCount: detail.pageCount ?? 0,
            },
          },
        ],
        recommend: [],
        totalViews: 0,
        totalLikes: 0,
        totalComments: 0,
        isFavourite: false,
        isLiked: false,
        allowComments: false,
        allowLike: true,
        allowCollected: true,
        allowDownload: true,
        extension: {},
      },
      raw: {
        detail,
      },
    },
  };
}
