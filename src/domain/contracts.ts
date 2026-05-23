export type PluginFunctionItem = {
  id: string;
  title: string;
  action:
    | { type: "openSearch"; payload: { source: string; keyword?: string } }
    | { type: "openComicDetail"; payload: { comicId: string } }
    | {
        type: "openComicList";
        payload: {
          scene: {
            title: string;
            source: string;
            list: {
              fnPath: string;
              core?: Record<string, unknown>;
              extern?: Record<string, unknown>;
            };
            filter?: {
              fnPath: string;
              core?: Record<string, unknown>;
              extern?: Record<string, unknown>;
            };
          };
        };
      }
    | {
        type: "openPluginFunction";
        payload: {
          id: string;
          title?: string;
          presentation?: "page";
        };
      };
};

export type InfoContract = {
  name: string;
  uuid: string;
  iconUrl: string;
  creator: { name: string; describe: string };
  describe: string;
  version: string;
  home: string;
  updateUrl: string;
  npmName: string;
  function: PluginFunctionItem[];
};

export type SearchResultContract = {
  source: string;
  extern: Record<string, unknown>;
  scheme: { version: "1.0.0"; type: "searchResult" };
  data: {
    paging: {
      page: number;
      pages: number;
      total: number;
      hasReachedMax: boolean;
    };
    items: Array<{
      source: string;
      id: string;
      title: string;
      subtitle: string;
      finished: boolean;
      likesCount: number;
      viewsCount: number;
      updatedAt: string;
      cover: {
        id: string;
        url: string;
        path: string;
        extern: Record<string, unknown>;
      };
      metadata: Array<{ type: string; name: string; value: string[] }>;
      raw: Record<string, unknown>;
      extern: Record<string, unknown>;
    }>;
  };
};

export type ComicDetailContract = {
  source: string;
  comicId: string;
  extern: Record<string, unknown>;
  scheme: { version: "1.0.0"; type: "comicDetail" };
  data: {
    normal: {
      comicInfo: {
        source: string;
        id: string;
        title: string;
        subtitle: string;
        description: string;
        likesCount: number;
        viewsCount: number;
        cover: {
          id: string;
          url: string;
          name: string;
          path: string;
          extern: Record<string, unknown>;
        };
        creator: {
          id: string;
          name: string;
          subtitle: string;
          avatar: {
            id: string;
            url: string;
            name: string;
            path: string;
            extern: Record<string, unknown>;
          };
          onTap: Record<string, unknown>;
          extern: Record<string, unknown>;
        };
        titleMeta: Array<{
          name: string;
          onTap: Record<string, unknown>;
          extern: Record<string, unknown>;
        }>;
        metadata: Array<{
          type: string;
          name: string;
          value: Array<{
            name: string;
            onTap: Record<string, unknown>;
            extern: Record<string, unknown>;
          }>;
        }>;
        extern: Record<string, unknown>;
      };
      eps: Array<{
        id?: string;
        name: string;
        order: number;
        requestId?: string;
        storageChapterId?: string;
        logicalKey?: string;
        extern: Record<string, unknown>;
      }>;
      recommend: Array<unknown>;
      totalViews: number;
      totalLikes: number;
      totalComments: number;
      isFavourite: boolean;
      isLiked: boolean;
      allowComments: boolean;
      allowLike: boolean;
      allowCollected: boolean;
      allowDownload: boolean;
      extern: Record<string, unknown>;
    };
    raw: Record<string, unknown>;
  };
};

export type ChapterContentContract = ReadSnapshotContract;

export type ReadSnapshotContract = {
  source: string;
  extern: Record<string, unknown>;
  data: {
    comic: {
      id: string;
      source: string;
      title: string;
      extern: Record<string, unknown>;
    };
    chapter: {
      id?: string;
      name: string;
      order: number;
      requestId?: string;
      storageChapterId?: string;
      logicalKey?: string;
      pages: Array<{
        id: string;
        name: string;
        path: string;
        url: string;
        extern: Record<string, unknown>;
      }>;
      extern: Record<string, unknown>;
    };
    chapters: Array<{
      id?: string;
      name: string;
      order: number;
      requestId?: string;
      storageChapterId?: string;
      logicalKey?: string;
      extern: Record<string, unknown>;
    }>;
  };
};

export type FetchImageBytesContract = {
  nativeBufferId: number;
};

export type SettingsBundleContract = {
  source: string;
  scheme: {
    version: "1.0.0";
    type: "settings";
    sections: Array<{
      id: string;
      title: string;
      fields: Array<{
        key: string;
        kind: "text" | "password" | "switch" | "select" | "choice" | "multiChoice";
        label: string;
        options?: Array<{ label: string; value: unknown }>;
        fnPath?: string;
        persist?: boolean;
      }>;
    }>;
  };
  data: {
    canShowUserInfo: false;
    values: Record<string, unknown>;
  };
};
