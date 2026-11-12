import { flutterTools, pluginConfig, SettingsBundleContract } from "breeze-plugin-kit";
import {
  DEFAULT_SETTINGS,
  EH_DIRECT_CONNECT_CONFIG_KEY,
  EH_DIRECT_CUSTOM_IPS_CONFIG_KEY,
  EH_DIRECT_PROBE_CACHE_CONFIG_KEY,
  EH_FORUM_COOKIE_CONFIG_KEY,
  EH_IGNEOUS_CONFIG_KEY,
  EH_MEMBER_ID_CONFIG_KEY,
  EH_PASS_HASH_CONFIG_KEY,
  EX_BASE_URL,
} from "../domain/constants";
import type { PluginSettings } from "../domain/types";
import { mapSettingsBundle } from "../mappers/settings.mapper";
import { httpClient, type HttpTextResponseMeta } from "../network/client";
import {
  applyProbeCache,
  describeFrontingStatus,
  frontingAvailable,
  hostSupportsFrontProbe,
  hostSupportsFronting,
  isProbeCacheFresh,
  optimizeFrontHosts,
  readHostFrontHosts,
  resolveFrontHosts,
  syncFrontHostsToHost,
  type FrontProbeCache,
} from "../network/ip-direct";
import { asRecord, validateSettingsInput } from "../utils/guards";
import { compareVersions, getAppVersionCached, supportsFrontingVersion } from "../utils/version";

const COOKIE_NAME_BLACKLIST = new Set(["cf_clearance"]);
const EX_AUTH_REDIRECT_ALLOWED_HOSTS = new Set(["exhentai.org", "forums.e-hentai.org"]);
const EX_AUTH_REDIRECT_MAX_STEPS = 6;
const IGNEOUS_PLACEHOLDER_VALUES = new Set(["mystery"]);

let exAccessDeniedCached = false;
let exFallbackNotified = false;

function decodeConfigString(raw: unknown, fallback = ""): string {
  if (raw === undefined || raw === null) {
    return fallback;
  }
  if (typeof raw === "object") {
    const map = raw as Record<string, unknown>;
    if (map.ok === true && "value" in map) {
      return decodeConfigString(map.value, fallback);
    }
    return fallback;
  }
  const text = String(raw);
  if (!text.trim()) {
    return fallback;
  }
  try {
    const parsed = JSON.parse(text.trim());
    if (
      parsed &&
      typeof parsed === "object" &&
      (parsed as Record<string, unknown>).ok === true &&
      "value" in (parsed as Record<string, unknown>)
    ) {
      return decodeConfigString((parsed as Record<string, unknown>).value, fallback);
    }
    if (typeof parsed === "string" || typeof parsed === "number" || typeof parsed === "boolean") {
      return String(parsed);
    }
  } catch {
    // noop
  }
  return text;
}

function splitCookiePair(rawPair: string): { name: string; value: string } | null {
  const token = String(rawPair ?? "").trim();
  if (!token) {
    return null;
  }
  const separator = token.indexOf("=");
  if (separator <= 0) {
    return null;
  }
  const name = token.slice(0, separator).trim();
  const value = token.slice(separator + 1).trim();
  if (!name) {
    return null;
  }
  return { name, value };
}

export function removeCookieNames(rawCookie: unknown, cookieNames: string[]): string {
  const normalized = sanitizeForumCookie(rawCookie);
  if (!normalized) {
    return "";
  }

  const denyList = new Set(
    (Array.isArray(cookieNames) ? cookieNames : [])
      .map((item) =>
        String(item ?? "")
          .trim()
          .toLowerCase(),
      )
      .filter(Boolean),
  );
  if (!denyList.size) {
    return normalized;
  }

  return normalized
    .split(";")
    .map((item) => item.trim())
    .filter(Boolean)
    .map((token) => splitCookiePair(token))
    .filter((pair): pair is { name: string; value: string } => Boolean(pair))
    .filter((pair) => !denyList.has(pair.name.toLowerCase()))
    .map((pair) => `${pair.name}=${pair.value}`)
    .join("; ");
}

