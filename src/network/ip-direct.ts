/**
 * 墙内直连（IP 前置 / domain fronting）。
 *
 * 背景：
 * - e-hentai.org / exhentai.org 在墙内走系统 DNS + SNI 时会被 RST，
 *   但直连站点 IP + 不带 SNI 的 TLS + `Host` 头可以穿透（JHenTai 同款思路）。
 * - Breeze 宿主的 JS 桥接底层是 reqwest，会协商 HTTP/2；而域名前置在 h2 下
 *   会被 Cloudflare / Apache 以 400 拒绝（:authority 取的是 URL 里的 IP）。
 *   因此必须由宿主把命中前置表的请求改为「IP URL + Host 头 + 强制 HTTP/1.1」。
 *
 * 本模块只负责：
 * 1. 维护 host -> IP 表（内置实测表 + 用户覆盖）；
 * 2. 确认宿主版本（> 3.0.37）与前置能力都可用；
 * 3. 把合并后的表下发给宿主（幂等，无变化不重复下发）；
 * 4. 提供状态查询，供设置页展示。
 *
 * 实际的 IP 轮询、不健康剔除、URL 改写、Host 头注入、强制 h1 都在宿主
 * （rust/rquickjs_playground/src/web_runtime/http.rs）完成。
 */

import {
  getFrontHosts,
  pickBestFrontIps,
  probeFrontHosts as probeHostFrontHosts,
  setFrontHosts,
  type FrontHostTable,
  type ProbeFrontHostsResult,
} from "breeze-plugin-kit";
import { getAppVersionCached, supportsFrontingVersion } from "../utils/version";

/**
 * 旧宿主只有内部函数、没有 `fronting` 对象时的能力探测入口。
 * 实际操作统一走 kit 的封装，这里只用来判断「宿主到底支不支持」。
 */
const LEGACY_SET_FRONT_HOSTS = "__http_set_front_hosts";
const LEGACY_PROBE_FRONT_HOSTS = "__http_probe_front_hosts";

/**
 * 内置 IP 表。
 *
 * 来源与验证（2026-10-28 全表实测；2026-11-02 复测：178.175.132.19 已恢复，
 * 同时移除 hath.network，现为 6 域名 / 29 IP）：
 * - e-hentai.org / forums.e-hentai.org：JHenTai 生产表；2 IP 均实测 200 真页面。
 *   forums 在无 SNI 时返回 Cloudflare 的「Just a moment...」JS 挑战页（403），
 *   但 **TCP 与 TLS 均正常**——igneous 探测链只关心 302 与 Set-Cookie，
 *   不渲染挑战页，因此 forums 前置仍然有效。
 * - exhentai.org：JHenTai 生产源站段 12 IP 全部实测 302（里站正常行为）。
 *   曾从 doh.pub 补充 2 个 Cloudflare IP（104.21.56.202 / 172.67.187.219），
 *   实测无 SNI 时 TLS 握手被拒 / 超时——CF 边缘依赖 SNI 路由，不能用于前置，已移除。
 *   178.175.132.19 于 2026-10-28 测到连续 3 次超时被移除，
 *   **2026-11-02 复测已恢复（302 正常）**，故重新加入。
 * - api.e-hentai.org：7 IP 全部实测 200（{"error":"Empty JSON Request"}）。
 * - ehgt.org：3 IP 均实测可达（/ 返回 403 属目录禁列，带图片路径可出图）。
 * - s.exhentai.org：3 IP 均实测可达（403 属无签名路径，Varnish 存活）。
 * - upld.e-hentai.org：JHenTai 表里的 95.211.208.236 / 89.149.221.236
 *   于 2026-11-02 实测均 ECONNREFUSED，**已全失效**，故不加入本表。
 *
 * ⚠️ **绝对不要把 hath.network 加进本表。**
 * hath.network 是 H@H（Hentai@Home）分布式节点网络的**通配域**：图片实际存放在
 * 世界各地志愿者节点上，域名形如 `<nodeid>.<clientid>.hath.network:20001`，
 * 每个子域解析到**完全不同的 IP**（实测 zoycbewnml.hath.network → 37.48.81.193，
 * nqnkmcc.qwjbfvnrpsws.hath.network → 124.162.143.97，裸域 hath.network → 178.162.151.57）。
 * 而宿主侧 match_front_host 用的是**后缀匹配**（`host.ends_with(".hath.network")`），
 * 表里只要有这一个键，所有 H@H 节点都会被强制改写成同一个 IP，图片必然加载失败：
 *     error sending request for url (https://178.162.151.57:20001/h/...)
 * JHenTai 的前置表里也没有 hath.network，原因相同。H@H 必须走系统 DNS，
 * 媒体白名单（utils/url.ts 的 isAllowedMediaHost）用 `endsWith(".hath.network")`
 * 放行即可，与前置无关。
 *
 * IP 会随时间轮换，失效时可在设置页「自定义 IP」里覆盖，无需改代码。
 */
