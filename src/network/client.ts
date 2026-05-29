import axios, { type AxiosRequestConfig } from "axios";
import {
  DEFAULT_TIMEOUT_MS,
  MAX_CONCURRENT_REQUESTS,
  MAX_RETRY_ATTEMPTS,
} from "../domain/constants";
import { networkError } from "../errors/plugin-error";

const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
type TextResponseHeaders = Record<string, string | string[] | undefined>;

export type HttpTextResponseMeta = {
  status: number;
  data: string;
  headers: TextResponseHeaders;
};

const http = axios.create({
  timeout: DEFAULT_TIMEOUT_MS,
  maxContentLength: MAX_RESPONSE_BYTES,
  maxBodyLength: MAX_RESPONSE_BYTES,
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
  throw networkError(formatNetworkFailureMessage("Request failed after retries", details), details, true);
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

export const httpClient = {
  async getText(url: string, config?: AxiosRequestConfig): Promise<string> {
    return withRetry(async () => {
      const requestConfig = buildSafeRequestConfig({ ...config, url, method: config?.method ?? "GET" });
      const response = await http.get<string>(url, {
        ...requestConfig,
        responseType: "text",
      });
      ensureContentType(
        response.headers?.["content-type"],
        ["text/html", "application/xhtml+xml"],
        "HTML request",
      );
      return String(response.data ?? "");
    });
  },

  async getTextWithMeta(url: string, config?: AxiosRequestConfig): Promise<HttpTextResponseMeta> {
    return withRetry(async () => {
      const requestConfig = buildSafeRequestConfig({ ...config, url, method: config?.method ?? "GET" });
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

  async postJson<T>(url: string, body: Record<string, unknown>): Promise<T> {
    return withRetry(async () => {
      const response = await http.post<T>(url, body, {
        ...buildSafeRequestConfig({ url, method: "POST" }),
        headers: { "content-type": "application/json" },
      });
      ensureContentType(response.headers?.["content-type"], ["application/json"], "JSON request");
      return response.data;
    });
  },

  async getBytes(
    url: string,
    timeoutMs?: number,
    config?: AxiosRequestConfig,
  ): Promise<Uint8Array> {
    return withRetry(async () => {
      const parsed = new URL(url);
      const response = await http.get<ArrayBuffer>(url, {
        ...buildSafeRequestConfig({ ...config, url, method: config?.method ?? "GET" }),
        responseType: "arraybuffer",
        timeout:
          Number.isFinite(timeoutMs) && Number(timeoutMs) > 0 ? Number(timeoutMs) : undefined,
        headers: {
          Host: parsed.host,
          ...config?.headers,
        },
      });

      const contentType = String(response.headers?.["content-type"] ?? "").toLowerCase();
      if (contentType.includes("text/html") || contentType.includes("application/xhtml+xml")) {
        throw networkError(
          `Unexpected content-type for image request: ${contentType || "missing"}`,
          { url, method: "GET", contentType },
        );
      }

      const buffer = response.data;
      return buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
    });
  },
};
