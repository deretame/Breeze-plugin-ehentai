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
        // {
        //   id: "basic",
        //   title: "Basic",
        //   fields: [
        //     {
        //       key: "site",
        //       kind: "choice",
        //       label: "Site",
        //       options: [
        //         { label: "EH", value: "EH" },
        //         { label: "EX", value: "EX" },
        //       ],
        //     },
        //     {
        //       key: "imageProxyEnabled",
        //       kind: "switch",
        //       label: "Image Proxy Enabled",
        //     },
        //   ],
        // },
      ],
    },
    data: {
      canShowUserInfo: false,
      values,
    },
  };
}
