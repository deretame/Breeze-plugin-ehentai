import { afterEach, describe, expect, test, rs } from "@rstest/core";
import type { BridgeApi, NativeApi } from "breeze-plugin-kit";
import { fetchImageBytes, getPreview } from "../src/index";
import { httpClient } from "../src/network/client";
import { PREVIEW_IMAGE_PATH } from "../src/domain/constants";

const previewPage = `
  <div class="gtb"><p class="gpc">Showing 1 - 2 of 2 images</p>
    <table class="ptt"><tr><td class="ptds"><a href="/g/123456/abcdef/">1</a></td></tr></table>
  </div>
  <div id="gdt">
    <a href="https://e-hentai.org/s/hash1/123456-1">
      <div title="Page 1: first.jpg" style="width:200px;height:284px;background:transparent url(https://a123.b456.hath.network/sprite.webp) -0px 0 no-repeat"></div>
    </a>
    <a href="https://e-hentai.org/s/hash2/123456-2">
      <div title="Page 2: second.png" style="width:180px;height:300px;background:transparent url(https://a123.b456.hath.network/sprite.webp) -200px 0 no-repeat"></div>
    </a>
  </div>
`;

afterEach(() => {
  rs.restoreAllMocks();
  delete (globalThis as { bridge?: unknown }).bridge;
  delete (globalThis as { native?: unknown }).native;
});

describe("preview contract", () => {
  test("test_getPreview_crops_each_sprite_and_returns_native_items", async () => {
    const nativePut = rs
      .fn<NativeApi["put"]>()
      .mockResolvedValueOnce(501)
      .mockResolvedValueOnce(502);
    const bridgeCall = rs.fn().mockImplementation(async (name: string) => {
      if (name === "image.crop_by_regions") {
        return [
          { number: 1, imgData: [1, 2, 3] },
          { number: 2, imgData: [4, 5, 6] },
        ];
      }
      return '{"ok":true,"value":""}';
    });
    globalThis.native = {
      put: nativePut,
      take: rs.fn<NativeApi["take"]>(),
      free: rs.fn<NativeApi["free"]>(),
    } as unknown as NativeApi;
    globalThis.bridge = { call: bridgeCall } as unknown as BridgeApi;

    const getTextSpy = rs.spyOn(httpClient, "getText").mockResolvedValueOnce(previewPage);
    const getBytesSpy = rs
      .spyOn(httpClient, "getBytes")
      .mockResolvedValueOnce(new Uint8Array([9, 8, 7]));

    const result = await getPreview({ comicId: "123456/abcdef", page: 1 });
    const items = result.data.preview.items;

    expect(getTextSpy).toHaveBeenCalledWith("https://e-hentai.org/g/123456/abcdef/");
    expect(getBytesSpy).toHaveBeenCalledTimes(1);
    expect(bridgeCall).toHaveBeenCalledWith("image.crop_by_regions", new Uint8Array([9, 8, 7]), [
      { number: 1, x: 0, y: 0, width: 200, height: 284 },
      { number: 2, x: 200, y: 0, width: 180, height: 300 },
    ]);
    expect(nativePut).toHaveBeenNthCalledWith(1, new Uint8Array([1, 2, 3]));
    expect(nativePut).toHaveBeenNthCalledWith(2, new Uint8Array([4, 5, 6]));
    expect(items).toMatchObject([
      {
        id: "1",
        name: "first.jpg",
        path: "preview-123456_abcdef-1.webp",
        url: "https://e-hentai.org/_breeze/preview-image",
        extern: { kind: "ehentai-preview-native-v1", nativeBufferId: 501 },
      },
      {
        id: "2",
        name: "second.png",
        path: "preview-123456_abcdef-2.webp",
        extern: { kind: "ehentai-preview-native-v1", nativeBufferId: 502 },
      },
    ]);
    expect(result.data.preview.paging).toEqual({
      page: 1,
      pages: 1,
      total: 2,
      hasReachedMax: true,
    });
  });

  test("test_fetchImageBytes_preview_item_takes_native_buffer", async () => {
    const nativeTake = rs.fn<NativeApi["take"]>().mockResolvedValue(new Uint8Array([7, 6, 5]));
    globalThis.native = {
      put: rs.fn<NativeApi["put"]>(),
      take: nativeTake,
      free: rs.fn<NativeApi["free"]>(),
    } as unknown as NativeApi;

    const result = await fetchImageBytes({
      url: `https://e-hentai.org${PREVIEW_IMAGE_PATH}`,
      extern: { kind: "ehentai-preview-native-v1", nativeBufferId: 501 },
    });

    expect(nativeTake).toHaveBeenCalledWith(501);
    expect(result).toEqual(new Uint8Array([7, 6, 5]));
  });
});
