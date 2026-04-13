import { describe, expect, test } from "vitest";
import { buildSafeRequestConfig } from "../src/network/client";

describe("network client redirect security", () => {
  test("test_buildSafeRequestConfig_no_input_sets_max_redirects_zero", () => {
    const config = buildSafeRequestConfig();
    expect(config.maxRedirects).toBe(0);
  });

  test("test_buildSafeRequestConfig_redirect_override_forced_to_zero", () => {
    const config = buildSafeRequestConfig({
      headers: { "x-test": "1" },
      maxRedirects: 10,
      timeout: 2000,
    });

    expect(config.maxRedirects).toBe(0);
    expect(config.timeout).toBe(2000);
    expect(config.headers).toMatchObject({ "x-test": "1" });
  });
});
