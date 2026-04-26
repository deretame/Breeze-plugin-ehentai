export type PluginFunctionItem = {
  id: string;
  title: string;
  action:
    | { type: "openSearch"; payload: { source: string; keyword?: string } }
    | { type: "openComicDetail"; payload: { comicId: string } };
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
        cover: { id: string; url: string; name: string; path: string; extension: Record<string, unknown> };
        creator: {
          id: string;
          name: string;
          subtitle: string;
          avatar: { id: string; url: string; name: string; path: string; extension: Record<string, unknown> };
          onTap: Record<string, unknown>;
          extension: Record<string, unknown>;
        };
        titleMeta: Array<{
          name: string;
          onTap: Record<string, unknown>;
          extension: Record<string, unknown>;
        }>;
        metadata: Array<{
          type: string;
          name: string;
          value: Array<{
            name: string;
            onTap: Record<string, unknown>;
            extension: Record<string, unknown>;
          }>;
        }>;
        extension: Record<string, unknown>;
      };
      eps: Array<{ id: string; name: string; order: number; extension: Record<string, unknown> }>;
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
      extension: Record<string, unknown>;
    };
    raw: Record<string, unknown>;
  };
};

export type ChapterContentContract = {
  source: string;
  comicId: string;
  chapterId: string;
  extern: Record<string, unknown>;
  scheme: { version: "1.0.0"; type: "chapterContent" };
  data: {
    chapter: {
      epId: string;
      epName: string;
      length: number;
      epPages: string;
      docs: Array<{
        id: string;
        name: string;
        path: string;
        url: string;
        extern?: Record<string, unknown>;
      }>;
    };
  };
};

export type ReadPagesCompatContract = {
  source: string;
  scheme: { version: "1.0.0"; type: "readPages" };
  data: {
    paging: { page: number; hasReachedMax: boolean };
    items: Array<{ index: number; url: string; extern: { href: string; reloadKey?: string } }>;
  };
};

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
      id: string;
      name: string;
      order: number;
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
      id: string;
      name: string;
      order: number;
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
