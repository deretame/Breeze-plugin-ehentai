import axios from "axios";
import {
  contractError,
  networkError,
  parseError,
  PluginError,
  upstreamBlockedError,
} from "./plugin-error";

const BLOCKED_MARKERS = ["sad panda", "temporarily banned", "ip address has been", "exhentai"];

export function normalizeError(error: unknown): PluginError {
  if (error instanceof PluginError) {
    return error;
  }

  if (axios.isAxiosError(error)) {
    return networkError(
      error.message,
      {
        lastErrorMessage: error.message,
        url: String(error.config?.url ?? ""),
        method: String(error.config?.method ?? "GET").toUpperCase(),
        status: Number(error.response?.status ?? 0) || undefined,
        statusText: String(error.response?.statusText ?? ""),
      },
      true,
    );
  }

  if (error instanceof Error) {
    const message = error.message || "Unknown plugin error";
    const lower = message.toLowerCase();
    if (BLOCKED_MARKERS.some((marker) => lower.includes(marker))) {
      return upstreamBlockedError(message, { lastErrorMessage: message, name: error.name });
    }
    if (error.name === "SyntaxError") {
      return parseError(message, { lastErrorMessage: message, name: error.name });
    }
    return contractError(message, { lastErrorMessage: message, name: error.name });
  }

  return contractError("Unknown plugin error", {
    lastErrorMessage: String(error),
  });
}
