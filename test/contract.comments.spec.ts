import { afterEach, describe, expect, test, rs } from "@rstest/core";
import { getCommentFeed, getComicDetail } from "../src/index";
import { httpClient } from "../src/network/client";

const COMMENTS_HTML = `
  <div id="cdiv">
    <div class="c1">
      <div class="c3"><a href="/uploader">uploader</a><br />Posted on 2026-01-01 01:02 UTC</div>
      <div class="c4"><a name="uploader_comment">Uploader</a></div>
      <div class="c6">Gallery description</div>
    </div>
    <div class="c1">
      <div class="c3"><a href="/user/alice">alice</a><br />Posted on 2026-01-02 03:04 UTC</div>
      <div class="c4"><span id="comment_score_123">+5</span></div>
      <div class="c6" id="comment_123">Great gallery<br />with useful details.</div>
    </div>
  </div>
`;

afterEach(() => {
  rs.restoreAllMocks();
});

describe("comments contract", () => {
  test("test_getCommentFeed_parses_uploader_and_comments", async () => {
    const getTextSpy = rs.spyOn(httpClient, "getText").mockResolvedValueOnce(COMMENTS_HTML);

    const result = await getCommentFeed({ comicId: "123456/abcdef", page: 1 });

    expect(result.scheme.type).toBe("commentFeed");
    expect(result.data.topItems).toHaveLength(1);
    expect(result.data.topItems[0]).toMatchObject({
      id: "gallery-description",
      author: { name: "uploader" },
      content: "Gallery description",
      createdAt: "2026-01-01 01:02 UTC",
    });
    expect(result.data.items).toHaveLength(1);
    expect(result.data.items[0]).toMatchObject({
      id: "123",
      author: { name: "alice" },
      content: "Great gallery with useful details.",
      createdAt: "2026-01-02 03:04 UTC",
    });
    expect(result.data.replyMode).toBe("embedded");
    expect(result.data.paging.hasReachedMax).toBe(true);
    expect(result.data.canComment).toEqual({ comic: false, reply: false });
    expect(String(getTextSpy.mock.calls[0]?.[0] ?? "")).toContain("hc=1");
  });

  test("test_getCommentFeed_empty_comments_returns_empty_feed", async () => {
    rs.spyOn(httpClient, "getText").mockResolvedValueOnce('<div id="cdiv"></div>');

    const result = await getCommentFeed({ comicId: "123456/abcdef" });

    expect(result.data.topItems).toEqual([]);
    expect(result.data.items).toEqual([]);
    expect(result.data.paging.hasReachedMax).toBe(true);
  });

  test("test_getCommentFeed_page_after_first_returns_empty_feed_without_request", async () => {
    const getTextSpy = rs.spyOn(httpClient, "getText");

    const result = await getCommentFeed({ comicId: "123456/abcdef", page: 2 });

    expect(result.data.items).toEqual([]);
    expect(result.data.paging.hasReachedMax).toBe(true);
    expect(getTextSpy).not.toHaveBeenCalled();
  });

  test("test_getCommentFeed_missing_comicId_throws_validation_error", async () => {
    await expect(getCommentFeed({})).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
    });
  });

  test("test_getComicDetail_exposes_comment_capability", async () => {
    rs.spyOn(httpClient, "getText").mockResolvedValueOnce(`
      <div id="gn">Sample</div>
      <div id="gdd"><table><tr><td>Length:</td><td>1 pages</td></tr></table></div>
    `);

    const result = await getComicDetail({ comicId: "123456/abcdef" });

    expect(result.data.normal.allowComments).toBe(true);
  });
});
