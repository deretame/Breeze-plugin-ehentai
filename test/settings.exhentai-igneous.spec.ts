import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { httpClient } from "../src/network/client";
import {
  readSettings,
  resetExAccessProbeCache,
} from "../src/services/settings.service";

beforeEach(() => {
  resetExAccessProbeCache();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("settings exhentai igneous redirect flow", () => {
  test("test_readSettings_ex_cookie_with_igneous_skip_probe", async () => {
    const getMetaSpy = vi.spyOn(httpClient, "getTextWithMeta");

    const settings = await readSettings({
      site: "EX",
      forumCookie: "ipb_member_id=1; igneous=abc123",
    });

    expect(settings.forumCookie).toContain("igneous=abc123");
    expect(getMetaSpy).not.toHaveBeenCalled();
  });

  test("test_readSettings_ex_cookie_empty_ex_home_marks_access_denied_cache", async () => {
    const getMetaSpy = vi.spyOn(httpClient, "getTextWithMeta").mockResolvedValue(
      {
        status: 200,
        data: "",
        headers: {},
      },
    );

    const extern = {
      site: "EX",
      forumCookie: "ipb_member_id=1; ipb_pass_hash=2",
    };

    const first = await readSettings(extern);
    const second = await readSettings(extern);

    expect(first.forumCookie).toContain("ipb_member_id=1");
    expect(first.forumCookie).not.toContain("igneous=");
    expect(second.forumCookie).toBe(first.forumCookie);
    expect(getMetaSpy).toHaveBeenCalledTimes(1);
  });

  test("test_readSettings_ex_cookie_follow_redirects_and_extract_igneous", async () => {
    const getMetaSpy = vi.spyOn(httpClient, "getTextWithMeta");
    getMetaSpy
      .mockResolvedValueOnce({
        status: 302,
        data: "",
        headers: {
          location:
            "https://forums.e-hentai.org/remoteapi.php?ex=MTc3NzI2MTE4OS1hMWQzNzRjYWFl",
        },
      })
      .mockResolvedValueOnce({
        status: 302,
        data: "",
        headers: {
          location:
            "https://exhentai.org/?poni=MzY4MDIxMC0wODA2YjQyYTFhZTkyNWEwMWY3OGVlMjZlNGZlZmM2ZC0xNzc3MjYxMTkw",
        },
      })
      .mockResolvedValueOnce({
        status: 302,
        data: "",
        headers: {
          location: "https://exhentai.org/",
        },
      })
      .mockResolvedValueOnce({
        status: 200,
        data: "<html>ok</html>",
        headers: {
          "set-cookie": [
            "igneous=tpe3mrh7h04gog1rf; expires=Wed, 27-May-2026 03:39:50 GMT; Max-Age=2592000; path=/; domain=.exhentai.org",
          ],
        },
      });

    const settings = await readSettings({
      site: "EX",
      forumCookie: "ipb_member_id=1; ipb_pass_hash=2",
    });

    expect(settings.forumCookie).toContain("ipb_member_id=1");
    expect(settings.forumCookie).toContain("ipb_pass_hash=2");
    expect(settings.forumCookie).toContain("igneous=tpe3mrh7h04gog1rf");
    expect(getMetaSpy).toHaveBeenCalledTimes(4);
    expect(getMetaSpy.mock.calls[0]?.[0]).toBe("https://exhentai.org");
  });
});
