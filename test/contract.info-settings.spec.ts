import { describe, expect, test } from "vitest";
import { getInfo, getSettingsBundle } from "../src/index";

describe("info and settings contract", () => {
  test("test_getInfo_returns_plugin_metadata", async () => {
    const info = await getInfo();
    expect(info).toMatchObject({
      name: "e-hentai",
      uuid: "breeze.plugin.ehentai",
    });
    expect(info.function[0].action.type).toBe("openSearch");
  });

  test("test_getSettingsBundle_returns_valid_bundle", async () => {
    const canonical = await getSettingsBundle();

    expect(canonical.scheme.type).toBe("settings");
    expect(canonical.data.values).toEqual({
      site: "EH",
      imageProxyEnabled: false,
    });
  });
});
