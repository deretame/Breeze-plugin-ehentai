import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { getInfo } from "../src/index";

async function main() {
  const manifest = await getInfo();
  const manifestPath = resolve(process.cwd(), "manifest.json");
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf-8");
  console.log(`[manifest] generated: ${manifestPath}`);
}

void main().catch((error) => {
  console.error("[manifest] generate failed:", error);
  process.exit(1);
});