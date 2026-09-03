import type { BreezeSelection, CheerioAPI, CommentItem } from "breeze-plugin-kit";
import { normalizeWhitespace } from "../utils/text";

export type CommentsPageParsed = {
  topItems: CommentItem[];
  items: CommentItem[];
};

export function countComments(html: string): number {
  return parseCommentsPage(html).items.length;
}

function parseCommentId(rawId: unknown, isUploader: boolean, index: number): string {
  const normalized = String(rawId ?? "")
    .trim()
    .replace(/^comment_/i, "");
  if (normalized) {
    return normalized;
  }
  return isUploader ? "gallery-description" : `comment-${index + 1}`;
}

function parseCreatedAt($: CheerioAPI, node: BreezeSelection, authorName: string): string {
  const header = normalizeWhitespace($(node).find(".c3").first().text())
    .replace(authorName, "")
    .trim();
  return header.replace(/^Posted on\s*/i, "").trim();
}

function parseCommentContent(content: BreezeSelection): string {
  const html = String(content.html() ?? "");
  if (!html) {
    return normalizeWhitespace(content.text());
  }
  const text = html
    .replace(/<br\s*\/?\s*>/gi, " ")
    .replace(/<\/(?:div|li|p)\s*>/gi, " ")
    .replace(/<[^>]*>/g, " ");
  return normalizeWhitespace(BreezeHtml.load(`<div>${text}</div>`)("div").text());
}

function parseCommentItem($: CheerioAPI, node: BreezeSelection, index: number): CommentItem {
  const block = $(node);
  const content = block.find(".c6").first();
  const authorName = normalizeWhitespace(block.find(".c3 > a").first().text()) || "匿名用户";
  const isUploader = block.find(".c4 > a[name]").length > 0;
  const id = parseCommentId(content.attr("id"), isUploader, index);

  return {
    id,
    author: {
      name: authorName,
      avatar: { url: "", path: "" },
    },
    content: parseCommentContent(content),
    createdAt: parseCreatedAt($, node, authorName),
    replyCount: 0,
    replies: [],
    extern: {
      commentId: id,
      isUploader,
    },
  };
}

export function parseCommentsPage(html: string): CommentsPageParsed {
  const $ = BreezeHtml.load(html);
  const topItems: CommentItem[] = [];
  const items: CommentItem[] = [];

  $("#cdiv > div.c1").each((index, node) => {
    const item = parseCommentItem($, node, index);
    if (item.extern.isUploader === true) {
      topItems.push(item);
    } else {
      items.push(item);
    }
  });

  return { topItems, items };
}
