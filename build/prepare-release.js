import fs from "node:fs";

const constantsPath = "src/domain/constants.ts";

const constantsSource = fs.readFileSync(constantsPath, "utf8");
const versionMatch = constantsSource.match(
  /export const PLUGIN_VERSION = "([^"]+)";/,
);

if (!versionMatch) {
  throw new Error(`PLUGIN_VERSION declaration not found in ${constantsPath}`);
}

const currentVersion = versionMatch[1];
const parts = currentVersion.split(".");
const lastPart = parts.at(-1);

if (!/^\d+$/.test(lastPart ?? "")) {
  throw new Error(`Cannot increment plugin version: ${currentVersion}`);
}

parts[parts.length - 1] = String(Number(lastPart) + 1);
const pluginVersion = parts.join(".");

const replaced = constantsSource.replace(
  /export const PLUGIN_VERSION = ".*?";/,
  `export const PLUGIN_VERSION = "${pluginVersion}";`,
);

fs.writeFileSync(constantsPath, replaced, "utf8");

const releaseTag = `v${pluginVersion}`;
const outputFile = process.env.GITHUB_OUTPUT;

if (outputFile) {
  fs.appendFileSync(outputFile, `previous_version=${currentVersion}\n`);
  fs.appendFileSync(outputFile, `release_tag=${releaseTag}\n`);
  fs.appendFileSync(outputFile, `plugin_version=${pluginVersion}\n`);
}

console.log(`previous_version=${currentVersion}`);
console.log(`release_tag=${releaseTag}`);
console.log(`plugin_version=${pluginVersion}`);
