import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, test } from "vitest";

describe("workspace compliance", () => {
  test("test_implementation_files_exist_only_under_plugin_folder", () => {
    const projectRoot = resolve(import.meta.dirname, "..", "..", "..");
    const forbiddenRootPaths = [
      "src/index.ts",
      "src/services/search.service.ts",
      "test/contract.search.spec.ts",
    ];

    const offenders = forbiddenRootPaths.filter((path) => existsSync(join(projectRoot, path)));
    expect(offenders).toEqual([]);
  });
});
