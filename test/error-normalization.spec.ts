import axios from "axios";
import { describe, expect, test } from "vitest";
import { normalizeError } from "../src/errors/normalize-error";

describe("error normalization", () => {
  test("test_normalizeError_axios_error_returns_network_error", () => {
    const error = new axios.AxiosError("timeout");
    error.config = {
      headers: {},
      url: "https://e-hentai.org/toplist.php",
      method: "get",
    } as never;
    error.response = {
      status: 404,
      statusText: "Not Found",
    } as never;

    const normalized = normalizeError(error);
    expect(normalized.code).toBe("NETWORK_ERROR");
    expect(normalized.retryable).toBe(true);
    expect(normalized.details).toMatchObject({
      url: "https://e-hentai.org/toplist.php",
      method: "GET",
      status: 404,
      statusText: "Not Found",
      lastErrorMessage: "timeout",
    });
    expect(normalized.message).toContain("timeout");
    expect(normalized.message).toContain('"status":404');
  });

  test("test_normalizeError_blocked_marker_returns_upstream_blocked", () => {
    const normalized = normalizeError(new Error("sad panda"));
    expect(normalized.code).toBe("UPSTREAM_BLOCKED");
  });

  test("test_normalizeError_unknown_returns_contract_error", () => {
    const normalized = normalizeError("oops");
    expect(normalized.code).toBe("CONTRACT_ERROR");
  });
});
