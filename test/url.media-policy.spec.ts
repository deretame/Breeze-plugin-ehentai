import { describe, expect, test } from "@rstest/core";
import { ensureAllowedMediaUrl, sanitizeMediaUrl } from "../src/utils/url";

describe("media host policy", () => {
  test("test_ensureAllowedMediaUrl_allows_ehentai_media_hosts", () => {
    expect(ensureAllowedMediaUrl("https://ehgt.org/g/509.gif")).toBe("https://ehgt.org/g/509.gif");
    expect(ensureAllowedMediaUrl("https://x.y.hath.network/h/998877-1")).toBe(
      "https://x.y.hath.network/h/998877-1",
    );
  });

  test("test_ensureAllowedMediaUrl_rewrites_ex_image_host_to_ehgt", () => {
    // 里站封面/缩略图走 s.exhentai.org，墙内不可达；ehgt.org 同路径同文件。
    expect(ensureAllowedMediaUrl("https://s.exhentai.org/t/aa/bb.jpg")).toBe(
      "https://ehgt.org/t/aa/bb.jpg",
    );
    expect(sanitizeMediaUrl("https://s.exhentai.org/t/aa/bb.jpg?x=1")).toBe(
      "https://ehgt.org/t/aa/bb.jpg?x=1",
    );
    // 非图片域名不受影响
    expect(ensureAllowedMediaUrl("https://exhentai.org/img/509.gif")).toBe(
      "https://exhentai.org/img/509.gif",
    );
  });

  test("test_ensureAllowedMediaUrl_rejects_http_and_unknown_hosts", () => {
    expect(() => ensureAllowedMediaUrl("http://ehgt.org/g/509.gif")).toThrowError(
      /unsupported media protocol/i,
    );
    expect(() => ensureAllowedMediaUrl("https://cdn.example.com/a.jpg")).toThrowError(
      /disallowed media host/i,
    );
  });

  test("test_sanitizeMediaUrl_invalid_input_returns_empty_string", () => {
    expect(sanitizeMediaUrl("http://ehgt.org/image.jpg")).toBe("");
    expect(sanitizeMediaUrl("https://evil.test/image.jpg")).toBe("");
  });
});
