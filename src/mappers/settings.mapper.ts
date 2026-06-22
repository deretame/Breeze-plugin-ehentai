import { DEFAULT_SETTINGS, PLUGIN_SOURCE } from "../domain/constants";
import type { SettingsBundleContract } from "../../types/type";
import type { PluginSettings } from "../domain/types";

export function mapSettingsBundle(
  values: PluginSettings = { ...DEFAULT_SETTINGS },
): SettingsBundleContract {
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
          ],
        },
      ],
    },
    data: {
      canShowUserInfo: false,
      values: {
        site: values.site,
        ipb_member_id: values.ipb_member_id,
        ipb_pass_hash: values.ipb_pass_hash,
        igneous: values.igneous,
      },
    },
  };
}
