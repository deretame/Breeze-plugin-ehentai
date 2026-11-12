import { flutterTools } from "breeze-plugin-kit";

/**
 * 域名前置（IP 直连）要求的最低宿主版本。
 *
 * 宿主从 3.0.38 起才提供前置能力；3.0.37 及更早版本上即使插件下发了前置表，
 * 请求也只会走普通链路，所以这些版本直接隐藏整个功能（设置页不显示、也不下发）。
 */
export const FRONTING_MIN_APP_VERSION = "3.0.37";

/** `dart.getAppVersion` 返回的是 JSON 编码串（首尾带引号），先剥掉。 */
export function normalizeAppVersion(raw: unknown): string {
  return String(raw ?? "")
    .trim()
    .replace(/^"+|"+$/g, "");
}

/** 按段比较版本号：4.0.0 > 3.0.34，缺段按 0 补齐。 */
export function compareVersions(a: string, b: string): number {
  const pa = normalizeAppVersion(a)
    .split(".")
    .map((part) => Number(part) || 0);
  const pb = normalizeAppVersion(b)
    .split(".")
    .map((part) => Number(part) || 0);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i += 1) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (diff !== 0) {
      return diff;
    }
  }
  return 0;
}

/** 宿主版本是否支持域名前置（必须严格高于 3.0.37）。 */
export function supportsFrontingVersion(version: string): boolean {
  return compareVersions(version, FRONTING_MIN_APP_VERSION) > 0;
}

let cachedAppVersion: string | null = null;

/**
 * 读取并缓存宿主版本。
 *
 * 拿不到时（纯 Node 测试环境没有 `bridge`）返回空串，按「不支持」处理。
 */
export async function getAppVersionCached(): Promise<string> {
  if (cachedAppVersion !== null) {
    return cachedAppVersion;
  }
  try {
    const version = normalizeAppVersion(await flutterTools.getAppVersion());
    // 只缓存看起来像版本号的返回值：init 早期 bridge 没就绪 / PackageInfo 失败时
    // 不要把它永久钉成「不支持」，下次调用还能重新读。
    if (/^\d/.test(version)) {
      cachedAppVersion = version;
    }
    return version;
  } catch {
    return "";
  }
}

/** 测试用：重置版本缓存。 */
export function resetAppVersionCache(): void {
  cachedAppVersion = null;
}
