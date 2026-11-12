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

import { getAppVersionCached, supportsFrontingVersion } from "../utils/version";

/** 宿主提供的前置能力入口（由 Breeze 宿主注入的 QuickJS 全局函数）。 */
const HOST_SET_FRONT_HOSTS = "__http_set_front_hosts";
const HOST_GET_FRONT_HOSTS = "__http_get_front_hosts";

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
    const host = line.slice(0, separator).trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/+$/, "");
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

/** 宿主是否注入了前置能力（旧宿主没有这两个全局函数）。 */
export function hostSupportsFronting(): boolean {
  const scope = globalThis as Record<string, unknown>;
  return typeof scope[HOST_SET_FRONT_HOSTS] === "function";
}

/**
 * 宿主版本与能力都满足时才可用。
 *
 * 3.0.37 及更早版本没有前置能力：设置页隐藏整个分区，也不下发前置表。
 */
export async function frontingAvailable(): Promise<boolean> {
  return supportsFrontingVersion(await getAppVersionCached()) && hostSupportsFronting();
}

function callHostFrontingApi(name: string, payload?: string): string | null {
  const scope = globalThis as Record<string, unknown>;
  const fn = scope[name];
  if (typeof fn !== "function") {
    return null;
  }
  try {
    const output = (fn as (input?: string) => unknown)(payload);
    return output === undefined || output === null ? "" : String(output);
  } catch (error) {
    console.warn(`[EH] host fronting api ${name} failed`, error);
    return null;
  }
}

/** 读取宿主当前生效的前置表（JSON 字符串），仅供设置页展示。 */
export function readHostFrontHosts(): string | null {
  return callHostFrontingApi(HOST_GET_FRONT_HOSTS);
}

export type FrontingSyncResult =
  | { supported: true; changed: boolean; hosts: Record<string, string[]> }
  | { supported: false; changed: false; hosts: Record<string, string[]> };

let lastPushedJson = "";

/**
 * 把前置表下发给宿主。幂等：表内容没变就不重复调用。
 * enabled=false 时下发空表 = 关闭前置。
 */
export function syncFrontHostsToHost(
  hosts: Record<string, string[]>,
): FrontingSyncResult {
  if (!hostSupportsFronting()) {
    return { supported: false, changed: false, hosts };
  }
  const json = JSON.stringify(hosts);
  if (json === lastPushedJson) {
    return { supported: true, changed: false, hosts };
  }
  const response = callHostFrontingApi(HOST_SET_FRONT_HOSTS, json);
  if (response === null) {
    return { supported: false, changed: false, hosts };
  }
  lastPushedJson = json;
  return { supported: true, changed: true, hosts };
}

/** 重置幂等缓存（设置变更 / 测试用）。 */
export function resetFrontingSyncCache(): void {
  lastPushedJson = "";
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