export function findCookieValue(rawCookie: string, name: string): string {
  const normalized = sanitizeForumCookie(rawCookie);
  if (!normalized) {
    return "";
  }
  const target = name.toLowerCase();
  const tokens = normalized
    .split(";")
    .map((item) => item.trim())
    .filter(Boolean);
  for (const token of tokens) {
    const pair = splitCookiePair(token);
    if (!pair) {
      continue;
    }
    if (pair.name.toLowerCase() === target) {
      return pair.value;
    }
  }
  return "";
}

function hasUsableIgneous(rawCookie: string): boolean {
  const value = findCookieValue(rawCookie, "igneous").trim().toLowerCase();
  if (!value) {
    return false;
  }
  if (IGNEOUS_PLACEHOLDER_VALUES.has(value)) {
    return false;
  }
  return true;
}

function readHeaderValue(headers: HttpTextResponseMeta["headers"], name: string): string {
  const raw = headers[name.toLowerCase()];
  if (Array.isArray(raw)) {
    return String(raw[0] ?? "").trim();
  }
  return String(raw ?? "").trim();
}

function readSetCookiePairs(headers: HttpTextResponseMeta["headers"]): string[] {
  const raw = headers["set-cookie"];
  const setCookieEntries = Array.isArray(raw) ? raw : typeof raw === "string" ? [raw] : [];
  const pairs: string[] = [];
  for (const entry of setCookieEntries) {
    const firstToken =
      String(entry ?? "")
        .split(";")[0]
        ?.trim() ?? "";
    const pair = splitCookiePair(firstToken);
    if (!pair) {
      continue;
    }
    pairs.push(`${pair.name}=${pair.value}`);
  }
  return pairs;
}

function mergeCookiePairs(baseCookie: string, pairs: string[]): string {
  if (!pairs.length) {
    return sanitizeForumCookie(baseCookie);
  }
  return sanitizeForumCookie([baseCookie, ...pairs].join("; "));
}

function resolveRedirectUrl(location: string, currentUrl: string): string {
  const rawLocation = String(location ?? "").trim();
  if (!rawLocation) {
    return "";
  }
  let parsed: URL;
  try {
    parsed = new URL(rawLocation, currentUrl);
  } catch {
    return "";
  }
  if (parsed.protocol !== "https:") {
    return "";
  }
  if (!EX_AUTH_REDIRECT_ALLOWED_HOSTS.has(parsed.hostname)) {
    return "";
  }
  return parsed.toString();
}

async function tryResolveExhentaiIgneous(rawCookie: string): Promise<string> {
  let currentCookie = sanitizeForumCookie(rawCookie);
  if (!currentCookie) {
    return currentCookie;
  }

  // 里站的 igneous 探测链要带上 JHenTai 的默认 cookie（`nw=1` / `datatags=1`），
  // 否则服务端返回的跳转形态与预期不同。
  const defaultCookie = DEFAULT_EH_COOKIE_PAIRS.join("; ");

  let currentUrl = EX_BASE_URL;
  for (let step = 0; step < EX_AUTH_REDIRECT_MAX_STEPS; step += 1) {
    const response = await httpClient.getTextWithMeta(currentUrl, {
      headers: { Cookie: `${defaultCookie}; ${currentCookie}` },
    });

    const setCookiePairs = readSetCookiePairs(response.headers);
    currentCookie = mergeCookiePairs(currentCookie, setCookiePairs);

    if (step === 0 && response.status === 200 && !response.data.trim()) {
      exAccessDeniedCached = true;
      return removeCookieNames(currentCookie, ["igneous"]);
    }

    if (hasUsableIgneous(currentCookie)) {
      await saveCookiePart(EH_IGNEOUS_CONFIG_KEY, findCookieValue(currentCookie, "igneous"));
      return currentCookie;
    }

    if (response.status !== 302) {
      return currentCookie;
    }

    const nextUrl = resolveRedirectUrl(readHeaderValue(response.headers, "location"), currentUrl);
    if (!nextUrl) {
      return currentCookie;
    }
    currentUrl = nextUrl;
  }

  return currentCookie;
}

