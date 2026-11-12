import { describe, expect, test } from "@rstest/core";
import {
  DEFAULT_FRONT_HOSTS,
  describeFrontingStatus,
  frontingAvailable,
  hostSupportsFronting,
  isValidIpv4,
  parseFrontHostsInput,
  resetFrontingSyncCache,
  resolveFrontHosts,
  syncFrontHostsToHost,
} from "../src/network/ip-direct";

describe("ipv4 validation", () => {
  test("test_isValidIpv4_accepts_valid_addresses", () => {
    expect(isValidIpv4("172.66.132.196")).toBe(true);
    expect(isValidIpv4("178.175.128.251")).toBe(true);
    expect(isValidIpv4(" 10.0.0.1 ")).toBe(true);
  });

  test("test_isValidIpv4_rejects_invalid_addresses", () => {
    expect(isValidIpv4("999.1.1.1")).toBe(false);
    expect(isValidIpv4("1.2.3")).toBe(false);
    expect(isValidIpv4("abc.def.gha.jkl")).toBe(false);
    expect(isValidIpv4("2001:db8::1")).toBe(false);
    expect(isValidIpv4("")).toBe(false);
  });
});

describe("custom ip table parsing", () => {
  test("test_parseFrontHostsInput_parses_host_ip_entries", () => {
    const parsed = parseFrontHostsInput("e-hentai.org=1.2.3.4,5.6.7.8; exhentai.org=9.9.9.9");
    expect(parsed).toEqual({
      "e-hentai.org": ["1.2.3.4", "5.6.7.8"],
      "exhentai.org": ["9.9.9.9"],
    });
  });

  test("test_parseFrontHostsInput_supports_newlines_and_comments", () => {
    const parsed = parseFrontHostsInput("# comment\n\nehgt.org=185.132.132.79\n\n");
    expect(parsed).toEqual({ "ehgt.org": ["185.132.132.79"] });
  });

  test("test_parseFrontHostsInput_drops_invalid_entries", () => {
    const parsed = parseFrontHostsInput(
      "=1.2.3.4; bad.org=notanip; good.org=1.1.1.1; also=1.2.3.4,999.999.999.999",
    );
    expect(parsed).toEqual({ "good.org": ["1.1.1.1"], also: ["1.2.3.4"] });
  });

  test("test_parseFrontHostsInput_deduplicates_ips", () => {
    const parsed = parseFrontHostsInput("ehgt.org=1.1.1.1,1.1.1.1");
    expect(parsed).toEqual({ "ehgt.org": ["1.1.1.1"] });
  });

  test("test_parseFrontHostsInput_empty_input", () => {
    expect(parseFrontHostsInput("")).toEqual({});
    expect(parseFrontHostsInput(undefined)).toEqual({});
  });
});

describe("front host table merge", () => {
  test("test_resolveFrontHosts_defaults_present", () => {
    const hosts = resolveFrontHosts();
    expect(Object.keys(hosts)).toContain("e-hentai.org");
    expect(Object.keys(hosts)).toContain("exhentai.org");
    expect(hosts["e-hentai.org"]).toEqual([...DEFAULT_FRONT_HOSTS["e-hentai.org"]]);
  });

  test("test_resolveFrontHosts_user_override_replaces_default", () => {
    const hosts = resolveFrontHosts("e-hentai.org=104.21.56.202");
    expect(hosts["e-hentai.org"]).toEqual(["104.21.56.202"]);
    // 未覆盖的域名保留内置表
    expect(hosts["exhentai.org"]).toEqual([...DEFAULT_FRONT_HOSTS["exhentai.org"]]);
  });

  test("test_front_table_must_not_contain_hath_network", () => {
    // hath.network 是 H@H 分布式节点的通配域：图片实际存放在世界各地志愿者节点，
    // 域名形如 <nodeid>.<clientid>.hath.network:20001，每个子域解析到不同 IP。
    // 宿主侧 match_front_host 用后缀匹配，表里只要有 hath.network 这一个键，
    // 所有节点都会被改写成同一个 IP，图片请求必然失败：
    //   error sending request for url (https://178.162.151.57:20001/h/...)
    // JHenTai 前置表同样不含 hath.network。
    const builtin = resolveFrontHosts();
    expect(Object.keys(builtin)).not.toContain("hath.network");

    // 也不能有任何键是它的父域（否则后缀匹配照样命中）。
    for (const host of Object.keys(builtin)) {
      expect("nqnkmcc.qwjbfvnrpsws.hath.network".endsWith(`.${host}`)).toBe(false);
      expect("nqnkmcc.qwjbfvnrpsws.hath.network" === host).toBe(false);
    }
  });
});

describe("fronting status description", () => {
  test("test_describeFrontingStatus", () => {
    expect(describeFrontingStatus({})).toBe("已关闭");
    const text = describeFrontingStatus({ "e-hentai.org": ["1.2.3.4", "5.6.7.8"] });
    expect(text).toContain("1 个域名");
    expect(text).toContain("2 个 IP");
  });
});

describe("host bridge capability", () => {
  test("test_hostSupportsFronting_false_without_host_globals", () => {
    resetFrontingSyncCache();
    expect(hostSupportsFronting()).toBe(false);
  });

  test("test_frontingAvailable_false_without_host_version", async () => {
    // 纯 Node 环境拿不到宿主版本（也没有前置能力）：整体不可用。
    resetFrontingSyncCache();
    expect(await frontingAvailable()).toBe(false);
  });

  test("test_syncFrontHostsToHost_noop_when_unsupported", () => {
    resetFrontingSyncCache();
    const result = syncFrontHostsToHost({ "e-hentai.org": ["1.2.3.4"] });
    expect(result.supported).toBe(false);
    expect(result.changed).toBe(false);
  });

  test("test_syncFrontHostsToHost_pushes_once_then_idempotent", () => {
    resetFrontingSyncCache();
    const calls: string[] = [];
    const scope = globalThis as Record<string, unknown>;
    scope.__http_set_front_hosts = (json: string) => {
      calls.push(json);
      return '{"ok":true}';
    };
    try {
      const hosts = { "e-hentai.org": ["1.2.3.4"] };
      const first = syncFrontHostsToHost(hosts);
      expect(first.supported).toBe(true);
      expect(first.changed).toBe(true);
      expect(calls).toEqual([JSON.stringify(hosts)]);

      const second = syncFrontHostsToHost(hosts);
      expect(second.changed).toBe(false);
      expect(calls.length).toBe(1);

      const third = syncFrontHostsToHost({});
      expect(third.changed).toBe(true);
      expect(calls.length).toBe(2);
    } finally {
      delete scope.__http_set_front_hosts;
      resetFrontingSyncCache();
    }
  });
});
