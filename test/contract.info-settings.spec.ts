import { describe, expect, test } from "@rstest/core";
import { PLUGIN_UUID } from "../src/domain/constants";
import { getInfo, getSettingsBundle } from "../src/index";

describe("info and settings contract", () => {
  test("test_getInfo_returns_plugin_metadata", async () => {
    const info = await getInfo();
    expect(info).toMatchObject({
      name: "e-hentai",
      uuid: PLUGIN_UUID,
    });
    expect(info.function.map((item) => item.id)).toEqual(["latest", "popular", "ranking"]);
  });

  test("test_getSettingsBundle_returns_valid_bundle", async () => {
    const canonical = await getSettingsBundle();

    expect(canonical.scheme.type).toBe("settings");
    expect(canonical.data.values).toMatchObject({
      site: "EH",
      ipb_member_id: "",
      ipb_pass_hash: "",
      igneous: "",
    });
  });
});
