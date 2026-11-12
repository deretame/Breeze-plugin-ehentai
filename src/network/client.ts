import axios, { type AxiosRequestConfig } from "axios";
import {
  ALLOWED_ENDPOINT_HOSTS,
  ALLOWED_MEDIA_HOSTS,
  DEFAULT_TIMEOUT_MS,
  MAX_CONCURRENT_REQUESTS,
  MAX_REDIRECT_STEPS,
  MAX_RETRY_ATTEMPTS,
} from "../domain/constants";
import { networkError } from "../errors/plugin-error";

type TextResponseHeaders = Record<string, string | string[] | undefined>;

export type HttpTextResponseMeta = {
  status: number;
  data: string;
  headers: TextResponseHeaders;
};

const http = axios.create({
  timeout: DEFAULT_TIMEOUT_MS,
  maxContentLength: Infinity,
  maxBodyLength: Infinity,
  maxRedirects: 0,
});

function readAxiosErrorDetails(error: unknown): Record<string, unknown> {
  if (!axios.isAxiosError(error)) {
    return { lastErrorMessage: String((error as Error | undefined)?.message ?? error ?? "") };
  }

  return {
    lastErrorMessage: String(error.message ?? ""),
    url: String(error.config?.url ?? ""),
    method: String(error.config?.method ?? "GET").toUpperCase(),
    status: Number(error.response?.status ?? 0) || undefined,
    statusText: String(error.response?.statusText ?? ""),
  };
}

function formatNetworkFailureMessage(message: string, details: Record<string, unknown>): string {
  const parts: string[] = [String(message ?? "").trim() || "Network error"];
  const method = String(details.method ?? "").trim();
  const url = String(details.url ?? "").trim();
  const status = details.status;
  if (method || url) {
    parts.push([method, url].filter(Boolean).join(" "));
  }
  if (status !== undefined && status !== null && String(status).trim()) {
    parts.push(`status=${String(status)}`);
  }
  const lastErrorMessage = String(details.lastErrorMessage ?? "").trim();
  if (lastErrorMessage && lastErrorMessage !== message) {
    parts.push(`cause=${lastErrorMessage}`);
  }
  return parts.join(" | ");
}

export function buildSafeRequestConfig(config?: AxiosRequestConfig): AxiosRequestConfig {
  return {
    ...config,
    maxRedirects: 0,
  };
}

function ensureContentType(
  contentType: unknown,
  allowedMimeTypes: string[],
  requestKind: string,
): void {
  const normalized = String(contentType ?? "").toLowerCase();
  const isAllowed = allowedMimeTypes.some((mimeType) => normalized.includes(mimeType));
  if (!isAllowed) {
    throw networkError(`Unexpected content-type for ${requestKind}: ${normalized || "missing"}`);
  }
}

/**
 * 3xx 需要自己处理：
 * - 宿主开启域名前置时，命中前置表的请求由宿主改为「不跟随重定向」并返回原始 3xx
 *   （重定向目标域名同样要走前置，不能交给 reqwest 用系统 DNS 去追）；
 * - 未开启前置时 reqwest 仍会自动跟随，这里永远不会见到 3xx。
 * 两条路径兼容。
 */
const REDIRECT_STATUS = new Set([301, 302, 303, 307, 308]);
/** 301/302/303 语义：后续请求退化为 GET（EH 的跳转均在此列）。 */
const REDIRECT_DROP_BODY_STATUS = new Set([301, 302, 303]);

export function isRedirectStatus(status: number): boolean {
  return REDIRECT_STATUS.has(status);
}

/** 只跟随插件自身允许名单内的 https 目标，防开放重定向被带出信任域。 */
export function resolveRedirectTarget(location: unknown, currentUrl: string): string {
  const raw = Array.isArray(location) ? String(location[0] ?? "") : String(location ?? "");
  const trimmed = raw.trim();
  if (!trimmed) {
    return "";
  }
  let parsed: URL;
  try {
    parsed = new URL(trimmed, currentUrl);
  } catch {
    return "";
  }
  if (parsed.protocol !== "https:") {
    return "";
  }
  if (!ALLOWED_ENDPOINT_HOSTS.has(parsed.hostname) && !ALLOWED_MEDIA_HOSTS.has(parsed.hostname)) {
    return "";
  }
  return parsed.toString();
}

