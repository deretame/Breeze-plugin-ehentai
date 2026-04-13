import type { PluginErrorCode } from "../domain/types";

export class PluginError extends Error {
  public readonly source = "ehentai";

  constructor(
    public readonly code: PluginErrorCode,
    message: string,
    public readonly retryable: boolean,
    public readonly causeValue?: unknown,
  ) {
    super(message);
    this.name = "PluginError";
  }
}

export function validationError(message: string, causeValue?: unknown): PluginError {
  return new PluginError("VALIDATION_ERROR", message, false, causeValue);
}

export function networkError(message: string, causeValue?: unknown, retryable = true): PluginError {
  return new PluginError("NETWORK_ERROR", message, retryable, causeValue);
}

export function upstreamBlockedError(message: string, causeValue?: unknown): PluginError {
  return new PluginError("UPSTREAM_BLOCKED", message, false, causeValue);
}

export function parseError(message: string, causeValue?: unknown): PluginError {
  return new PluginError("PARSE_ERROR", message, false, causeValue);
}

export function contractError(message: string, causeValue?: unknown): PluginError {
  return new PluginError("CONTRACT_ERROR", message, false, causeValue);
}
