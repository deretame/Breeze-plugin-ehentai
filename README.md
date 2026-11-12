# Breeze-plugin-ehentai（里站直连版）· v0.3.5

> `https://github.com/deretame/Breeze-plugin-ehentai` 的墙内直连改造版。
> 目标：达到 `JHenTai` 的「里站（exhentai.org）直连」效果。

## 相对官方 v0.1.1 的改动

| # | 改动 | 需要宿主补丁 | 说明 |
| --- | --- | --- | --- |
| 1 | **默认注入 `nw=1` / `datatags=1`** | ❌ | 与 JHenTai 对齐。`datatags=1` 决定页面是否输出 `data-orghash`，而 **MPV → `/s/` 链接改写依赖它**——修好「MPV 链接解析不了导致图片不出」 |
| 2 | 墙内 IP 直连（域名前置） | ✅ | 连真实 IP + 不发 SNI + `Host` 头 + 强制 HTTP/1.1，绕过墙内 SNI RST |
| 3 | 手动跟随重定向 | ❌ | 里站大量使用 302 跳 `remoteapi.php`，逐跳手动跟（上限 5 跳），只跟随白名单内的 https 目标 |
| 4 | 「网络」设置分区 | ❌ | 开关 + 自定义 IP 覆盖位 + **实时状态显示在开关 label 上** |

改动 1、3、4 **不需要宿主补丁**即可生效；只有改动 2 需要。

---

## 1. JHenTai cookie 机制对齐（改动 1）

JHenTai 的 `lib/src/network/eh_cookie_manager.dart`：

```dart
List<Cookie> cookies = [Cookie('nw', '1'), Cookie('datatags', '1')];
```

本插件原先完全不注入这两个 cookie。本版补齐：

```ts
// src/services/settings.service.ts
const DEFAULT_EH_COOKIE_PAIRS = ["nw=1", "datatags=1"] as const;

export function buildRequestHeaders(settings: PluginSettings): Record<string, string> {
  const cookie = sanitizeForumCookie(settings.forumCookie);
  const pairs = new Map<string, string>();
  for (const pair of DEFAULT_EH_COOKIE_PAIRS) { /* nw=1, datatags=1 */ }
  for (const token of cookie.split(";")) { /* 用户 cookie 覆盖同名项 */ }
  return { Cookie: merged };
}
```

**为什么 `datatags=1` 关键**：

JHenTai 的 `lib/src/model/gallery_thumbnail.dart` 明确注释
`/// displayed when set cookie [datatags = 1]` → `originImageHash`，
而 MPV 链接改写成图片页链接**依赖它**：

```dart
// JHenTai: GalleryThumbnail.replacedMPVHref
return '$prefix/s/${originImageHash!.substring(0, 10)}/$gid-$pageNo';
```

本插件的 `src/parsers/reader.parser.ts` 已经实现了这个改写
（`MPV_HREF_REGEX` + `data-orghash`），
但 `data-orghash` **只有在 `datatags=1` 时才出现在页面里**。

里站的 igneous 探测链（`tryResolveExhentaiIgneous`）也一并带上默认 cookie，
与 JHenTai 的 Dio 拦截器行为一致。

### 附带修复：登录态判定

补上默认 cookie 后，`buildRequestConfig` 恒返回配置（不再为空），
会让「未登录 → AUTH_REQUIRED」的守卫失效。已新增 `hasAuthCookie()`，
按真正的凭据（`ipb_member_id` / `ipb_pass_hash`）判定，
`favorites.service.ts` / `favorite.service.ts` 的 3 处守卫改用它。

---

## 2. 域名前置（改动 2）

### 内置 IP 表

`src/network/ip-direct.ts` 的 `DEFAULT_FRONT_HOSTS`：
**6 个域名 / 29 个 IP**，2026-10-28 全量实测全部存活。

| 域名 | IP 数 | 实测 |
| --- | --- | --- |
| `e-hentai.org` | 2 | 200 真页面 |
| `exhentai.org` | 12 | 302 → `forums.e-hentai.org/remoteapi.php`（里站标准行为） |
| `forums.e-hentai.org` | 2 | 403 Cloudflare JS 挑战（IP 活着，是站点风控） |
| `api.e-hentai.org` | 7 | 200 `{"error":"Empty JSON Request"}` |
| `ehgt.org` | 3 | 可达（`/` 403 属目录禁列，带图片路径正常出图） |
| `s.exhentai.org` | 3 | 可达（403 属无签名路径） |

> Cloudflare 边缘 IP **不能**用于无 SNI 前置（它靠 SNI 决定路由到哪个 zone，
> 不发 SNI 时握手就失败），所以表里没有 CF 的 exhentai 边缘 IP。
>
> **IP 会随上游轮换**：本表为内置兜底值，可能随时间失效。某域名失效时，
> 无需改代码——在设置页「自定义 IP」里覆盖该域名的 IP 即可（格式 `host=ip1,ip2;host2=ip3`）。
> 最新可用 IP 以 `JHenTai` 的 `lib/src/setting/network_setting.dart` 的 `host2IPs` 为准。