async function withRetry<T>(executor: () => Promise<T>): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= MAX_RETRY_ATTEMPTS; attempt += 1) {
    try {
      return await executor();
    } catch (error) {
      lastError = error;
      if (attempt >= MAX_RETRY_ATTEMPTS) {
        break;
      }
    }
  }
  const details = {
    attempts: MAX_RETRY_ATTEMPTS + 1,
    ...readAxiosErrorDetails(lastError),
  };
  throw networkError(
    formatNetworkFailureMessage("Request failed after retries", details),
    details,
    true,
  );
}

export async function mapWithConcurrency<T, R>(
  input: T[],
  mapper: (item: T, index: number) => Promise<R>,
  concurrency = MAX_CONCURRENT_REQUESTS,
): Promise<R[]> {
  const result = Array.from<R | undefined>({ length: input.length });
  let pointer = 0;
  const workers = Math.max(1, Math.min(concurrency, input.length));

  await Promise.all(
    Array.from({ length: workers }, async () => {
      while (pointer < input.length) {
        const index = pointer;
        pointer += 1;
        result[index] = await mapper(input[index], index);
      }
    }),
  );

  return result as R[];
}

/** 让 3xx 作为正常响应返回，由调用方手动跟随；>=400 仍然走 axios 错误路径。 */
const ACCEPT_REDIRECT_STATUS = (status: number): boolean => status >= 200 && status < 400;

function redirectFollowError(url: string, status: number): never {
  throw networkError(`Redirect not followable (status=${status})`, {
    url,
    method: "GET",
    status,
  });
}

function tooManyRedirectsError(url: string): never {
  throw networkError(`Too many redirects (>${MAX_REDIRECT_STEPS})`, {
    url,
    method: "GET",
  });
}

