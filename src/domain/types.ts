export type SearchComicPayload = {
  keyword?: string;
  page?: number;
  isSearchAggregate?: boolean;
  extern?: Record<string, unknown>;
};

export type ComicDetailPayload = {
  comicId?: string;
  extern?: Record<string, unknown>;
};

export type ChapterPayload = {
  comicId?: string;
  chapterId?: string | number;
  page?: number;
  extern?: Record<string, unknown>;
};

export type FetchImageBytesPayload = {
  url?: string;
  timeoutMs?: number;
  extern?: Record<string, unknown>;
};

export type SiteSetting = "EH" | "EX";

export type PluginSettings = {
  site: SiteSetting;
  imageProxyEnabled: boolean;
  ipb_member_id: string;
  ipb_pass_hash: string;
  igneous: string;
  forumCookie: string;
  /** 墙内 IP 直连（域名前置）开关。 */
  directConnect: boolean;
  /** 自定义 IP 覆盖，格式 `host=ip1,ip2;host2=ip3`。 */
  directCustomIps: string;
};

export type SearchParsedItem = {
  id: string;
  href: string;
  title: string;
  coverUrl: string;
  category: string;
  uploader: string;
};

export type SearchParsed = {
  items: SearchParsedItem[];
  page: number;
  pages: number;
  total: number;
  hasNext: boolean;
  nextUrl?: string;
  prevUrl?: string;
};

export type DetailParsed = {
  gid: string;
  token: string;
  title: string;
  englishTitle?: string;
  japaneseTitle?: string;
  category?: string;
  uploader?: string;
  language?: string;
  fileSize?: string;
  pageCount?: number;
  posted?: string;
  favoritedCount?: number;
  isFavorited: boolean;
  totalComments?: number;
  ratingAverage?: string;
  ratingCount?: number;
  tagsByNamespace: Record<string, string[]>;
  coverUrl?: string;
};

export type ReaderThumbnail = {
  index: number;
  href: string;
  originImageHash?: string;
};

export type ReaderRangeParsed = {
  imageNoFrom: number;
  imageNoTo: number;
  imageCount: number;
  currentPageNo: number;
  pageCount: number;
  thumbnails: ReaderThumbnail[];
};

export type ReaderImageParsed = {
  href: string;
  imageUrl: string;
  reloadKey?: string;
};

export type PluginErrorCode =
  | "VALIDATION_ERROR"
  | "NETWORK_ERROR"
  | "UPSTREAM_BLOCKED"
  | "PARSE_ERROR"
  | "CONTRACT_ERROR"
  | "AUTH_REQUIRED";

export type PluginErrorDetails = Record<string, unknown>;
