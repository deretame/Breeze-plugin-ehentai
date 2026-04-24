export const PLUGIN_SOURCE = "ehentai";
export const PLUGIN_UUID = "dba2a6cf-c495-4416-accf-c29263ab4016";
export const PLUGIN_NAME = "e-hentai";
export const PLUGIN_DESCRIPTION = "e-hentai minimal reader plugin";
export const PLUGIN_VERSION = "0.0.3";
export const PLUGIN_ICON_URL = "";
export const PLUGIN_HOME = "https://github.com/deretame/Breeze-plugin-ehentai";
export const PLUGIN_UPDATE_URL =
  "https://api.github.com/repos/deretame/Breeze-plugin-ehentai/releases/latest";
export const PLUGIN_CREATOR = {
  name: "",
  describe: "",
};

export const EH_BASE_URL = "https://e-hentai.org";
export const EX_BASE_URL = "https://exhentai.org";
export const DEFERRED_IMAGE_PATH = "/_breeze/read-image";

export const DEFAULT_TIMEOUT_MS = 12_000;
export const MAX_RETRY_ATTEMPTS = 2;
export const MAX_CONCURRENT_REQUESTS = 4;

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
} as const;

export const FALLBACK_UNKNOWN = "Unknown";
