import { afterEach, describe, expect, test } from "@rstest/core";
import { pickBestFrontIps, type ProbeFrontHostsResult } from "breeze-plugin-kit";
import {
  applyProbeCache,
  FRONT_PROBE_CACHE_TTL_MS,
  isProbeCacheFresh,
  optimizeFrontHosts,
  probeFrontHosts,
} from "../src/network/ip-direct";

const scope = globalThis as Record<string, unknown>;

afterEach(() => {
  delete scope.__http_probe_front_hosts;
});

function okReport(
  items: Array<{
    ip: string;
    ok?: boolean;
    avgMs?: number;
    ttfbMs?: number;
    lossRate?: number;
  }>,
): ProbeFrontHostsResult {
  return {
    ok: true,
    results: items.map((item) => ({
      ip: item.ip,
      ok: item.ok ?? true,
      status: 200,
      avgMs: item.avgMs ?? null,
      ttfbMs: item.ttfbMs ?? null,
      samplesMs: [],
      samplesSent: 1,
      samplesReceived: 1,
      lossRate: item.lossRate ?? 0,
      error: null,
    })),
  };
}

describe("front ip selection", () => {
  test("test_selectBestFrontIps_filters_and_sorts_by_avg", () => {
    const report = okReport([
      { ip: "1.1.1.1", avgMs: 90 },
      { ip: "2.2.2.2", avgMs: 40 },
      { ip: "3.3.3.3", avgMs: 10, lossRate: 0.5 },
      { ip: "4.4.4.4", ok: false },
      { ip: "5.5.5.5", avgMs: 60 },
    ]);

    expect(pickBestFrontIps(report, { limit: 2 })).toEqual(["2.2.2.2", "5.5.5.5"]);
    expect(pickBestFrontIps(report)).toEqual(["2.2.2.2", "5.5.5.5", "1.1.1.1"]);
  });

  test("test_selectBestFrontIps_falls_back_to_ttfb", () => {
    const report = okReport([
      { ip: "1.1.1.1", ttfbMs: 70 },
      { ip: "2.2.2.2", ttfbMs: 20 },
    ]);
    expect(pickBestFrontIps(report)).toEqual(["2.2.2.2", "1.1.1.1"]);
  });

  test("test_selectBestFrontIps_empty_on_failure", () => {
    expect(pickBestFrontIps({ ok: false, error: "timeout" })).toEqual([]);
    expect(pickBestFrontIps({ ok: true, results: [] })).toEqual([]);
  });
});

describe("host probe bridge", () => {
  test("test_probeFrontHosts_returns_null_without_host_fn", async () => {
    expect(await probeFrontHosts("e-hentai.org", ["1.2.3.4"])).toBeNull();
  });

  test("test_probeFrontHosts_sends_valid_ips_and_parses_report", async () => {
    let payload: Record<string, unknown> | null = null;
    scope.__http_probe_front_hosts = (raw: string) => {
      payload = JSON.parse(raw) as Record<string, unknown>;
      return Promise.resolve(JSON.stringify(okReport([{ ip: "1.2.3.4", avgMs: 12 }])));
    };

    const report = await probeFrontHosts("e-hentai.org", ["1.2.3.4", "not-an-ip"]);

    expect(payload).toMatchObject({ host: "e-hentai.org", ips: ["1.2.3.4"] });
    expect(report?.ok).toBe(true);
    expect(pickBestFrontIps(report!)).toEqual(["1.2.3.4"]);
  });

  test("test_probeFrontHosts_swallows_host_errors", async () => {
    scope.__http_probe_front_hosts = () => Promise.reject(new Error("boom"));
    // kit 会把异常转成 { ok: false, error }，不会往上抛
    const report = await probeFrontHosts("e-hentai.org", ["1.2.3.4"]);
    expect(report?.ok).toBe(false);
  });
});

