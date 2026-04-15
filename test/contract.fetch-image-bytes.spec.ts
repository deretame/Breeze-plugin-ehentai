import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { fetchImageBytes } from "../src/index";
import { DEFERRED_IMAGE_PATH } from "../src/domain/constants";
import { httpClient } from "../src/network/client";
import type { NativeApi } from "../types/runtime-globals";

describe("fetchImageBytes contract", () => {
  beforeEach(() => {
    globalThis.native = {
      put: vi.fn().mockResolvedValue(77),
    } as unknown as NativeApi;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete (globalThis as { native?: unknown }).native;
  });

  test("test_fetchImageBytes_valid_media_url_puts_bytes_into_native_buffer", async () => {
    const bytes = new Uint8Array([1, 2, 3, 4]);
    const getBytesSpy = vi.spyOn(httpClient, "getBytes").mockResolvedValueOnce(bytes);

    const result = await fetchImageBytes({
      url: "https://s.exhentai.org/t/aa/bb/cc.jpg",
      timeoutMs: 3200,
    });

    expect(getBytesSpy).toHaveBeenCalledWith("https://s.exhentai.org/t/aa/bb/cc.jpg", 3200);
    expect(globalThis.native.put).toHaveBeenCalledWith(bytes);
    expect(result).toEqual({ nativeBufferId: 77 });
  });

  test("test_fetchImageBytes_hath_network_media_url_is_allowed", async () => {
    vi.spyOn(httpClient, "getBytes").mockResolvedValueOnce(new Uint8Array([9]));

    const result = await fetchImageBytes({
      url: "https://a123.b456.hath.network/h/0011223344-1",
    });

    expect(result.nativeBufferId).toBe(77);
  });

  test("test_fetchImageBytes_disallowed_media_host_returns_validation_error", async () => {
    await expect(
      fetchImageBytes({
        url: "https://attacker.example/image.jpg",
      }),
    ).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
    });
  });

  test("test_fetchImageBytes_deferred_url_resolves_image_page_then_downloads_bytes", async () => {
    const bytes = new Uint8Array([9, 8, 7]);
    const getTextSpy = vi.spyOn(httpClient, "getText");
    const getBytesSpy = vi.spyOn(httpClient, "getBytes");
    getTextSpy.mockResolvedValueOnce(`
      <div id="i3"><img id="img" src="https://ehgt.org/full/1.jpg" /></div>
      <a id="loadfail" onclick="return nl('WZG-474997')">reload</a>
    `);
    getBytesSpy.mockResolvedValueOnce(bytes);

    const deferred = new URL(`https://e-hentai.org${DEFERRED_IMAGE_PATH}`);
    const result = await fetchImageBytes({
      url: deferred.toString(),
      extern: {
        href: "https://e-hentai.org/s/a1/123-1",
      },
    });

    expect(getTextSpy).toHaveBeenCalledWith("https://e-hentai.org/s/a1/123-1");
    expect(getBytesSpy).toHaveBeenCalledWith("https://ehgt.org/full/1.jpg", undefined);
    expect(globalThis.native.put).toHaveBeenCalledWith(bytes);
    expect(result.nativeBufferId).toBe(77);
  });
});