export const httpClient = {
  async getText(url: string, config?: AxiosRequestConfig): Promise<string> {
    return withRetry(async () => {
      let currentUrl = url;
      let method = (config?.method ?? "GET").toUpperCase();
      for (let hop = 0; hop <= MAX_REDIRECT_STEPS; hop += 1) {
        const response = await http.get<string>(currentUrl, {
          ...buildSafeRequestConfig({ ...config, url: currentUrl, method }),
          responseType: "text",
          validateStatus: ACCEPT_REDIRECT_STATUS,
        });
        if (isRedirectStatus(response.status)) {
          const nextUrl = resolveRedirectTarget(response.headers?.location, currentUrl);
          if (!nextUrl) {
            redirectFollowError(currentUrl, response.status);
          }
          if (REDIRECT_DROP_BODY_STATUS.has(response.status)) {
            method = "GET";
          }
          currentUrl = nextUrl;
          continue;
        }
        ensureContentType(
          response.headers?.["content-type"],
          ["text/html", "application/xhtml+xml"],
          "HTML request",
        );
        return String(response.data ?? "");
      }
      return tooManyRedirectsError(currentUrl);
    });
  },

  /**
   * 返回原始状态/响应头（里站 igneous 探测逻辑自行处理 302 链，
   * 因此这里不做自动跟随）。
   */
  async getTextWithMeta(url: string, config?: AxiosRequestConfig): Promise<HttpTextResponseMeta> {
    return withRetry(async () => {
      const requestConfig = buildSafeRequestConfig({
        ...config,
        url,
        method: config?.method ?? "GET",
      });
      const response = await http.get<string>(url, {
        ...requestConfig,
        responseType: "text",
        validateStatus: () => true,
      });
      const rawHeaders = response.headers as Record<string, unknown>;
      const headers: TextResponseHeaders = {};
      for (const [key, value] of Object.entries(rawHeaders)) {
        if (Array.isArray(value)) {
          headers[key.toLowerCase()] = value.map((item) => String(item));
          continue;
        }
        if (value === undefined || value === null) {
          continue;
        }
        headers[key.toLowerCase()] = String(value);
      }
      return {
        status: Number(response.status ?? 0),
        data: String(response.data ?? ""),
        headers,
      };
    });
  },

  async postText(
    url: string,
    body: Record<string, string>,
    config?: AxiosRequestConfig,
  ): Promise<string> {
    return withRetry(async () => {
      const encodedBody = new URLSearchParams(body).toString();
      let currentUrl = url;
      let method = "POST";
      let currentBody: string | null = encodedBody;
      for (let hop = 0; hop <= MAX_REDIRECT_STEPS; hop += 1) {
        const requestConfig = buildSafeRequestConfig({
          ...config,
          url: currentUrl,
          method,
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
            ...config?.headers,
          },
        });
        const response =
          method === "POST"
            ? await http.post<string>(currentUrl, currentBody, {
                ...requestConfig,
                responseType: "text",
                validateStatus: ACCEPT_REDIRECT_STATUS,
              })
            : await http.get<string>(currentUrl, {
                ...requestConfig,
                responseType: "text",
                validateStatus: ACCEPT_REDIRECT_STATUS,
              });
        if (isRedirectStatus(response.status)) {
          const nextUrl = resolveRedirectTarget(response.headers?.location, currentUrl);
          if (!nextUrl) {
            redirectFollowError(currentUrl, response.status);
          }
          if (REDIRECT_DROP_BODY_STATUS.has(response.status)) {
            method = "GET";
            currentBody = null;
          }
          currentUrl = nextUrl;
          continue;
        }
        ensureContentType(
          response.headers?.["content-type"],
          ["text/html", "application/xhtml+xml"],
          "HTML form request",
        );
        return String(response.data ?? "");
      }
      return tooManyRedirectsError(currentUrl);
    });
  },

  async postJson<T>(url: string, body: Record<string, unknown>): Promise<T> {
    return withRetry(async () => {
      let currentUrl = url;
      let method = "POST";
      let currentBody: Record<string, unknown> | null = body;
      for (let hop = 0; hop <= MAX_REDIRECT_STEPS; hop += 1) {
        const response =
          method === "POST"
            ? await http.post<T>(currentUrl, currentBody, {
                ...buildSafeRequestConfig({ url: currentUrl, method }),
                headers: { "content-type": "application/json" },
                validateStatus: ACCEPT_REDIRECT_STATUS,
              })
            : await http.get<T>(currentUrl, {
                ...buildSafeRequestConfig({ url: currentUrl, method }),
                validateStatus: ACCEPT_REDIRECT_STATUS,
              });
        if (isRedirectStatus(response.status)) {
          const nextUrl = resolveRedirectTarget(response.headers?.location, currentUrl);
          if (!nextUrl) {
            redirectFollowError(currentUrl, response.status);
          }
          if (REDIRECT_DROP_BODY_STATUS.has(response.status)) {
            method = "GET";
            currentBody = null;
          }
          currentUrl = nextUrl;
          continue;
        }
        ensureContentType(response.headers?.["content-type"], ["application/json"], "JSON request");
        return response.data;
      }
      return tooManyRedirectsError(currentUrl);
    });
  },

  async getBytes(
    url: string,
    timeoutMs?: number,
    config?: AxiosRequestConfig,
  ): Promise<Uint8Array> {
    return withRetry(async () => {
      let currentUrl = url;
      let method = (config?.method ?? "GET").toUpperCase();
      for (let hop = 0; hop <= MAX_REDIRECT_STEPS; hop += 1) {
        const parsed = new URL(currentUrl);
        const response = await http.get<ArrayBuffer>(currentUrl, {
          ...buildSafeRequestConfig({ ...config, url: currentUrl, method }),
          responseType: "arraybuffer",
          timeout:
            Number.isFinite(timeoutMs) && Number(timeoutMs) > 0 ? Number(timeoutMs) : undefined,
          validateStatus: ACCEPT_REDIRECT_STATUS,
          headers: {
            Host: parsed.host,
            ...config?.headers,
          },
        });

        if (isRedirectStatus(response.status)) {
          const nextUrl = resolveRedirectTarget(response.headers?.location, currentUrl);
          if (!nextUrl) {
            redirectFollowError(currentUrl, response.status);
          }
          if (REDIRECT_DROP_BODY_STATUS.has(response.status)) {
            method = "GET";
          }
          currentUrl = nextUrl;
          continue;
        }

        const contentType = String(response.headers?.["content-type"] ?? "").toLowerCase();
        if (contentType.includes("text/html") || contentType.includes("application/xhtml+xml")) {
          throw networkError(
            `Unexpected content-type for image request: ${contentType || "missing"}`,
            { url: currentUrl, method: "GET", contentType },
          );
        }

        const buffer = response.data;
        return buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
      }
      return tooManyRedirectsError(currentUrl);
    });
  },
};
