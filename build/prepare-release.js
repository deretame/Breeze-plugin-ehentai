import fs from "node:fs";

const manifestPath = "manifest.json";
const constantsPath = "src/domain/constants.ts";

const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
const manifestVersion = manifest.version;

const parts = manifestVersion.split(".");
const lastPart = parts.at(-1);

if (!/^\d+$/.test(lastPart ?? "")) {
  throw new Error(`Cannot increment manifest version: ${manifestVersion}`);
}

parts[parts.length - 1] = String(Number(lastPart) + 1);
const pluginVersion = parts.join(".");

const constantsSource = fs.readFileSync(constantsPath, "utf8");
const replaced = constantsSource.replace(
  /export const PLUGIN_VERSION = ".*?";/,
  `export const PLUGIN_VERSION = "${pluginVersion}";`,
);

if (replaced === constantsSource) {
  throw new Error(`PLUGIN_VERSION declaration not found in ${constantsPath}`);
}

fs.writeFileSync(constantsPath, replaced, "utf8");

const releaseTag = `v${pluginVersion}`;
const outputFile = process.env.GITHUB_OUTPUT;

if (outputFile) {
  fs.appendFileSync(outputFile, `manifest_version=${manifestVersion}\n`);
  fs.appendFileSync(outputFile, `release_tag=${releaseTag}\n`);
  fs.appendFileSync(outputFile, `plugin_version=${pluginVersion}\n`);
}

console.log(`manifest_version=${manifestVersion}`);
console.log(`release_tag=${releaseTag}`);
console.log(`plugin_version=${pluginVersion}`);