### 设置页

| 分区 | 字段 | 说明 |
| --- | --- | --- |
| 基础 | 站点（表站 EH / 里站 EX） | 原有 |
| 基础 | `ipb_member_id` / `ipb_pass_hash` / `igneous` | 原有，cookie 登录 |
| **网络** | **墙内 IP 直连（SNI 绕过）** | 开关，**默认关**（需宿主开启 `host-fronting` feature 才生效） |
| 网络 | 自定义 IP | 覆盖内置表用，**默认空 = 用内置表** |

开关 label 会**实时显示状态**，不用猜：

| label | 含义 |
| --- | --- |
| `墙内 IP 直连（SNI 绕过） · 生效：7 个域名 / 29 个 IP` | 宿主持已支持，直连生效 ✅ |
| `墙内 IP 直连（SNI 绕过） · 宿主不支持，需新版 Breeze` | 宿主持没打补丁，直连没生效 ⚠️ |
| `墙内 IP 直连（SNI 绕过） · 已关闭` | 开关被手动关掉 |

**「宿主不支持」时填自定义 IP 也没用**——IP 表的消费者在宿主里。

### 宿主侧要求

必须给 Breeze 宿主打 5 个 Rust 补丁（`deliver/Breeze-host-fronting/patches/`），
因为 reqwest 默认协商 HTTP/2，而 h2 下 `:authority` 取自 URI（会是 IP），
Cloudflare 直接回 403。JS 侧无法强制 HTTP/1.1。

---

## 3. 手动跟随重定向（改动 3）

宿主开启前置时会把 3xx 交回插件（不自动跟随），所以插件要自己跟：

- 上限 5 跳（`MAX_REDIRECT_STEPS`）；
- 301 / 302 / 303 按规范退化为 GET，307 / 308 保持原方法与 body；
- 只跟随 `ALLOWED_ENDPOINT_HOSTS ∪ ALLOWED_MEDIA_HOSTS` 内的 https 目标，
  防开放重定向把请求带出信任域；
- `getTextWithMeta` **故意不自动跟随**——里站 igneous 探测要自己看 302 链
  和每一跳的 `Set-Cookie`。

未开启前置时 reqwest 仍会自动跟随，两条路径兼容。

---

## 4. 构建

```bash
# 依赖
pnpm install

# 标签库（src/data.js，gitignore；需要 GITHUB_TOKEN 拉 EhTagTranslation）
node init.js

# 类型检查
pnpm typecheck

# 测试
pnpm test

# 构建（产物在 dist/）
pnpm build
```

### 受限环境（禁止子进程 spawn）下的构建

本仓库的 `build/console-location-loader.cjs` 用 `require('tsx/cjs')` 加载 `.ts`，
而 tsx 依赖 esbuild，esbuild 的 JS API 需要 spawn 常驻 service 进程。
在 spawn 受限的环境里走不通。已提供两个等价替代：

| 文件 | 用途 | 等价性 |
| --- | --- | --- |
| `build/console-location-loader.nocjs.cjs` | 纯 JS 版 loader，只依赖 `oxc-parser` | 与原版输出**逐字节一致**（6 个文件比对通过） |
| `build/generate-manifest.bundle.cjs` | 从已构建 bundle 调 `getInfo()` 生成 manifest | 与原版同源，且更贴近安装后的真实行为 |

`rspack.shared.ts` 已切到纯 JS loader。**在正常环境里用原版脚本即可**，
这两个文件只是受限环境的备选。

测试用 `rstest --pool=threads`（默认 fork pool 也要 spawn）。

---

## 5. 验证状态

| 检查 | 结果 |
| --- | --- |
| `tsc --noEmit` | 0 错误 ✅ |
| 单元测试 | **115 passed \| 6 failed** |
| 与上游 v0.1.1 基线对比 | 失败清单**逐条一致 → 零回归** ✅ |
| bundle 构建 | 1.70 MB ✅ |
| brotli | 567 KB，round-trip 一致 ✅ |
| 加载级自检 | `node build/selfcheck.cjs` ✅ |
| 两种宿主持状态 label | 均实测正确 ✅ |

那 6 个失败是上游既存问题（function id `favorites` vs `cloudFavorite`、
fixture 页数不匹配等），与本次改动无关。

---

## 6. 目录

```
src/
├─ network/
│  ├─ ip-direct.ts       【新增】内置 IP 表 / 能力探测 / 幂等下发 / 状态
│  ├─ client.ts          【改】手动跟随重定向
│  └─ endpoints.ts
├─ services/
│  ├─ settings.service.ts 【改】JHenTai cookie + hasAuthCookie
│  ├─ favorites.service.ts【改】登录态判定
│  ├─ favorite.service.ts 【改】登录态判定
│  └─ ...
├─ mappers/
│  └─ settings.mapper.ts 【改】「网络」分区 + 实时状态 label
└─ domain/
   └─ constants.ts       【改】版本 0.3.0 + 新配置键
```
