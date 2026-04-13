# E-Hentai 图片处理调研笔记（基于 JHenTai）

> 目的：先把“为什么图片会显示失败、JHenTai 怎么处理”的机制固定下来，后续实现 `Breeze-plugin-ehentai` 时按此落地，避免遗漏。

## 1. JHenTai 的图片获取不是“详情页直接给图 URL”

JHenTai 的核心思路是两段式：

1. 先从详情页拿每一页的 `href`（图片页地址，不是最终图片地址）。
2. 再请求这个图片页，解析 `#img` 的 `src` 才得到真实图片 URL。

对应关键位置：

- `lib/src/pages/read/read_page_logic.dart`
- `lib/src/network/eh_request.dart` -> `requestImagePage`
- `lib/src/utils/eh_spider_parser.dart` -> `imagePage2GalleryImage` / `imagePage2OriginalGalleryImage`

## 2. 必须做的特殊处理（否则很容易“图片不显示”）

### 2.1 Cookie 注入是默认能力，不是可选

JHenTai 在请求 EH/EX 域名时统一注入 Cookie（拦截器）。

- 默认就有：`nw=1`、`datatags=1`
- 登录后还会带 `ipb_member_id` / `ipb_pass_hash` / `igneous` 等

`datatags=1` 很关键，因为它会影响详情页缩略图节点里是否能拿到 `data-orghash`。

### 2.2 MPV 链接会被改写成普通图片页链接

详情页可能给的是 `mpv` 链接，不适合直接做逐页解析。  
JHenTai 会在 `GalleryThumbnail.replacedMPVHref(pageNo)` 中转换为：

- `.../mpv/{gid}/...` -> `.../s/{originImageHash前10位}/{gid}-{pageNo}`

如果不做这步，后续图片页解析稳定性会下降。

### 2.3 reloadKey（`nl` 参数）是重载链路核心

从图片页里会解析 `#loadfail` 的 `onclick`，提取 `nl('xxxx')` 的 key。  
下一次重试同一页时，请求会带 `?nl=xxxx`。

这条链路用于“当前图链失效/节点异常”后的再取图，非常关键。

### 2.4 509 限流图要被识别为异常

JHenTai 在解析图片页时会识别这两个 URL：

- `https://ehgt.org/g/509.gif`
- `https://exhentai.org/img/509.gif`

命中后不是当作正常图片，而是抛“超限”异常并走相应处理。

### 2.5 下载到 HTML 时，不当作图片成功

JHenTai 下载后会检查返回是否是 `text/html`。若是，会读取内容并判断：

- `Invalid token` -> 重新解析 URL
- `Invalid request` / `An error has occurred` -> 重新解析 URL
- `You have reached the image limit...` -> 暂停全部任务
- 空文件 -> 重新解析 URL

也就是说：即使 HTTP 成功，内容仍可能不是图，必须做内容级校验。

### 2.6 EX 某些图域名会做替换

在展示组件里，JHenTai 对 `s.exhentai.org` 做过替换到 `ehgt.org` 的处理（`EHImage._replaceEXUrl`）。  
这是一个兼容性修正点，后续插件可保留同类兜底策略。

## 3. 原图（Original）逻辑注意点

JHenTai 解析时会同时提取“原图入口链接”（如果页面有）。  
若原图 URL 存在，则优先使用原图 URL；且该分支下 `reloadKey` 可能不可用。

另外原图可能受 GP/时段限制，失败后不能简单无限重试。

## 4. JHenTai 的失败恢复策略（值得照搬）

1. 先重试请求（网络层）
2. 请求失败后触发“重新解析图片页 URL”
3. 重解析时带上上一轮拿到的 `reloadKey`
4. 必要时清理对应缓存后再重取

这是一条“重新拿图链”而不是“死磕同一 URL”的策略。

## 5. 对 `Breeze-plugin-ehentai` 的实现约束（先记结论，不写代码）

后续实现时至少要满足：

1. 详情页/图片页请求必须具备 Cookie 注入能力（含 `datatags=1`）。
2. 图片流程必须是“页地址 -> 解析真实图 URL”两段式，不要直接把详情页缩略图当阅读图。
3. 需要支持 `reloadKey(nl)` 重试链路。
4. 需要识别 509 限流图并转为业务错误。
5. 对“下载到 HTML”的情况做内容识别并触发重解析/暂停策略。
6. 保留 EX 图域名兼容处理（`s.exhentai.org` 相关）。

