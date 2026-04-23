import { describe, expect, test } from "vitest";
import { PLUGIN_UUID } from "../src/domain/constants";
import { getInfo, getSettingsBundle } from "../src/index";

describe("info and settings contract", () => {
  test("test_getInfo_returns_plugin_metadata", async () => {
    const info = await getInfo();
    expect(info).toMatchObject({
      name: "e-hentai",
      uuid: PLUGIN_UUID,
    });
    expect(info.function).toEqual([]);
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
