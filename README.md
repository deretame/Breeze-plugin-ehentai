# Breeze-plugin-ehentai

e-hentai / exhentai 的 Breeze 插件，针对墙内网络做了直连优化。

## 功能

- **墙内 IP 直连（域名前置）**：连站点真实 IP + 不发 SNI + `Host` 头，绕过 DNS 污染与 SNI 阻断。
  需要 **Breeze > 3.0.37**；更低版本自动隐藏该功能，行为与官方版一致。
- **自动 IP 优选**：开启后由宿主后台探测候选 IP，只保留最快的 2~3 个写回前置表，结果缓存 12 小时。
- **JHenTai 同款默认 cookie**：`nw=1` / `datatags=1`，修复 MPV 链接解析导致的图片不出。
- **手动跟随重定向**：里站的 302 跳转由插件逐跳跟随（上限 5 跳，只跟随白名单内的 https 目标）。

## 设置

| 分区 | 字段 | 说明 |
| --- | --- | --- |
| 基础 | 站点 | 表站 EH / 里站 EX |
| 基础 | cookie | `ipb_member_id` / `ipb_pass_hash` / `igneous` |
| 网络 | 墙内 IP 直连 | 默认关；仅 Breeze > 3.0.37 显示 |
| 网络 | 自定义 IP | `host=ip1,ip2;host2=ip3`，留空用内置表 |

开关 label 实时显示状态：`生效：N 个域名 / M 个 IP` / `已关闭` / `宿主不支持，需新版 Breeze`。

## 开发

```bash
pnpm install

# 标签库（src/data.js，gitignore；需要 GITHUB_TOKEN 拉 EhTagTranslation）
node init.js

pnpm typecheck
pnpm test
pnpm build        # 产物在 dist/
```

App 运行时实测前置（另开 PowerShell 窗口）：

```powershell
powershell -ExecutionPolicy Bypass -File scripts/test-fronting.ps1
powershell -ExecutionPolicy Bypass -File scripts/test-fronting.ps1 -Once
```

脚本会读 App 的 `FileVersion` 判断门控是否开启，再把 `zephyr.exe` 的 443 连接对端 IP 与内置前置表比对，输出「前置 / 代理 / 普通」分类。

## 文档

- 插件开发文档：<https://breeze-project-org.github.io/plugin-dev-docs/>
- 域名前置与网络测量：<https://breeze-project-org.github.io/plugin-dev-docs/guide/runtime-api/network-fronting>