async function maybeRefreshExhentaiCookie(settings: PluginSettings): Promise<PluginSettings> {
  const normalizedCookie = sanitizeForumCookie(settings.forumCookie);
  if (settings.site !== "EX" || !normalizedCookie) {
    return settings;
  }

  if (hasUsableIgneous(normalizedCookie)) {
    return settings;
  }
  if (exAccessDeniedCached) {
    await saveCookiePart(EH_IGNEOUS_CONFIG_KEY, "");
    return validateSettingsInput({ ...settings, igneous: "" });
  }
  try {
    const resolvedCookie = await tryResolveExhentaiIgneous(normalizedCookie);
    return validateSettingsInput({
      ...settings,
      ipb_member_id: findCookieValue(resolvedCookie, "ipb_member_id") || settings.ipb_member_id,
      ipb_pass_hash: findCookieValue(resolvedCookie, "ipb_pass_hash") || settings.ipb_pass_hash,
      igneous: findCookieValue(resolvedCookie, "igneous"),
    });
  } catch (error) {
    console.warn("[EH] EX igneous refresh failed", error);
    return settings;
  }
}

async function fallbackToEhIfExAccessDenied(settings: PluginSettings): Promise<PluginSettings> {
  if (settings.site !== "EX" || !exAccessDeniedCached) {
    return settings;
  }

  try {
    await pluginConfig.save("site", "EH");
  } catch {
    // ignore persist failure and still fallback for current request
  }

  if (!exFallbackNotified) {
    exFallbackNotified = true;
    try {
      await flutterTools.showToast({
        message: "ehentai 无里站权限，已回退",
        level: "warning",
      });
    } catch {
      // ignore toast failure
    }
  }

  return {
    ...settings,
    site: "EH",
  };
}

export function sanitizeForumCookie(rawCookie: unknown): string {
  const raw = String(rawCookie ?? "").trim();
  if (!raw) {
    return "";
  }

  const pairs = new Map<string, string>();
  const tokens = raw
    .split(";")
    .map((item) => item.trim())
    .filter(Boolean);

  for (const token of tokens) {
    const pair = splitCookiePair(token);
    if (!pair) {
      continue;
    }
    if (COOKIE_NAME_BLACKLIST.has(pair.name.toLowerCase())) {
      continue;
    }
    pairs.set(pair.name, pair.value);
  }

  return Array.from(pairs.entries())
    .map(([name, value]) => `${name}=${value}`)
    .join("; ");
}

/**
 * JHenTai 无条件注入的两个默认 cookie（`eh_cookie_manager.dart`）：
 * - `nw=1`：标记「无宽度的窄版页面」，影响页面 HTML 的排版；
 * - `datatags=1`：**关键**——只有带上它，详情页缩略图节点才会输出
 *   `data-orghash`（原图 hash）。JHenTai 用它把 MPV 链接改写成
 *   `/s/{orghash前10位}/{gid}-{pageNo}` 的图片页链接（`GalleryThumbnail.replacedMPVHref`）。
 *   没有它，MPV 链接就无法改写，图片页解析会退化。
 */
const DEFAULT_EH_COOKIE_PAIRS = ["nw=1", "datatags=1"] as const;

/**
 * 构造请求头。
 *
 * 始终带上 JHenTai 的默认 cookie；用户填的论坛 cookie（`ipb_member_id` /
 * `ipb_pass_hash` / `igneous`）叠加在后面。同名项以用户值为准。
 */
export function buildRequestHeaders(settings: PluginSettings): Record<string, string> {
  const cookie = sanitizeForumCookie(settings.forumCookie);
  const pairs = new Map<string, string>();
  for (const pair of DEFAULT_EH_COOKIE_PAIRS) {
    const [name, ...rest] = pair.split("=");
    pairs.set(name, rest.join("="));
  }
  for (const token of cookie.split(";")) {
    const parsed = splitCookiePair(token.trim());
    if (!parsed) {
      continue;
    }
    pairs.set(parsed.name, parsed.value);
  }
  const merged = Array.from(pairs.entries())
    .map(([name, value]) => `${name}=${value}`)
    .join("; ");
  if (!merged) {
    return {};
  }
  return { Cookie: merged };
}

/**
 * 判断当前设置里是否带真正的登录 cookie。
 *
 * 注意：`buildRequestHeaders` 现在恒会带上 `nw=1` / `datatags=1` 两个默认
 * cookie（JHenTai 同款），所以「是否登录」不能靠 `requestConfig` 是否为空判断，
 * 必须看有没有 `ipb_member_id` / `ipb_pass_hash` 这类真正的凭据。
 */
