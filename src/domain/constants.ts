export const PLUGIN_SOURCE = "ehentai";
export const PLUGIN_UUID = "dba2a6cf-c495-4416-accf-c29263ab4016";
export const PLUGIN_NAME = "e-hentai";
export const PLUGIN_DESCRIPTION = "e-hentai minimal reader plugin";
export const PLUGIN_VERSION = "0.3.5";
export const PLUGIN_ICON_URL = "";
export const PLUGIN_HOME = "https://github.com/breeze-project-org/Breeze-plugin-ehentai";
export const PLUGIN_UPDATE_URL =
  "https://api.github.com/repos/breeze-project-org/Breeze-plugin-ehentai/releases/latest";
export const PLUGIN_CREATOR = {
  name: "",
  describe: "",
};

export const EH_BASE_URL = "https://e-hentai.org";
export const EX_BASE_URL = "https://exhentai.org";
export const DEFERRED_IMAGE_PATH = "/_breeze/read-image";
export const PREVIEW_IMAGE_PATH = "/_breeze/preview-image";
export const PREVIEW_IMAGE_KIND = "ehentai-preview-native-v1";
export const EH_FORUM_LOGIN_URL = "https://forums.e-hentai.org/index.php?act=Login";
export const EH_FORUM_LOGIN_REDIRECT_URL = "https://forums.e-hentai.org/index.php?";
export const EH_COOKIE_POLL_INTERVAL_MS = 500000;
export const EH_FORUM_COOKIE_CONFIG_KEY = "forumCookie";
export const EH_MEMBER_ID_CONFIG_KEY = "ipb_member_id";
export const EH_PASS_HASH_CONFIG_KEY = "ipb_pass_hash";
export const EH_IGNEOUS_CONFIG_KEY = "igneous";
export const EH_DIRECT_CONNECT_CONFIG_KEY = "directConnect";
export const EH_DIRECT_CUSTOM_IPS_CONFIG_KEY = "directCustomIps";

export const DEFAULT_TIMEOUT_MS = 12_000;
export const MAX_RETRY_ATTEMPTS = 2;
export const MAX_CONCURRENT_REQUESTS = 4;
/** 手动跟随重定向的最大跳数（前置请求由宿主关掉自动跟随，交给插件逐跳跟进）。 */
export const MAX_REDIRECT_STEPS = 5;

export const ALLOWED_ENDPOINT_HOSTS = new Set([
  "e-hentai.org",
  "exhentai.org",
  "api.e-hentai.org",
  "ehgt.org",
]);

export const ALLOWED_MEDIA_HOSTS = new Set([
  "e-hentai.org",
  "exhentai.org",
  "s.exhentai.org",
  "ehgt.org",
]);

export const DEFAULT_SETTINGS = {
  site: "EH",
  imageProxyEnabled: false,
  ipb_member_id: "",
  ipb_pass_hash: "",
  igneous: "",
  forumCookie: "",
  /**
   * 墙内 IP 直连（域名前置）默认关闭。
   * 这是宿主的可选功能（默认关闭的 cargo feature `host-fronting`），
   * 需要宿主同时开启该 feature 才会真正生效；关闭时自动退化为普通请求，无副作用。
   */
  directConnect: false,
  directCustomIps: "",
} as const;

export const FALLBACK_UNKNOWN = "Unknown";