## 6. 按页面区分的图片来源与处理（补充）

你说的对，不同页面的图源和处理确实不一样，不能混用一套逻辑。

### 6.1 搜索页/列表页（Gallery List）

搜索页、排行榜页、本质都走 `galleryPage2GalleryPageInfo` 解析列表卡片数据：

- 封面 URL 来源：
  - 从列表 HTML 的 `<img data-src|src>` 直接取（不同列表模式选择器不同）
  - 对应函数：`_parseMinimalGalleryCover` / `_parseCompactGalleryCover` / `_parseExtendedGalleryCover` / `_parseThumbnailGalleryCover`
- 渲染方式：
  - 卡片直接用 `gallery.cover` -> `EHImage` -> `ExtendedImage.network`
- 结论：
  - 这里是“封面直链模式”，通常不需要走“图片页二段解析”。

额外点：

- 列表加载后会有封面预取：`getNetworkImageData(gallery.cover.url, useCache: true)`。

### 6.2 详情页封面（Detail Cover）

详情页封面不是沿用列表图时，会从详情 HTML 重新解析：

- 来源：`#gd1 > div` 的 `style` 里 `url(...)`
- 解析函数：`detailPage2GalleryAndDetailAndApikey`
- 渲染：`DetailsPage._buildCover` 使用 `EHImage`

此外，如果只拿到 API metadata，也会用 `gdata.thumb` 作为 `cover` 的来源。

### 6.3 详情页缩略图网格（Preview Thumbnails）

详情页下方缩略图走 `#gdt` 解析（支持新旧结构）：

- `detailPage2Thumbnails` / `_detailPageDocument2Thumbnails`
- 新结构会拿 `thumbUrl`、`originImageHash`
- 老小图模式是“雪碧图裁切”（一个大图里拼多个缩略图），`EHThumbnail` 里通过 `sourceRect` 裁出单图

结论：详情缩略图可直接显示 `thumbUrl`，但它们是“预览缩略图”，不是阅读正文图。

### 6.4 阅读页正文图（Read Full Images）

阅读页才是最重的特殊链路：

1. 先拿每页 `href`
2. 必要时 MPV -> `/s/...` 改写
3. 请求图片页并解析 `#img src` 得真实图 URL
4. 带 `reloadKey(nl)` 做重载重试
5. 识别 509/HTML 错页/Invalid token 等并重解析

结论：阅读图必须走“解析链路”，不能把搜索/详情里的封面或缩略图逻辑直接套过来。

### 6.5 一句话总览

- 搜索页/列表页：封面直链，偏轻量。
- 详情页：封面直链 + 缩略图（可能雪碧图裁切）。
- 阅读页：图片页解析、重载 key、异常识别、重解析，最重。

## 7. 关键参考文件（JHenTai）

- `D:\data\project\flutter\JHenTai\lib\src\network\eh_cookie_manager.dart`
- `D:\data\project\flutter\JHenTai\lib\src\network\eh_request.dart`
- `D:\data\project\flutter\JHenTai\lib\src\utils\eh_spider_parser.dart`
- `D:\data\project\flutter\JHenTai\lib\src\model\gallery_thumbnail.dart`
- `D:\data\project\flutter\JHenTai\lib\src\service\gallery_download_service.dart`
- `D:\data\project\flutter\JHenTai\lib\src\pages\read\read_page_logic.dart`
- `D:\data\project\flutter\JHenTai\lib\src\widget\eh_image.dart`
- `D:\data\project\flutter\JHenTai\lib\src\pages\base\base_page_logic.dart`
- `D:\data\project\flutter\JHenTai\lib\src\widget\eh_gallery_collection.dart`
- `D:\data\project\flutter\JHenTai\lib\src\widget\eh_gallery_list_card_.dart`
- `D:\data\project\flutter\JHenTai\lib\src\widget\eh_gallery_waterflow_card.dart`
- `D:\data\project\flutter\JHenTai\lib\src\pages\details\details_page.dart`
- `D:\data\project\flutter\JHenTai\lib\src\pages\details\thumbnails\thumbnails_page.dart`
