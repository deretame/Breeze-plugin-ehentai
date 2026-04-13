import { describe, expect, test } from "vitest";
import { getInfo, getSettingBundle, getSettingsBundle } from "../src/index";

describe("info and settings contract", () => {
  test("test_getInfo_returns_plugin_metadata", async () => {
    const info = await getInfo();
    expect(info).toMatchObject({
      name: "e-hentai",
      uuid: "breeze.plugin.ehentai",
    });
    expect(info.function[0].action.type).toBe("openSearch");
  });

  test("test_getSettingBundle_and_getSettingsBundle_are_consistent", async () => {
    const legacy = await getSettingBundle();
    const canonical = await getSettingsBundle();

    expect(legacy).toEqual(canonical);
    expect(canonical.scheme.type).toBe("settings");
    expect(canonical.data.values).toEqual({
      site: "EH",
      imageProxyEnabled: false,
    });
  });
});
