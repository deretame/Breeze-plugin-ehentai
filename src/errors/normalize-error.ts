import axios from "axios";
import { contractError, networkError, parseError, PluginError, upstreamBlockedError } from "./plugin-error";

const BLOCKED_MARKERS = ["sad panda", "temporarily banned", "ip address has been", "exhentai"];

export function normalizeError(error: unknown): PluginError {
  if (error instanceof PluginError) {
    return error;
  }

  if (axios.isAxiosError(error)) {
    return networkError(error.message, error, true);
  }

  if (error instanceof Error) {
    const message = error.message || "Unknown plugin error";
    const lower = message.toLowerCase();
    if (BLOCKED_MARKERS.some((marker) => lower.includes(marker))) {
      return upstreamBlockedError(message, error);
    }
    if (error.name === "SyntaxError") {
      return parseError(message, error);
    }
    return contractError(message, error);
  }

  return contractError("Unknown plugin error", error);
}
