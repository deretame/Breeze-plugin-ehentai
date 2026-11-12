import { describe, expect, test } from "@rstest/core";
import { isRedirectStatus, resolveRedirectTarget } from "../src/network/client";

describe("redirect status classification", () => {
  test("test_isRedirectStatus_recognizes_3xx_family", () => {
    expect(isRedirectStatus(301)).toBe(true);
    expect(isRedirectStatus(302)).toBe(true);
    expect(isRedirectStatus(303)).toBe(true);
    expect(isRedirectStatus(307)).toBe(true);
    expect(isRedirectStatus(308)).toBe(true);
  });

  test("test_isRedirectStatus_rejects_non_3xx", () => {
    expect(isRedirectStatus(200)).toBe(false);
    expect(isRedirectStatus(204)).toBe(false);
    expect(isRedirectStatus(304)).toBe(false);
    expect(isRedirectStatus(400)).toBe(false);
    expect(isRedirectStatus(509)).toBe(false);
  });
});

describe("redirect target resolution", () => {
  test("test_resolveRedirectTarget_resolves_relative_location", () => {
    const target = resolveRedirectTarget("/home.php", "https://exhentai.org/");
    expect(target).toBe("https://exhentai.org/home.php");
  });

  test("test_resolveRedirectTarget_accepts_allowed_hosts", () => {
    expect(
      resolveRedirectTarget("https://exhentai.org/home.php", "https://exhentai.org/"),
    ).toBe("https://exhentai.org/home.php");
    expect(
      resolveRedirectTarget("https://s.exhentai.org/img/x.jpg", "https://exhentai.org/s/abc/1-1"),
    ).toBe("https://s.exhentai.org/img/x.jpg");
  });

  test("test_resolveRedirect_target_rejects_hosts_outside_allowlist", () => {
    // forums.e-hentai.org 由里站 igneous 探测流程自行处理（自带白名单），
    // 通用跟随器不放行，避免登录跳转把请求带出插件信任域。
    expect(resolveRedirectTarget("https://forums.e-hentai.org/index.php", "https://exhentai.org/")).toBe(
      "",
    );
    expect(resolveRedirectTarget("https://evil.example.com/", "https://e-hentai.org/")).toBe("");
    expect(resolveRedirectTarget("https://not-e-hentai.org.evil.com/", "https://e-hentai.org/")).toBe(
      "",
    );
  });

  test("test_resolveRedirect_target_rejects_empty_or_garbage", () => {
    expect(resolveRedirectTarget("", "https://e-hentai.org/")).toBe("");
    expect(resolveRedirectTarget("   ", "https://e-hentai.org/")).toBe("");
    // 无法解析为绝对 URL 的垃圾值按相对路径解析，仍限制在同 host 内
    expect(resolveRedirectTarget("::::not a url::::", "https://e-hentai.org/")).toBe(
      "https://e-hentai.org/::::not%20a%20url::::",
    );
  });

  test("test_resolveRedirect_target_accepts_array_header_value", () => {
    const target = resolveRedirectTarget(
      ["https://exhentai.org/home.php"],
      "https://exhentai.org/",
    );
    expect(target).toBe("https://exhentai.org/home.php");
  });
});
