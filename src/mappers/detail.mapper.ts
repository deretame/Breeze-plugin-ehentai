import type {
  ActionItem,
  ComicDetailContract,
  ComicInfoPageAction,
  CreatorPageAction,
  MetadataListItem,
  OpenSearchAction,
} from "breeze-plugin-kit";
import { FALLBACK_UNKNOWN, PLUGIN_SOURCE } from "../domain/constants";
import type { DetailParsed } from "../domain/types";
import {
  buildGalleryChunkExtern,
  buildGalleryChunkId,
  buildGalleryChunks,
  formatGalleryChunkName,
  getGalleryChunkSize,
} from "../utils/chunk";
import { buildMediaPath } from "../utils/media-path";
import { translateNamespace, translateTag } from "../utils/tag-translation";
import { sanitizeMediaUrl } from "../utils/url";

const EMPTY_ACTION = {} as ComicInfoPageAction;

type ComicDetailWithPreview = ComicDetailContract & {
  data: Omit<ComicDetailContract["data"], "normal"> & {
    normal: ComicDetailContract["data"]["normal"] & {
      preview: { enabled: true };
    };
  };
};

function actionItem(
  value?: string | number,
  onTap: ComicInfoPageAction = EMPTY_ACTION,
  extern: Record<string, unknown> = {},
): ActionItem {
  const text = value == null || String(value).trim() === "" ? FALLBACK_UNKNOWN : String(value);
  return {
    name: text,
    onTap,
    extern,
  };
}

function withLabel(label: string, value?: string | number): ActionItem {
  const normalizedValue =
    value == null || String(value).trim() === "" ? FALLBACK_UNKNOWN : String(value);
  return actionItem(`${label}：${normalizedValue}`);
}

function openSearchAction(keyword: string): OpenSearchAction {
  return {
    type: "openSearch",
    payload: {
      source: PLUGIN_SOURCE,
      keyword,
      extern: {},
    },
  };
}

function buildTagMetadata(detail: DetailParsed): MetadataListItem[] {
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
    .filter((item): item is MetadataListItem => item !== null);
}

export function mapComicDetail(comicId: string, detail: DetailParsed): ComicDetailWithPreview {
  const coverUrl = sanitizeMediaUrl(detail.coverUrl);
  const titleMeta: ActionItem[] = [];

  if (detail.englishTitle && detail.japaneseTitle) {
    titleMeta.push(withLabel("副标题", detail.japaneseTitle));
  }

  titleMeta.push(
    withLabel("分类", detail.category),
    withLabel("上传者", detail.uploader),
    withLabel("语言", detail.language),
    withLabel("文件大小", detail.fileSize),
    withLabel("页数", detail.pageCount == null ? undefined : `${detail.pageCount} 页`),
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
  const chunkSize = getGalleryChunkSize();
  const chunks = buildGalleryChunks(detail.pageCount, chunkSize);

  return {
    source: PLUGIN_SOURCE,
    comicId,
    extern: {},
    scheme: { version: "1.0.0", type: "comicDetail", source: PLUGIN_SOURCE },
    data: {
      normal: {
        preview: { enabled: true },
        comicInfo: {
          id: comicId,
          title: detail.title,
          description: "",
          cover: {
            id: comicId,
            url: coverUrl,
            name: "",
            path: buildMediaPath(comicId, coverUrl),
            extern: {},
          },
          creator: {
            id: "",
            name: "",
            avatar: {
              id: "",
              url: "",
              name: "",
              path: "",
              extern: {},
            },
            onTap: {} as CreatorPageAction,
            extern: {},
          },
          titleMeta,
          metadata,
          extern: {
            tagsByNamespace: detail.tagsByNamespace,
          },
        },
        eps: chunks.map((chunk) => ({
          id: buildGalleryChunkId(chunk),
          name: formatGalleryChunkName(chunk, detail.pageCount),
          order: chunk.index,
          requestId: buildGalleryChunkId(chunk),
          storageChapterId: "Gallery",
          logicalKey: buildGalleryChunkId(chunk),
          extern: buildGalleryChunkExtern(chunk, detail.pageCount, chunkSize),
        })),
        recommend: [],
        totalViews: 0,
        totalLikes: 0,
        totalComments: detail.totalComments ?? 0,
        isFavourite: false,
        isLiked: false,
        allowComments: true,
        allowLike: false,
        allowCollected: true,
        allowDownload: true,
        extern: {},
      },
      raw: {
        detail,
      },
    },
  };
}
