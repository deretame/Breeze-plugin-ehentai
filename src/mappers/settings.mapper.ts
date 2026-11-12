import type { SettingsBundleContract, SettingsField } from "breeze-plugin-kit";
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
 * 宿主持没打补丁时（`__http_set_front_hosts` 不存在），插件原本只会静默降级，
 * 用户完全看不出开关有没有生效。这里把三种状态直接写进 label：
 * - 宿主持不支持 → 明确告知需要新版 Breeze（否则用户会以为开关坏了）；
 * - 支持但关着   → 已关闭；
 * - 支持且开着   → 生效 + 表规模（N 个域名 / M 个 IP）。
 */
export function directConnectLabel(values: PluginSettings): string {
  const base = "墙内 IP 直连（SNI 绕过）";
  if (!hostSupportsFronting()) {
    return `${base} · 宿主持不支持，需新版 Breeze`;
  }
  if (!values.directConnect) {
    return `${base} · 已关闭`;
  }
  return `${base} · 生效：${describeFrontingStatus(resolveFrontHosts(values.directCustomIps))}`;
}

/** 「自定义 IP」输入框的实时 label。 */
export function customIpsLabel(values: PluginSettings): string {
  if (!hostSupportsFronting()) {
    return "自定义 IP（宿主持不支持时填了也不生效）";
  }
  return values.directCustomIps
    ? "自定义 IP（已覆盖对应域名的内置 IP）"
    : "自定义 IP（host=ip1,ip2;...，留空用内置表）";
}

export function mapSettingsBundle(
  values: PluginSettings = { ...DEFAULT_SETTINGS },
  options: { legacyHost?: boolean } = {},
): SettingsBundleContract {
  const legacyHost = options.legacyHost ?? false;
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
        {
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
        },
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
        directConnect: values.directConnect,
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
