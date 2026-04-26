import { DEFAULT_SETTINGS, PLUGIN_SOURCE } from "../domain/constants";
import type { SettingsBundleContract } from "../domain/contracts";
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
          ],
        },
      ],
    },
    data: {
      canShowUserInfo: false,
      values: {
        site: values.site,
        imageProxyEnabled: values.imageProxyEnabled,
      },
    },
  };
}