describe("front host optimization", () => {
  test("test_optimizeFrontHosts_skips_single_ip_and_keeps_failed_hosts", async () => {
    const probed: string[] = [];
    const optimized = await optimizeFrontHosts(
      {
        "e-hentai.org": ["1.1.1.1", "2.2.2.2"],
        "single.example": ["9.9.9.9"],
        "dead.example": ["3.3.3.3", "4.4.4.4"],
      },
      {
        sleep: async () => {},
        probe: async (host) => {
          probed.push(host);
          if (host === "e-hentai.org") {
            return okReport([
              { ip: "2.2.2.2", avgMs: 20 },
              { ip: "1.1.1.1", avgMs: 80 },
            ]);
          }
          return { ok: false, error: "timeout" };
        },
      },
    );

    // 单 IP 域名不探测，省配额
    expect(probed).toEqual(["e-hentai.org", "dead.example"]);
    expect(optimized["e-hentai.org"]).toEqual(["2.2.2.2", "1.1.1.1"]);
    expect(optimized["single.example"]).toEqual(["9.9.9.9"]);
    // 全部失败时保留原表，不下发空表
    expect(optimized["dead.example"]).toEqual(["3.3.3.3", "4.4.4.4"]);
  });

  test("test_optimizeFrontHosts_retries_after_rate_limit", async () => {
    let calls = 0;
    const waits: number[] = [];

    const optimized = await optimizeFrontHosts(
      { "x.example": ["1.1.1.1", "2.2.2.2"] },
      {
        sleep: async (ms) => {
          waits.push(ms);
        },
        probe: async () => {
          calls += 1;
          if (calls === 1) {
            return { ok: false, error: "probe-rate-limited", retryAfterMs: 1234 };
          }
          return okReport([
            { ip: "2.2.2.2", avgMs: 10 },
            { ip: "1.1.1.1", avgMs: 50 },
          ]);
        },
      },
    );

    expect(calls).toBe(2);
    expect(waits).toEqual([1234]);
    expect(optimized["x.example"]).toEqual(["2.2.2.2", "1.1.1.1"]);
  });

  test("test_optimizeFrontHosts_keeps_table_when_only_one_ip_is_healthy", async () => {
    // 只测出 1 个健康 IP 时不要收窄到单点，保留原表。
    const optimized = await optimizeFrontHosts(
      { "x.example": ["1.1.1.1", "2.2.2.2"] },
      {
        sleep: async () => {},
        probe: async () => okReport([{ ip: "2.2.2.2", avgMs: 10 }]),
      },
    );
    expect(optimized["x.example"]).toEqual(["1.1.1.1", "2.2.2.2"]);
  });
});

describe("probe cache", () => {
  test("test_isProbeCacheFresh_ttl", () => {
    const now = 10_000_000;
    expect(isProbeCacheFresh(null, now)).toBe(false);
    expect(isProbeCacheFresh({ at: now - 1000, table: {} }, now)).toBe(true);
    expect(isProbeCacheFresh({ at: now - FRONT_PROBE_CACHE_TTL_MS - 1, table: {} }, now)).toBe(
      false,
    );
    // 时钟回拨（at 在未来）也按过期处理
    expect(isProbeCacheFresh({ at: now + 1000, table: {} }, now)).toBe(false);
  });

  test("test_applyProbeCache_uses_subset_and_falls_back", () => {
    const now = 10_000_000;
    const table = {
      "e-hentai.org": ["1.1.1.1", "2.2.2.2"],
      "exhentai.org": ["3.3.3.3"],
    };

    expect(
      applyProbeCache(
        table,
        { at: now - 1000, table: { "e-hentai.org": ["2.2.2.2"], "exhentai.org": ["9.9.9.9"] } },
        now,
      ),
    ).toEqual({ "e-hentai.org": ["2.2.2.2"], "exhentai.org": ["3.3.3.3"] });

    // 过期缓存直接忽略
    expect(
      applyProbeCache(
        table,
        { at: now - FRONT_PROBE_CACHE_TTL_MS - 1, table: { "e-hentai.org": ["2.2.2.2"] } },
        now,
      ),
    ).toEqual(table);

    // 用户改了自定义 IP，缓存交集为空 → 回退当前表
    expect(
      applyProbeCache(table, { at: now, table: { "e-hentai.org": ["8.8.8.8"] } }, now),
    ).toEqual(table);
  });
});
