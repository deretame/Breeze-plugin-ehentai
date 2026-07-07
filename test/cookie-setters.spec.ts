import { afterEach, beforeEach, describe, expect, rs, test } from "@rstest/core";
import type { NativeApi } from "breeze-plugin-kit";
import { pluginConfig } from "breeze-plugin-kit";
import {
  init,
  setEhentaiForumCookie,
  setEhentaiIgneous,
  setEhentaiIpbMemberId,
  setEhentaiIpbPassHash,
} from "../src/index";
import { httpClient } from "../src/network/client";

describe("cookie setters", () => {
  beforeEach(() => {
    globalThis.native = {
      put: rs.fn<NativeApi["put"]>().mockResolvedValue(99),
    } as unknown as NativeApi;
  });

  afterEach(() => {
    rs.restoreAllMocks();
    delete (globalThis as { native?: unknown }).native;
  });

  test("setEhentaiIpbMemberId_saves_raw_value", async () => {
    const result = await setEhentaiIpbMemberId({
      key: "ipb_member_id",
      value: "12345",
    });

    const patch = (result.data as Record<string, unknown>).valuesPatch as Record<string, string>;
    expect(patch.ipb_member_id).toBe("12345");
  });

  test("setEhentaiIpbMemberId_extracts_value_from_key_value_pair", async () => {
    const result = await setEhentaiIpbMemberId({
      key: "ipb_member_id",
      value: "ipb_member_id=67890",
    });

    const patch = (result.data as Record<string, unknown>).valuesPatch as Record<string, string>;
    expect(patch.ipb_member_id).toBe("67890");
  });

  test("setEhentaiIpbPassHash_saves_raw_value", async () => {
    const result = await setEhentaiIpbPassHash({
      key: "ipb_pass_hash",
      value: "deadbeef",
    });

    const patch = (result.data as Record<string, unknown>).valuesPatch as Record<string, string>;
    expect(patch.ipb_pass_hash).toBe("deadbeef");
  });

  test("setEhentaiIgneous_saves_raw_value", async () => {
    const result = await setEhentaiIgneous({
      key: "igneous",
      value: "tpe3mrh7h04gog1rf",
    });

    const patch = (result.data as Record<string, unknown>).valuesPatch as Record<string, string>;
    expect(patch.igneous).toBe("tpe3mrh7h04gog1rf");
  });

  test("setEhentaiForumCookie_splits_cookie_into_parts_and_clears_igneous", async () => {
    const saveSpy = rs.spyOn(pluginConfig, "save").mockResolvedValue("");

    const result = await setEhentaiForumCookie({
      key: "forumCookie",
      value: "ipb_member_id=1; ipb_pass_hash=2; igneous=stale; cf_clearance=xyz",
    });

    const patch = (result.data as Record<string, unknown>).valuesPatch as Record<string, string>;
    expect(patch.ipb_member_id).toBe("1");
    expect(patch.ipb_pass_hash).toBe("2");
    expect(patch.igneous).toBe("");
    expect(saveSpy).toHaveBeenCalledWith("ipb_member_id", "1");
    expect(saveSpy).toHaveBeenCalledWith("ipb_pass_hash", "2");
    expect(saveSpy).toHaveBeenCalledWith("igneous", "");
  });

  test("init_migrates_legacy_forum_cookie_when_all_new_parts_are_empty", async () => {
    const legacyCookie = "ipb_member_id=1; ipb_pass_hash=2; igneous=abc123";
    rs.spyOn(pluginConfig, "load").mockImplementation((key, fallback = "") => {
      const value = key === "forumCookie" ? legacyCookie : fallback;
      return Promise.resolve(JSON.stringify({ ok: true, value }));
    });
    const saveSpy = rs.spyOn(pluginConfig, "save").mockResolvedValue("");

    await init();

    expect(saveSpy).toHaveBeenCalledWith("ipb_member_id", "1");
    expect(saveSpy).toHaveBeenCalledWith("ipb_pass_hash", "2");
    expect(saveSpy).toHaveBeenCalledWith("igneous", "abc123");
    expect(saveSpy).toHaveBeenCalledWith("forumCookie", "");
  });

  test("init_does_not_migrate_legacy_cookie_when_any_new_part_is_set", async () => {
    const legacyCookie = "ipb_member_id=1; ipb_pass_hash=2; igneous=abc123";
    rs.spyOn(pluginConfig, "load").mockImplementation((key, fallback = "") => {
      if (key === "forumCookie")
        return Promise.resolve(JSON.stringify({ ok: true, value: legacyCookie }));
      if (key === "ipb_member_id")
        return Promise.resolve(JSON.stringify({ ok: true, value: "existing" }));
      return Promise.resolve(JSON.stringify({ ok: true, value: fallback }));
    });
    const saveSpy = rs.spyOn(pluginConfig, "save").mockResolvedValue("");

    await init();

    expect(saveSpy).not.toHaveBeenCalledWith("ipb_member_id", "1");
    expect(saveSpy).not.toHaveBeenCalledWith("forumCookie", "");
  });

  test("init_probes_exhentai_to_resolve_igneous_when_site_is_ex_and_igneous_empty", async () => {
    rs.spyOn(pluginConfig, "load").mockImplementation((key, fallback = "") => {
      if (key === "site") return Promise.resolve(JSON.stringify({ ok: true, value: "EX" }));
      if (key === "ipb_member_id") return Promise.resolve(JSON.stringify({ ok: true, value: "1" }));
      if (key === "ipb_pass_hash") return Promise.resolve(JSON.stringify({ ok: true, value: "2" }));
      return Promise.resolve(JSON.stringify({ ok: true, value: fallback }));
    });
    const saveSpy = rs.spyOn(pluginConfig, "save").mockResolvedValue("");
    const getMetaSpy = rs.spyOn(httpClient, "getTextWithMeta").mockResolvedValue({
      status: 200,
      data: "<html>ok</html>",
      headers: {
        "set-cookie": ["igneous=abc123; path=/; domain=.exhentai.org"],
      },
    });

    await init();

    expect(getMetaSpy).toHaveBeenCalledTimes(1);
    expect(saveSpy).toHaveBeenCalledWith("igneous", "abc123");
  });
});
