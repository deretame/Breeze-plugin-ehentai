import type { PluginErrorCode, PluginErrorDetails } from "../domain/types";

function formatDetails(details?: PluginErrorDetails): string {
  if (!details || typeof details !== "object" || Array.isArray(details)) {
    return "";
  }

  const entries = Object.entries(details).filter(([, value]) => value !== undefined);
  if (!entries.length) {
    return "";
  }

  try {
    return JSON.stringify(Object.fromEntries(entries));
  } catch {
    return "";
  }
}

function formatMessage(message: string, details?: PluginErrorDetails): string {
  const normalizedMessage = String(message ?? "").trim() || "Unknown plugin error";
  const detailsText = formatDetails(details);
  if (!detailsText) {
    return normalizedMessage;
  }
  return `${normalizedMessage} | details=${detailsText}`;
}

export class PluginError extends Error {
  public readonly source = "ehentai";

  constructor(
    public readonly code: PluginErrorCode,
    message: string,
    public readonly retryable: boolean,
    public readonly details?: PluginErrorDetails,
  ) {
    super(formatMessage(message, details));
    this.name = "PluginError";
  }
}

export function validationError(message: string, details?: PluginErrorDetails): PluginError {
  return new PluginError("VALIDATION_ERROR", message, false, details);
}

export function networkError(
  message: string,
  details?: PluginErrorDetails,
  retryable = true,
): PluginError {
  return new PluginError("NETWORK_ERROR", message, retryable, details);
}

export function upstreamBlockedError(message: string, details?: PluginErrorDetails): PluginError {
  return new PluginError("UPSTREAM_BLOCKED", message, false, details);
}

export function parseError(message: string, details?: PluginErrorDetails): PluginError {
  return new PluginError("PARSE_ERROR", message, false, details);
}

export function contractError(message: string, details?: PluginErrorDetails): PluginError {
  return new PluginError("CONTRACT_ERROR", message, false, details);
}
