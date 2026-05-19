import { readFile, writeFile } from "node:fs/promises";

async function main() {
  const constantsPath = new URL("../src/domain/constants.ts", import.meta.url);
  const constants = await readFile(constantsPath, "utf-8");
  const match = constants.match(/PLUGIN_VERSION\s*=\s*"([^"]*)"/);
  if (!match) {
    throw new Error("PLUGIN_VERSION not found in src/domain/constants.ts");
  }
  const version = match[1];

  const pkgPath = new URL("../package.json", import.meta.url);
  const pkg = JSON.parse(await readFile(pkgPath, "utf-8"));
  pkg.version = version;
  await writeFile(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`, "utf-8");
  console.log(`[version] synced package.json ← constants.ts → ${version}`);
}

void main().catch((error) => {
  console.error("[version] generate failed:", error);
  process.exit(1);
});
