import { describe, expect, test } from "vitest";
import { buildMediaPath } from "../src/utils/media-path";

describe("media path builder", () => {
  test("test_buildMediaPath_builds_path_with_id_and_url_extension", () => {
    expect(buildMediaPath("3881537/23cc1145f4", "https://ehgt.org/w/02/339/51729-dj7t2evr.webp")).toBe(
      "3881537_23cc1145f4.webp",
    );
  });

  test("test_buildMediaPath_sanitizes_illegal_characters", () => {
    expect(buildMediaPath("a:b*c?d<e>f|g\\h/i", "https://ehgt.org/c/cover.jpg")).toBe("a_b_c_d_e_f_g_h_i.jpg");
  });

  test("test_buildMediaPath_empty_url_returns_empty_path", () => {
    expect(buildMediaPath("123/abc", "")).toBe("");
  });
});
