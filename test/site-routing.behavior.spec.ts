import { afterEach, beforeEach, describe, expect, rs, test } from "@rstest/core";
import type { NativeApi } from "breeze-plugin-kit";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { DEFERRED_IMAGE_PATH } from "../src/domain/constants";
import {
  fetchImageBytes,
  getChapter,
  getComicDetail,
  getRankingData,
  setEhentaiForumCookie,
} from "../src/index";
import { httpClient } from "../src/network/client";

function fixture(name: string): string {
  return readFileSync(join(import.meta.dirname, "fixtures", name), "utf-8");
}

describe("site routing behavior", () => {
  beforeEach(() => {
    globalThis.native = {
      put: rs.fn<NativeApi["put"]>().mockResolvedValue(99),
    } as unknown as NativeApi;
  });

  afterEach(() => {
    rs.restoreAllMocks();
    delete (globalThis as { native?: unknown }).native;
  });

  test("test_setEhentaiForumCookie_removes_igneous_before_persist", async () => {
    const result = await setEhentaiForumCookie({
      cookie: "ipb_member_id=1; igneous=expired; ipb_pass_hash=2",
    });

    const valuesPatch = (result.data as Record<string, unknown>).valuesPatch as Record<
      string,
      string
    >;
    expect(valuesPatch.ipb_member_id).toBe("1");
    expect(valuesPatch.ipb_pass_hash).toBe("2");
    expect(valuesPatch.igneous).toBe("");
  });

  test("test_getComicDetail_ex_prefers_eh_first_without_igneous", async () => {
    const getTextSpy = rs
      .spyOn(httpClient, "getText")
      .mockResolvedValueOnce(fixture("detail.html"));

    await getComicDetail({
      comicId: "123456/abcdef",
      extern: {
        site: "EX",
        forumCookie: "ipb_member_id=1; igneous=stale",
      },
    });

    expect(getTextSpy).toHaveBeenCalledTimes(1);
    const calledUrl = String(getTextSpy.mock.calls[0]?.[0] ?? "");
    const calledConfig = getTextSpy.mock.calls[0]?.[1] as
      | { headers?: Record<string, string> }
      | undefined;
    expect(calledUrl).toContain("https://e-hentai.org/g/123456/abcdef/");
    expect(String(calledConfig?.headers?.Cookie ?? "")).toContain("ipb_member_id=1");
    expect(String(calledConfig?.headers?.Cookie ?? "")).not.toContain("igneous=");
  });

  test("test_getComicDetail_ex_empty_eh_then_fallback_to_ex", async () => {
    const getTextSpy = rs.spyOn(httpClient, "getText");
    getTextSpy.mockResolvedValueOnce("   ");
    getTextSpy.mockResolvedValueOnce(fixture("detail.html"));

    const result = await getComicDetail({
      comicId: "123456/abcdef",
      extern: {
        site: "EX",
        forumCookie: "ipb_member_id=1; igneous=stale",
      },
    });

    expect(getTextSpy).toHaveBeenCalledTimes(2);
    expect(String(getTextSpy.mock.calls[0]?.[0] ?? "")).toContain(
      "https://e-hentai.org/g/123456/abcdef/",
    );
    expect(String(getTextSpy.mock.calls[1]?.[0] ?? "")).toContain(
      "https://exhentai.org/g/123456/abcdef/",
    );
    expect(result.extern).toMatchObject({
      ehUnavailable: true,
    });
  });

  test("test_fetchImageBytes_ex_try_eh_then_fallback_ex", async () => {
    const getTextSpy = rs.spyOn(httpClient, "getText");
    const getBytesSpy = rs.spyOn(httpClient, "getBytes");
    getTextSpy.mockResolvedValueOnce("<html></html>");
    getTextSpy.mockResolvedValueOnce(`
      <div id="i3"><img id="img" src="https://ehgt.org/full/1.jpg" /></div>
    `);
    const bytes = new Uint8Array([1, 2, 3]);
    getBytesSpy.mockResolvedValueOnce(bytes);

    const deferred = new URL(`https://e-hentai.org${DEFERRED_IMAGE_PATH}`);
    const result = await fetchImageBytes({
      url: deferred.toString(),
      extern: {
        site: "EX",
        forumCookie: "ipb_member_id=1; igneous=stale",
        href: "https://exhentai.org/s/a1/123-1",
      },
    });

    expect(result).toEqual(bytes);
    expect(getTextSpy).toHaveBeenCalledTimes(2);
    expect(String(getTextSpy.mock.calls[0]?.[0] ?? "")).toBe("https://e-hentai.org/s/a1/123-1");
    expect(String(getTextSpy.mock.calls[1]?.[0] ?? "")).toBe("https://exhentai.org/s/a1/123-1");
    expect(getBytesSpy).toHaveBeenCalledWith("https://ehgt.org/full/1.jpg", undefined, {
      headers: {
        Cookie: "ipb_member_id=1; igneous=stale",
      },
    });
  });

  test("test_getChapter_with_ehUnavailable_extern_skips_eh_probe", async () => {
    const getTextSpy = rs.spyOn(httpClient, "getText");
    getTextSpy.mockResolvedValueOnce(`
      <div class="gtb"><p class="gpc">Showing 1 - 1 of 1 images</p></div>
      <div class="ptds"><a>1</a></div>
      <div class="ptt"><table><tbody><tr><td></td><td><a>1</a></td><td></td></tr></tbody></table></div>
      <div id="gdt">
        <a href="https://exhentai.org/s/a1/123-1"><div data-orghash="abcdefghij1"></div></a>
      </div>
    `);
    getTextSpy.mockResolvedValueOnce(`
      <div id="i3"><img id="img" src="https://ehgt.org/full/1.jpg" /></div>
    `);

    const result = await getChapter({
      comicId: "123456/abcdef",
      extern: {
        site: "EX",
        forumCookie: "ipb_member_id=1; igneous=stale",
        ehUnavailable: true,
      },
    });

    expect(getTextSpy).toHaveBeenCalledTimes(1);
    expect(String(getTextSpy.mock.calls[0]?.[0] ?? "")).toContain(
      "https://exhentai.org/g/123456/abcdef/",
    );
    expect(result.extern).toMatchObject({
      ehUnavailable: true,
    });
    expect(result.data.chapter.pages[0].extern).toMatchObject({
      href: "https://exhentai.org/s/a1/123-1",
      ehUnavailable: true,
    });
  });

  test("test_fetchImageBytes_with_ehUnavailable_extern_uses_ex_directly", async () => {
    const getTextSpy = rs.spyOn(httpClient, "getText");
    const getBytesSpy = rs.spyOn(httpClient, "getBytes");
    getTextSpy.mockResolvedValueOnce(`
      <div id="i3"><img id="img" src="https://ehgt.org/full/1.jpg" /></div>
    `);
    const bytes = new Uint8Array([7, 8, 9]);
    getBytesSpy.mockResolvedValueOnce(bytes);

    const deferred = new URL(`https://e-hentai.org${DEFERRED_IMAGE_PATH}`);
    const result = await fetchImageBytes({
      url: deferred.toString(),
      extern: {
        site: "EX",
        forumCookie: "ipb_member_id=1; igneous=stale",
        ehUnavailable: true,
        href: "https://exhentai.org/s/a1/123-1",
      },
    });

    expect(result).toEqual(bytes);
    expect(getTextSpy).toHaveBeenCalledTimes(1);
    expect(String(getTextSpy.mock.calls[0]?.[0] ?? "")).toBe("https://exhentai.org/s/a1/123-1");
  });

  test("test_getRankingData_ex_falls_back_to_eh_for_toplist", async () => {
    const getTextSpy = rs
      .spyOn(httpClient, "getText")
      .mockResolvedValueOnce(fixture("search.html"));

    await getRankingData({
      extern: {
        site: "EX",
        rankType: "day",
      },
      page: 1,
    });

    expect(getTextSpy).toHaveBeenCalledTimes(1);
    expect(String(getTextSpy.mock.calls[0]?.[0] ?? "")).toContain(
      "https://e-hentai.org/toplist.php?tl=15&p=0",
    );
  });
});
