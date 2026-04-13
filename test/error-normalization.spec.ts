import axios from "axios";
import { describe, expect, test } from "vitest";
import { normalizeError } from "../src/errors/normalize-error";

describe("error normalization", () => {
  test("test_normalizeError_axios_error_returns_network_error", () => {
    const normalized = normalizeError(new axios.AxiosError("timeout"));
    expect(normalized.code).toBe("NETWORK_ERROR");
    expect(normalized.retryable).toBe(true);
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