export function hasAuthCookie(settings: PluginSettings): boolean {
  const cookie = sanitizeForumCookie(settings.forumCookie);
  if (!cookie) {
    return false;
  }
  const hasMemberId = Boolean(findCookieValue(cookie, "ipb_member_id").trim());
  const hasPassHash = Boolean(findCookieValue(cookie, "ipb_pass_hash").trim());
  return hasMemberId || hasPassHash;
}

export function buildRequestConfig(
  settings: PluginSettings,
): { headers: Record<string, string> } | undefined {
  const headers = buildRequestHeaders(settings);
  if (!Object.keys(headers).length) {
    return undefined;
  }
  return { headers };
}

async function loadConfigString(key: string, fallback = ""): Promise<string> {
  try {
    const raw = await pluginConfig.load(key, fallback);
    const normalized = decodeConfigString(raw, fallback);
    const currentRaw = typeof raw === "string" ? raw : raw == null ? "" : String(raw);
    if (currentRaw !== normalized) {
      try {
        await pluginConfig.save(key, normalized);
      } catch {
        // ignore normalize write errors
      }
    }
    return normalized;
  } catch {
    return fallback;
  }
}

export function buildForumCookie(parts: {
  ipb_member_id?: string;
  ipb_pass_hash?: string;
  igneous?: string;
}): string {
  const pairs = [
    parts.ipb_member_id ? `ipb_member_id=${parts.ipb_member_id}` : "",
    parts.ipb_pass_hash ? `ipb_pass_hash=${parts.ipb_pass_hash}` : "",
    parts.igneous ? `igneous=${parts.igneous}` : "",
  ].filter(Boolean);
  return sanitizeForumCookie(pairs.join("; "));
}

export async function saveCookiePart(key: string, rawValue: unknown): Promise<string> {
  const value = String(rawValue ?? "").trim();
  try {
    await pluginConfig.save(key, value);
  } catch {
    // In local tests there is no host bridge; keep graceful fallback.
  }
  return value;
}

export function resetExAccessProbeCache(): void {
  exAccessDeniedCached = false;
  exFallbackNotified = false;
}

export async function migrateLegacyForumCookieIfNeeded(): Promise<boolean> {
  const [legacyForumCookie, memberId, passHash, igneous] = await Promise.all([
    loadConfigString(EH_FORUM_COOKIE_CONFIG_KEY, ""),
    loadConfigString(EH_MEMBER_ID_CONFIG_KEY, ""),
    loadConfigString(EH_PASS_HASH_CONFIG_KEY, ""),
    loadConfigString(EH_IGNEOUS_CONFIG_KEY, ""),
  ]);

  if (!legacyForumCookie) {
    return false;
  }
  if (memberId || passHash || igneous) {
    return false;
  }

  const legacyMemberId = findCookieValue(legacyForumCookie, "ipb_member_id");
  const legacyPassHash = findCookieValue(legacyForumCookie, "ipb_pass_hash");
  const legacyIgneous = findCookieValue(legacyForumCookie, "igneous");

  await Promise.all([
    legacyMemberId ? saveCookiePart(EH_MEMBER_ID_CONFIG_KEY, legacyMemberId) : Promise.resolve(),
    legacyPassHash ? saveCookiePart(EH_PASS_HASH_CONFIG_KEY, legacyPassHash) : Promise.resolve(),
    legacyIgneous ? saveCookiePart(EH_IGNEOUS_CONFIG_KEY, legacyIgneous) : Promise.resolve(),
  ]);

  try {
    await pluginConfig.save(EH_FORUM_COOKIE_CONFIG_KEY, "");
  } catch {
    // ignore clear failure
  }

  return true;
}

function readExternString(extern: Record<string, unknown>, key: string): string {
  if (extern[key] === undefined || extern[key] === null) {
    return "";
  }
  return String(extern[key] ?? "").trim();
}