export const DEFAULT_FRONT_HOSTS: Readonly<Record<string, readonly string[]>> = Object.freeze({
  "e-hentai.org": Object.freeze(["172.66.132.196", "172.66.140.62"]),
  "exhentai.org": Object.freeze([
    // 源站段（JHenTai 生产验证）
    "178.175.128.251",
    "178.175.128.252",
    "178.175.128.253",
    "178.175.128.254",
    "178.175.129.251",
    "178.175.129.252",
    "178.175.129.253",
    "178.175.129.254",
    // 178.175.132.19 于 2026-10-28 复测失效（连续 3 次连接超时）被移除；
    // 2026-11-02 复测已恢复（302 正常），重新加入。
    "178.175.132.19",
    "178.175.132.20",
    "178.175.132.21",
    "178.175.132.22",
  ]),
  "forums.e-hentai.org": Object.freeze(["172.66.132.196", "172.66.140.62"]),
  "api.e-hentai.org": Object.freeze([
    "37.48.92.161",
    "212.7.202.51",
    "5.79.104.110",
    "37.48.81.204",
    "212.7.200.104",
    "89.149.222.80",
    "95.211.79.44",
  ]),
  "ehgt.org": Object.freeze(["185.132.132.79", "185.132.132.76", "62.112.8.152"]),
  "s.exhentai.org": Object.freeze(["178.175.132.22", "178.175.129.254", "178.175.128.254"]),
  // hath.network 故意不在表里：它是 H@H 通配域，每个子域指向不同节点 IP，
  // 后缀匹配会把所有节点改写成同一个 IP，导致图片加载失败。详见上方注释。
});

const IPV4_RE = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;

export function isValidIpv4(input: string): boolean {
  const match = IPV4_RE.exec(input.trim());
  if (!match) {
    return false;
  }
  return match.slice(1).every((part) => {
    const value = Number(part);
    return value >= 0 && value <= 255 && String(value) === String(Number(part));
  });
}

/**
 * 解析用户自定义 IP 覆盖。
 *
 * 支持两种写法（分号或换行分隔条目）：
 *   `e-hentai.org=172.66.132.196,172.66.140.62; exhentai.org=178.175.128.251`
 * 条目格式：`host=ip1,ip2,...`。host 为空或 IP 非法时忽略该条目。
 * 返回的表与内置表合并（同 host 时用户覆盖优先）。
 */
