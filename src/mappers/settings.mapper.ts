import type { SettingsBundleContract, SettingsField, SettingsSection } from "breeze-plugin-kit";
import { DEFAULT_SETTINGS, PLUGIN_SOURCE } from "../domain/constants";
import type { PluginSettings } from "../domain/types";
import { describeFrontingStatus, hostSupportsFronting, resolveFrontHosts } from "../network/ip-direct";

const LEGACY_COOKIE_FIELDS: SettingsField[] = [
  {
    key: "ipb_member_id",
    kind: "text",
    label: "ipb_member_id",
    fnPath: "setEhentaiIpbMemberId",
  },
  {
    key: "ipb_pass_hash",
    kind: "text",
    label: "ipb_pass_hash",
    fnPath: "setEhentaiIpbPassHash",
  },
  {
    key: "igneous",
    kind: "text",
    label: "igneous（里站 cookie，可选）",
    fnPath: "setEhentaiIgneous",
  },
];

/**
 * 「墙内 IP 直连」开关的实时 label。
 *
 * 只有在宿主版本 > 3.0.37 且注入了前置能力时这个分区才会显示；label 里再区分
 * 「能力缺失 / 已关闭 / 生效 + 表规模」，避免用户以为开关坏了。
 */
export function directConnectLabel(values: PluginSettings): string {
  const base = "墙内 IP 直连（SNI 绕过）";
  if (!hostSupportsFronting()) {
    return `${base} · 宿主不支持，需新版 Breeze`;
  }
  if (!values.directConnect) {
    return `${base} · 已关闭`;
  }
  return `${base} · 生效：${describeFrontingStatus(resolveFrontHosts(values.directCustomIps))}`;
}

/** 「自定义 IP」输入框的实时 label。 */
export function customIpsLabel(values: PluginSettings): string {
  if (!hostSupportsFronting()) {
    return "自定义 IP（宿主不支持时填了也不生效）";
  }
  return values.directCustomIps
    ? "自定义 IP（已覆盖对应域名的内置 IP）"
    : "自定义 IP（host=ip1,ip2;...，留空用内置表）";
}

export function mapSettingsBundle(
  values: PluginSettings = { ...DEFAULT_SETTINGS },
  options: { legacyHost?: boolean; fronting?: boolean } = {},
): SettingsBundleContract {
  const legacyHost = options.legacyHost ?? false;
  // 宿主版本不高于 3.0.37 时没有前置能力：整个「网络」分区隐藏，开关值也强制为关。
  const fronting = options.fronting ?? false;
  const directSection: SettingsSection = {
    id: "direct",
    title: "网络",
    fields: [
      {
        key: "directConnect",
        kind: "switch",
        label: directConnectLabel(values),
      },
      {
        key: "directCustomIps",
        kind: "text",
        label: customIpsLabel(values),
      },
    ],
  };
  return {
    source: PLUGIN_SOURCE,
    scheme: {
      version: "1.0.0",
      type: "settings",
      sections: [
        {
          id: "basic",
          title: "基础",
          fields: [
            {
              key: "site",
              kind: "choice",
              label: "站点",
              options: [
                { label: "表站", value: "EH" },
                { label: "里站", value: "EX" },
              ],
            },
            // {
            //   key: "imageProxyEnabled",
            //   kind: "switch",
            //   label: "图片代理模式",
            // },
            ...(legacyHost ? LEGACY_COOKIE_FIELDS : []),
          ],
        },
        ...(fronting ? [directSection] : []),
      ],
    },
    data: {
      canShowUserInfo: false,
      canLogin: true,
      values: {
        site: values.site,
        // 必须是真正的布尔值。宿主 switch 的判定是 Dart 严格比较
        // `final current = value == true;`（plugin_scheme_widgets.dart:130），
        // 下发字符串 "true" 时 `"true" == true` 为 false，开关会永远显示为关闭，
        // 用户以为没生效而反复切换。
        directConnect: fronting ? values.directConnect : false,
        directCustomIps: values.directCustomIps ?? "",
        ...(legacyHost
          ? {
              ipb_member_id: values.ipb_member_id,
              ipb_pass_hash: values.ipb_pass_hash,
              igneous: values.igneous,
            }
          : {}),
      },
    },
  };
}
