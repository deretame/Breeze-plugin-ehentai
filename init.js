import fs from "fs";
import https from "https";
import path from "path";

const GITHUB_TOKEN = process.env.GITHUB_TOKEN;

if (!GITHUB_TOKEN) {
  console.error("❌ 错误：未在 Shell 环境变量中找到 GITHUB_TOKEN");
  console.log('请先执行: $env:GITHUB_TOKEN = "your_token" (PowerShell)');
  process.exit(1);
}

const REPO_API =
  "https://api.github.com/repos/EhTagTranslation/Database/releases/latest";
const TARGET_DIR = "./src";
const OUTPUT_FILE = path.join(TARGET_DIR, "data.js");

const baseOptions = {
  headers: {
    "User-Agent": "Breeze-Plugin-Init-Script",
    Authorization: `token ${GITHUB_TOKEN}`,
  },
};

console.log("🚀 开始初始化数据库...");

https
  .get(REPO_API, baseOptions, (res) => {
    let body = "";

    if (res.statusCode !== 200) {
      console.error(
        `❌ API 请求失败 [${res.statusCode}]。请检查 Token 是否有效或是否超限。`,
      );
      return;
    }

    res.on("data", (chunk) => (body += chunk));
    res.on("end", () => {
      try {
        const release = JSON.parse(body);
        const asset = release.assets.find((a) => a.name === "db.text.json");

        if (!asset) {
          console.error("❌ 错误：在最新 Release 中未找到 db.text.json");
          return;
        }

        console.log(`📦 发现新版本: ${release.tag_name}`);
        downloadFile(asset.browser_download_url);
      } catch (err) {
        console.error("❌ 解析 API 响应失败:", err.message);
      }
    });
  })
  .on("error", (err) => console.error("❌ 网络连接错误:", err.message));

function downloadFile(url) {
  console.log("⏳ 正在下载数据库并转换为 ESM 格式...");

  https.get(url, (res) => {
    if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
      https.get(res.headers.location, handleDownload);
    } else {
      handleDownload(res);
    }
  });

  function handleDownload(response) {
    let rawData = "";

    if (response.statusCode !== 200) {
      console.error(`❌ 下载失败，状态码: ${response.statusCode}`);
      return;
    }

    response.on("data", (chunk) => (rawData += chunk));
    response.on("end", () => {
      try {
        JSON.parse(rawData);

        if (!fs.existsSync(TARGET_DIR)) {
          fs.mkdirSync(TARGET_DIR, { recursive: true });
        }
        const finalContent = `export const data = ${rawData};\n`;

        fs.writeFileSync(OUTPUT_FILE, finalContent, "utf8");
        console.log(`\n✅ 处理完成！`);
        console.log(`📍 文件位置: ${OUTPUT_FILE}`);
        console.log(
          `📊 数据大小: ${(finalContent.length / 1024 / 1024).toFixed(2)} MB`,
        );
      } catch (err) {
        console.error("❌ 转换失败：下载的文件内容不是有效的 JSON");
      }
    });
  }
}