export function parseFrontHostsInput(raw: unknown): Record<string, string[]> {
  const text = String(raw ?? "").trim();
  const result: Record<string, string[]> = {};
  if (!text) {
    return result;
  }
  for (const entry of text.split(/[;\n]/)) {
    const line = entry.trim();
    if (!line || line.startsWith("#")) {
      continue;
    }
    const separator = line.indexOf("=");
    if (separator <= 0) {
      continue;
    }
    const host = line
      .slice(0, separator)
      .trim()
      .toLowerCase()
      .replace(/^https?:\/\//, "")
      .replace(/\/+$/, "");
    if (!host) {
      continue;
    }
    const ips: string[] = [];
    for (const candidate of line.slice(separator + 1).split(/[,，\s]+/)) {
      const ip = candidate.trim();
      if (ip && isValidIpv4(ip) && !ips.includes(ip)) {
        ips.push(ip);
      }
    }
    if (ips.length) {
      result[host] = ips;
    }
  }
  return result;
}

/** 合并内置表与用户覆盖，得到最终下发给宿主的表。 */
export function resolveFrontHosts(customIps?: unknown): Record<string, string[]> {
  const merged: Record<string, string[]> = {};
  for (const [host, ips] of Object.entries(DEFAULT_FRONT_HOSTS)) {
    merged[host] = [...ips];
  }
  for (const [host, ips] of Object.entries(parseFrontHostsInput(customIps))) {
    merged[host] = ips;
  }
  return merged;
}

/** 宿主是否注入了前置能力（新宿主是 `fronting` 对象，旧宿主是内部函数）。 */
export function hostSupportsFronting(): boolean {
  const scope = globalThis as Record<string, unknown>;
  const api = scope.fronting as { setHosts?: unknown } | undefined;
  if (api && typeof api.setHosts === "function") {
    return true;
  }
  return typeof scope[LEGACY_SET_FRONT_HOSTS] === "function";
}

/**
 * 宿主版本与能力都满足时才可用。
 *
 * 3.0.37 及更早版本没有前置能力：设置页隐藏整个分区，也不下发前置表。
 */
export async function frontingAvailable(): Promise<boolean> {
  return supportsFrontingVersion(await getAppVersionCached()) && hostSupportsFronting();
}

/** 读取宿主当前生效的前置表（JSON 字符串），仅供设置页展示。 */
export function readHostFrontHosts(): string | null {
  const result = getFrontHosts();
  return result.ok ? JSON.stringify(result) : null;
}

export type FrontingSyncResult =
  | { supported: true; changed: boolean; hosts: Record<string, string[]> }
  | { supported: false; changed: false; hosts: Record<string, string[]> };

let lastPushedJson = "";

/**
 * 把前置表下发给宿主。幂等：表内容没变就不重复调用。
 * enabled=false 时下发空表 = 关闭前置。
 */
export function syncFrontHostsToHost(hosts: Record<string, string[]>): FrontingSyncResult {
  if (!hostSupportsFronting()) {
    return { supported: false, changed: false, hosts };
  }
  const json = JSON.stringify(hosts);
  if (json === lastPushedJson) {
    return { supported: true, changed: false, hosts };
  }
  const result = setFrontHosts(hosts as FrontHostTable);
  if (!result.ok) {
    return { supported: false, changed: false, hosts };
  }
  lastPushedJson = json;
  return { supported: true, changed: true, hosts };
}

/** 重置幂等缓存（设置变更 / 测试用）。 */
export function resetFrontingSyncCache(): void {
  lastPushedJson = "";
}

// ── 宿主 IP 连通性测试（优选）────────────────────────────────────────────

/** 单次探测最多测多少个 IP（宿主上限 32）。 */
const PROBE_MAX_IPS = 32;
/** 每个域名保留几个最优 IP。 */
export const FRONT_PROBE_KEEP_PER_HOST = 3;
/** 允许的最大丢包率，超过就认为该 IP 不稳定。 */
const PROBE_MAX_LOSS_RATE = 0.34;
/** 单个 IP 的采样超时。 */
const PROBE_TIMEOUT_MS = 2500;
/** 优选结果缓存时长：过期后后台重新探测。 */
export const FRONT_PROBE_CACHE_TTL_MS = 12 * 60 * 60 * 1000;

/** 优选结果缓存（持久化到 pluginConfig）。 */
export type FrontProbeCache = {
  at: number;
  table: Record<string, string[]>;
};

/** 宿主是否提供前置 IP 探测能力。 */
export function hostSupportsFrontProbe(): boolean {
  const scope = globalThis as Record<string, unknown>;
  const api = scope.fronting as { probe?: unknown } | undefined;
  if (api && typeof api.probe === "function") {
    return true;
  }
  return typeof scope[LEGACY_PROBE_FRONT_HOSTS] === "function";
}

/**
 * 调宿主探测一个域名的候选 IP。
 *
 * 宿主发的是真实 `Host` 的 `HEAD` 请求（新连接、不读 body），所以「探测通过」
 * 等价于「这个 IP 能用于前置」。宿主不支持或参数非法时返回 null。
 */
export async function probeFrontHosts(
  host: string,
  ips: readonly string[],
): Promise<ProbeFrontHostsResult | null> {
  if (!hostSupportsFrontProbe()) {
    return null;
  }
  const candidates = ips.filter((ip) => isValidIpv4(ip)).slice(0, PROBE_MAX_IPS);
  if (!candidates.length) {
    return null;
  }
  try {
    return await probeHostFrontHosts({
      host,
      ips: candidates,
      timeoutMs: PROBE_TIMEOUT_MS,
      concurrency: 4,
      samples: 1,
    });
  } catch (error) {
    console.warn(`[EH] 前置 IP 探测失败: ${host}`, error);
    return null;
  }
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

export type OptimizeFrontHostsOptions = {
  /** 测试用：替换等待实现。 */
  sleep?: (ms: number) => Promise<void>;
  /** 测试用：替换探测实现。 */
  probe?: (host: string, ips: readonly string[]) => Promise<ProbeFrontHostsResult | null>;
};

/**
 * 逐个域名探测并生成优选表。
 *
 * - 只有 1 个 IP 的域名跳过探测（没有选择空间，省配额）；
 * - 命中 `probe-rate-limited` 时按 `retryAfterMs` 等一次再重试；
 * - 某个域名全部失败时保留原表，宁可慢也不要下发空表。
 */
export async function optimizeFrontHosts(
  table: Record<string, string[]>,
  options: OptimizeFrontHostsOptions = {},
): Promise<Record<string, string[]>> {
  const sleep = options.sleep ?? defaultSleep;
  const probe = options.probe ?? probeFrontHosts;
  const result: Record<string, string[]> = {};

  for (const [host, ips] of Object.entries(table)) {
    if (ips.length < 2) {
      result[host] = [...ips];
      continue;
    }
    let report = await probe(host, ips);
    if (report && report.ok === false && report.error === "probe-rate-limited") {
      const waitMs = Math.min(Math.max(report.retryAfterMs ?? 5000, 1000), 10_000);
      await sleep(waitMs);
      report = await probe(host, ips);
    }
    const best = report
      ? pickBestFrontIps(report, {
          limit: FRONT_PROBE_KEEP_PER_HOST,
          maxLossRate: PROBE_MAX_LOSS_RATE,
        })
      : [];
    // 只挑出 1 个健康 IP 时保守一点：保留原表，别把可用性压到单点。
    result[host] = best.length >= 2 ? best : [...ips];
  }

  return result;
}

/** 缓存是否还在有效期内。 */
export function isProbeCacheFresh(cache: FrontProbeCache | null, now = Date.now()): boolean {
  return Boolean(
    cache &&
    Number.isFinite(cache.at) &&
    now - cache.at >= 0 &&
    now - cache.at < FRONT_PROBE_CACHE_TTL_MS,
  );
}

/**
 * 把缓存里的优选结果套到当前表上。
 *
 * 只接受仍然存在于当前表里的 IP：用户改了「自定义 IP」后旧缓存自动失效，
 * 不会被旧的优选结果覆盖。缓存过期或没有可用项时原样返回当前表。
 */
export function applyProbeCache(
  table: Record<string, string[]>,
  cache: FrontProbeCache | null,
  now = Date.now(),
): Record<string, string[]> {
  if (!cache || !isProbeCacheFresh(cache, now)) {
    return table;
  }
  const result: Record<string, string[]> = {};
  for (const [host, ips] of Object.entries(table)) {
    const cached = cache.table[host];
    const usable = Array.isArray(cached) ? cached.filter((ip) => ips.includes(ip)) : [];
    result[host] = usable.length ? usable : [...ips];
  }
  return result;
}

/** 设置页展示用的状态摘要。 */
export function describeFrontingStatus(hosts: Record<string, string[]>): string {
  const hostCount = Object.keys(hosts).length;
  const ipCount = Object.values(hosts).reduce((sum, ips) => sum + ips.length, 0);
  if (!hostCount) {
    return "已关闭";
  }
  return `${hostCount} 个域名 / ${ipCount} 个 IP`;
}