export async function readSettings(
  extern?: Record<string, unknown>,
  options?: { skipExProbe?: boolean },
): Promise<PluginSettings> {
  const externMap = asRecord(extern);
  const [
    storedSite,
    storedImageProxyEnabled,
    storedMemberId,
    storedPassHash,
    storedIgneous,
    storedDirectConnect,
    storedDirectCustomIps,
  ] = await Promise.all([
    loadConfigString("site", DEFAULT_SETTINGS.site),
    loadConfigString("imageProxyEnabled", String(DEFAULT_SETTINGS.imageProxyEnabled)),
    loadConfigString(EH_MEMBER_ID_CONFIG_KEY, DEFAULT_SETTINGS.ipb_member_id),
    loadConfigString(EH_PASS_HASH_CONFIG_KEY, DEFAULT_SETTINGS.ipb_pass_hash),
    loadConfigString(EH_IGNEOUS_CONFIG_KEY, DEFAULT_SETTINGS.igneous),
    loadConfigString(EH_DIRECT_CONNECT_CONFIG_KEY, String(DEFAULT_SETTINGS.directConnect)),
    loadConfigString(EH_DIRECT_CUSTOM_IPS_CONFIG_KEY, DEFAULT_SETTINGS.directCustomIps),
  ]);

  const merged = {
    site: readExternString(externMap, "site") || storedSite,
    imageProxyEnabled:
      externMap.imageProxyEnabled !== undefined
        ? externMap.imageProxyEnabled
        : storedImageProxyEnabled,
    ipb_member_id: readExternString(externMap, EH_MEMBER_ID_CONFIG_KEY) || storedMemberId,
    ipb_pass_hash: readExternString(externMap, EH_PASS_HASH_CONFIG_KEY) || storedPassHash,
    igneous: readExternString(externMap, EH_IGNEOUS_CONFIG_KEY) || storedIgneous,
    directConnect:
      externMap.directConnect !== undefined ? externMap.directConnect : storedDirectConnect,
    directCustomIps:
      readExternString(externMap, EH_DIRECT_CUSTOM_IPS_CONFIG_KEY) || storedDirectCustomIps,
  };

  // Backward compatibility: legacy extern aggregate cookie overrides parts.
  const legacyExternCookie =
    readExternString(externMap, EH_FORUM_COOKIE_CONFIG_KEY) ||
    readExternString(externMap, "cookie");
  if (legacyExternCookie) {
    merged.ipb_member_id =
      findCookieValue(legacyExternCookie, "ipb_member_id") || merged.ipb_member_id;
    merged.ipb_pass_hash =
      findCookieValue(legacyExternCookie, "ipb_pass_hash") || merged.ipb_pass_hash;
    merged.igneous = findCookieValue(legacyExternCookie, "igneous") || merged.igneous;
  }

  let settings = validateSettingsInput(merged);
  settings = { ...settings, forumCookie: buildForumCookie(settings) };

  // 墙内直连：宿主版本 > 3.0.37 且具备前置能力时才下发 host->IP 表。
  const directEnabled = await applyDirectConnect(settings);
  if (!directEnabled) {
    settings = { ...settings, directConnect: false };
  }

  if (!options?.skipExProbe) {
    settings = await maybeRefreshExhentaiCookie(settings);
    settings = { ...settings, forumCookie: buildForumCookie(settings) };
    settings = await fallbackToEhIfExAccessDenied(settings);
  }

  return {
    ...settings,
    forumCookie: buildForumCookie(settings),
  };
}

// 优选缓存读一次就够：内容按 IP 交集匹配，用户改自定义 IP 时自动失效。
let probeCacheMemo: FrontProbeCache | null | undefined;
// 后台探测只跑一轮，避免每次 readSettings 都重复触发。
let probeRefreshInFlight: Promise<void> | null = null;
// 每次 applyDirectConnect 递增：探测期间用户改了设置/关了开关时，丢弃旧结果。
let frontingGeneration = 0;
let frontingEnabled = false;

function parseProbeCache(raw: string): FrontProbeCache | null {
  if (!raw) {
    return null;
  }
  try {
    const parsed = JSON.parse(raw) as Partial<FrontProbeCache>;
    if (
      !parsed ||
      typeof parsed.at !== "number" ||
      !parsed.table ||
      typeof parsed.table !== "object"
    ) {
      return null;
    }
    return { at: parsed.at, table: parsed.table as Record<string, string[]> };
  } catch {
    return null;
  }
}

