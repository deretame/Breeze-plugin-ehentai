import { afterEach, describe, expect, test } from "@rstest/core";
import { DEFAULT_SETTINGS } from "../src/domain/constants";
import { DEFAULT_FRONT_HOSTS } from "../src/network/ip-direct";
import { customIpsLabel, directConnectLabel, mapSettingsBundle } from "../src/mappers/settings.mapper";

const HOST_GLOBAL = "__http_set_front_hosts";

function setHostSupported(supported: boolean): void {
  const scope = globalThis as Record<string, unknown>;
  if (supported) {
    scope[HOST_GLOBAL] = () => "{}";
  } else {
    delete scope[HOST_GLOBAL];
  }
}

afterEach(() => {
  setHostSupported(false);
});

describe("settings mapper · 墙内直连 label", () => {
  test("test_directConnectLabel_unsupported_host_says_so", () => {
    setHostSupported(false);
    const label = directConnectLabel({ ...DEFAULT_SETTINGS });
    expect(label).toContain("SNI 绕过");
    expect(label).toContain("宿主不支持");
    expect(label).toContain("需新版 Breeze");
  });

  test("test_directConnectLabel_enabled_shows_table_size", () => {
    setHostSupported(true);
    const label = directConnectLabel({ ...DEFAULT_SETTINGS, directConnect: true });
    expect(label).toContain("生效");
    // 从内置表推导期望值，避免每次调整 IP 表都要改断言。
    // 注意 describeFrontingStatus 是「条目数累加」（同一 IP 出现在多个域名下会重复计）。
    const hostCount = Object.keys(DEFAULT_FRONT_HOSTS).length;
    const ipCount = Object.values(DEFAULT_FRONT_HOSTS).reduce((sum, ips) => sum + ips.length, 0);
    expect(label).toContain(`${hostCount} 个域名 / ${ipCount} 个 IP`);
  });

  test("test_directConnectLabel_disabled_says_off", () => {
    setHostSupported(true);
    const label = directConnectLabel({ ...DEFAULT_SETTINGS, directConnect: false });
    expect(label).toContain("已关闭");
    expect(label).not.toContain("生效");
  });

  test("test_directConnectLabel_custom_ips_merge_into_count", () => {
    setHostSupported(true);
    const label = directConnectLabel({
      ...DEFAULT_SETTINGS,
      directConnect: true,
      directCustomIps: "exhentai.org=1.2.3.4,5.6.7.8",
    });
    // exhentai 内置 N 个被覆盖成 2 个，域名数不变。从内置表推导，避免表变动后失效。
    const hostCount = Object.keys(DEFAULT_FRONT_HOSTS).length;
    const builtinEx = DEFAULT_FRONT_HOSTS["exhentai.org"].length;
    const totalIp =
      Object.values(DEFAULT_FRONT_HOSTS).reduce((sum, ips) => sum + ips.length, 0) - builtinEx + 2;
    expect(label).toContain(`${hostCount} 个域名 / ${totalIp} 个 IP`);
  });

  test("test_customIpsLabel_hints_when_unsupported", () => {
    setHostSupported(false);
    expect(customIpsLabel({ ...DEFAULT_SETTINGS })).toContain("不生效");
  });

  test("test_customIpsLabel_marks_override", () => {
    setHostSupported(true);
    expect(customIpsLabel({ ...DEFAULT_SETTINGS, directCustomIps: "e-hentai.org=1.2.3.4" })).toContain("已覆盖");
    expect(customIpsLabel({ ...DEFAULT_SETTINGS })).toContain("留空用内置表");
  });

  test("test_mapSettingsBundle_carries_live_label_into_direct_section", () => {
    setHostSupported(false);
    const bundle = mapSettingsBundle({ ...DEFAULT_SETTINGS }, { fronting: true });
    const section = bundle.scheme.sections.find((item) => item.id === "direct");
    expect(section).toBeDefined();
    const switchField = section?.fields.find((field) => field.key === "directConnect");
    expect(switchField?.kind).toBe("switch");
    expect(switchField?.label).toContain("宿主不支持");
    // 开关的值必须是布尔值：宿主用 Dart 严格比较 `value == true` 渲染 switch
    // （plugin_scheme_widgets.dart:130），下发字符串会让开关永远显示为关。
    expect(bundle.data.values.directConnect).toBe(false);
  });

  test("test_mapSettingsBundle_hides_direct_section_on_old_host", () => {
    // 宿主版本 <= 3.0.37：整个「网络」分区隐藏，开关值强制为关。
    const bundle = mapSettingsBundle({ ...DEFAULT_SETTINGS, directConnect: true });
    const section = bundle.scheme.sections.find((item) => item.id === "direct");
    expect(section).toBeUndefined();
    expect(bundle.data.values.directConnect).toBe(false);
    // 自定义 IP 仍然保留，升级宿主后不用重新填。
    expect(bundle.data.values.directCustomIps).toBe(DEFAULT_SETTINGS.directCustomIps);
  });

  test("test_directConnect_value_is_real_boolean_not_string", () => {
    for (const flag of [true, false]) {
      const bundle = mapSettingsBundle(
        { ...DEFAULT_SETTINGS, directConnect: flag },
        { fronting: true },
      );
      expect(bundle.data.values.directConnect).toBe(flag);
      expect(typeof bundle.data.values.directConnect).toBe("boolean");
    }
  });
});
