import { buildUnauthorizedError, flutterTools } from "breeze-plugin-kit";
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

/**
 * 新宿主抛 unauthorized JSON（跳登录页），旧宿主抛老格式普通消息
 *（旧登录页是账号密码表单，cookie 登录用不上；toast 指引去设置页）。
 */
function compareVersions(a: string, b: string): number {
  const clean = (v: string) => String(v ?? "").trim().replace(/^"+|"+$/g, "");
  const pa = clean(a).split(".").map((x) => Number(x) || 0);
  const pb = clean(b).split(".").map((x) => Number(x) || 0);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i += 1) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

export async function authRequiredError(
  message: string,
  details?: PluginErrorDetails,
): Promise<PluginError> {
  const cleanMessage = String(message ?? "").trim() || "登录过期，请重新登录";
  const version = await flutterTools.getAppVersion();
  if (compareVersions(version, "3.0.34") < 0) {
    return new PluginError("AUTH_REQUIRED", cleanMessage, false, details);
  }
  const unauthorized = buildUnauthorizedError("ehentai", cleanMessage);
  return new PluginError("AUTH_REQUIRED", unauthorized.message, false, details);
}

export function contractError(message: string, details?: PluginErrorDetails): PluginError {
  return new PluginError("CONTRACT_ERROR", message, false, details);
}
