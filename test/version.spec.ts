import { describe, expect, test } from "@rstest/core";
import {
  FRONTING_MIN_APP_VERSION,
  compareVersions,
  getAppVersionCached,
  normalizeAppVersion,
  resetAppVersionCache,
  supportsFrontingVersion,
} from "../src/utils/version";

describe("app version helpers", () => {
  test("test_normalizeAppVersion_strips_json_quotes", () => {
    expect(normalizeAppVersion('"3.0.37"')).toBe("3.0.37");
    expect(normalizeAppVersion(" 3.0.37 ")).toBe("3.0.37");
    expect(normalizeAppVersion(undefined)).toBe("");
  });

  test("test_compareVersions_three_segments", () => {
    expect(compareVersions("3.0.38", "3.0.37")).toBeGreaterThan(0);
    expect(compareVersions("3.0.37", "3.0.37")).toBe(0);
    expect(compareVersions("3.0.36", "3.0.37")).toBeLessThan(0);
    expect(compareVersions("4.0.0", "3.0.34")).toBeGreaterThan(0);
    // 缺段按 0 补齐
    expect(compareVersions("3.1", "3.1.0")).toBe(0);
    expect(compareVersions("3.1", "3.0.99")).toBeGreaterThan(0);
    // JSON 编码串也能比较
    expect(compareVersions('"3.0.38"', "3.0.37")).toBeGreaterThan(0);
  });

  test("test_supportsFrontingVersion_requires_strictly_newer", () => {
    expect(FRONTING_MIN_APP_VERSION).toBe("3.0.37");
    // 不高于 3.0.37 一律不支持（3.0.37 本身也不行）
    expect(supportsFrontingVersion("3.0.37")).toBe(false);
    expect(supportsFrontingVersion("3.0.36")).toBe(false);
    expect(supportsFrontingVersion("2.99.99")).toBe(false);
    expect(supportsFrontingVersion("")).toBe(false);
    expect(supportsFrontingVersion("Unknown")).toBe(false);
    // 高于 3.0.37 才支持
    expect(supportsFrontingVersion("3.0.38")).toBe(true);
    expect(supportsFrontingVersion("3.1.0")).toBe(true);
    expect(supportsFrontingVersion("4.0.0")).toBe(true);
    expect(supportsFrontingVersion('"3.0.38"')).toBe(true);
  });

  test("test_getAppVersionCached_falls_back_to_empty_without_bridge", async () => {
    // 纯 Node 测试环境没有宿主 bridge：按「不支持」处理，且不抛错。
    resetAppVersionCache();
    expect(await getAppVersionCached()).toBe("");
    // 第二次走缓存，结果一致
    expect(await getAppVersionCached()).toBe("");
  });
});
