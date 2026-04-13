import axios, { type AxiosRequestConfig } from "axios";
import { DEFAULT_TIMEOUT_MS, MAX_CONCURRENT_REQUESTS, MAX_RETRY_ATTEMPTS } from "../domain/constants";
import { networkError } from "../errors/plugin-error";

const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;

const http = axios.create({
  timeout: DEFAULT_TIMEOUT_MS,
  maxContentLength: MAX_RESPONSE_BYTES,
  maxBodyLength: MAX_RESPONSE_BYTES,
  maxRedirects: 0,
});

export function buildSafeRequestConfig(config?: AxiosRequestConfig): AxiosRequestConfig {
  return {
    ...(config ?? {}),
    maxRedirects: 0,
  };
}

function ensureContentType(contentType: unknown, allowedMimeTypes: string[], requestKind: string): void {
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
  throw networkError("Request failed after retries", lastError, true);
}

export async function mapWithConcurrency<T, R>(
  input: T[],
  mapper: (item: T, index: number) => Promise<R>,
  concurrency = MAX_CONCURRENT_REQUESTS,
): Promise<R[]> {
  const result: R[] = new Array(input.length);
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

  return result;
}

export const httpClient = {
  async getText(url: string, config?: AxiosRequestConfig): Promise<string> {
    return withRetry(async () => {
      const response = await http.get<string>(url, {
        ...buildSafeRequestConfig(config),
        responseType: "text",
      });
      ensureContentType(response.headers?.["content-type"], ["text/html", "application/xhtml+xml"], "HTML request");
      return String(response.data ?? "");
    });
  },

  async postJson<T>(url: string, body: Record<string, unknown>): Promise<T> {
    return withRetry(async () => {
      const response = await http.post<T>(url, body, {
        headers: { "content-type": "application/json" },
      });
      ensureContentType(response.headers?.["content-type"], ["application/json"], "JSON request");
      return response.data;
    });
  },

  async getBytes(url: string, timeoutMs?: number): Promise<Uint8Array> {
    return withRetry(async () => {
      const parsed = new URL(url);
      const response = await http.get<ArrayBuffer>(url, {
        ...buildSafeRequestConfig(),
        responseType: "arraybuffer",
        timeout: Number.isFinite(timeoutMs) && Number(timeoutMs) > 0 ? Number(timeoutMs) : undefined,
        headers: { Host: parsed.host },
      });

      const contentType = String(response.headers?.["content-type"] ?? "").toLowerCase();
      if (contentType.includes("text/html") || contentType.includes("application/xhtml+xml")) {
        throw networkError(`Unexpected content-type for image request: ${contentType || "missing"}`);
      }

      const buffer = response.data;
      return buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
    });
  },
};