async function readProbeCache(): Promise<FrontProbeCache | null> {
  if (probeCacheMemo !== undefined) {
    return probeCacheMemo;
  }
  const raw = await loadConfigString(EH_DIRECT_PROBE_CACHE_CONFIG_KEY);
  probeCacheMemo = parseProbeCache(raw);
  return probeCacheMemo;
}

async function writeProbeCache(table: Record<string, string[]>): Promise<void> {
  const cache: FrontProbeCache = { at: Date.now(), table };
  probeCacheMemo = cache;
  try {
    await pluginConfig.save(EH_DIRECT_PROBE_CACHE_CONFIG_KEY, JSON.stringify(cache));
  } catch {
    // 缓存写失败只影响下次启动要不要重新探测，不影响本次生效。
  }
}

/**
 * 后台跑一轮 IP 连通性测试，完成后写回前置表并缓存。
 *
 * 刻意不 await：`readSettings` 在每次请求链路上都会调用，探测要十几秒，
 * 阻塞会把搜索 / 详情卡死。先下发静态表保证可用，优选结果到了再热替换。
 */
function refreshProbeCacheInBackground(base: Record<string, string[]>, generation: number): void {
  if (probeRefreshInFlight) {
    return;
  }
  probeRefreshInFlight = (async () => {
    try {
      const optimized = await optimizeFrontHosts(base);
      await writeProbeCache(optimized);
      // 探测期间开关被关掉或设置变了：缓存照写，但不要覆盖当前生效的表。
      if (frontingEnabled && generation === frontingGeneration) {
        syncFrontHostsToHost(optimized);
        console.log(`[EH] 前置 IP 连通性测试完成: ${describeFrontingStatus(optimized)}`);
      }
    } catch (error) {
      console.warn("[EH] 前置 IP 连通性测试失败，继续使用静态表", error);
    } finally {
      probeRefreshInFlight = null;
    }
  })();
}

/**
 * 应用墙内 IP 直连配置。
 * - 宿主版本 <= 3.0.37、能力缺失或 directConnect=false 时下发空表（= 关闭前置）；
 * - 有优选缓存时直接用缓存里的 IP 子集，没有/过期时先下发静态表、后台探测；
 * - 表内容无变化时不会重复调用宿主（幂等）。
 * 返回是否真正开启了前置（版本与能力都满足且开关打开）。
 */
export async function applyDirectConnect(settings: PluginSettings): Promise<boolean> {
  const generation = ++frontingGeneration;
  const available = await frontingAvailable();
  if (!available || !settings.directConnect) {
    frontingEnabled = false;
    const result = syncFrontHostsToHost({});
    if (result.supported && result.changed) {
      console.log("[EH] 墙内直连已关闭");
    }
    return false;
  }

  const base = resolveFrontHosts(settings.directCustomIps);
  const cache = await readProbeCache();
  const initial = applyProbeCache(base, cache);
  const result = syncFrontHostsToHost(initial);
  if (result.supported && result.changed) {
    console.log(`[EH] 墙内直连已启用: ${describeFrontingStatus(initial)}`);
  }
  frontingEnabled = true;

  // 缓存缺失/过期时后台探测一次；宿主没有探测能力就跳过，只用静态表。
  if (hostSupportsFrontProbe() && !isProbeCacheFresh(cache)) {
    refreshProbeCacheInBackground(base, generation);
  }

  return result.supported && Object.keys(initial).length > 0;
}

/** 设置页 / 调试用：当前直连状态。 */
export async function readDirectConnectStatus(): Promise<{
  hostSupported: boolean;
  summary: string;
  hostFrontHosts: string | null;
}> {
  const supported = await frontingAvailable();
  return {
    hostSupported: supported,
    summary: supported
      ? describeFrontingStatus(resolveFrontHosts())
      : "宿主版本过低或不支持（需 Breeze > 3.0.37）",
    hostFrontHosts: readHostFrontHosts(),
  };
}

export async function getSettingsBundleService(
  extern?: Record<string, unknown>,
): Promise<SettingsBundleContract> {
  const values = await readSettings(extern, { skipExProbe: true });
  const version = await getAppVersionCached();
  return mapSettingsBundle(values, {
    legacyHost: compareVersions(version, "3.0.34") < 0,
    fronting: supportsFrontingVersion(version) && hostSupportsFronting(),
  });
}
