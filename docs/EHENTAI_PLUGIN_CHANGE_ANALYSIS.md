# Breeze-plugin-ehentai Change Analysis

This document lists what should be changed in `D:\data\project\web\Breeze-plugin-ehentai` based on:

- current plugin implementation status
- Breeze plugin contract (`plugin-dev-docs`)
- JHenTai image/detail behavior research

It is intentionally implementation-oriented: file-level targets, risks, and acceptance checks.

## 1. Current Gap Summary

The plugin already implements a minimal flow (`searchComic`, `getComicDetail`, `getChapter`, `getReadPages`, `getInfo`), but has critical gaps for real EH/EX image delivery:

1. `fetchImageBytes` is missing (contract-required core function).
2. media host allowlist is too strict for real EH/EX image hosts.
3. reader flow does not implement robust `nl` reload retry behavior.
4. parser coverage is incomplete for MPV/modern detail and thumbnail structures.
5. detail metadata and recommendation/preview mapping are still shallow compared to JHenTai.

These gaps directly explain "images not showing" in production-like cases.

## 2. P0 (Must Fix First): Image Display Reliability

### 2.1 Add `fetchImageBytes` function and export it

- Target files:
  - `src/index.ts`
  - `src/domain/contracts.ts` (add contract type)
  - `src/network/client.ts` (binary downloader utility)
- Why:
  - Breeze contract explicitly includes `fetchImageBytes` in core set.
  - EH/EX image delivery often needs controlled request headers (cookie/referer/host) and binary fetch path.
- Acceptance:
  - `fetchImageBytes({ url })` returns `{ nativeBufferId }`.
  - exported in default export object.

### 2.2 Fix media host policy for real EH/EX image hosts

- Target files:
  - `src/domain/constants.ts`
  - `src/utils/url.ts`
  - `src/services/chapter.service.ts` (use media-safe URL validator for image URLs, not endpoint-only validator)
- Why:
  - current chapter flow validates final image URL via `ensureAllowedHostUrl` (endpoint allowlist), which can reject valid image hosts.
  - real EH ecosystem includes domains beyond current strict set (for example `s.exhentai.org`, `*.hath.network`, `*.ehgt.org` variants).
- Acceptance:
  - chapter parsing no longer fails on valid EH/EX media hosts.
  - non-HTTPS and clearly unsafe hosts still rejected.

### 2.3 Implement `nl` reload retry chain in reader flow

- Target files:
  - `src/services/chapter.service.ts`
  - `src/parsers/reader.parser.ts`
- Why:
  - plugin currently parses `reloadKey` but does not actively use it for reparsing/retry.
  - JHenTai behavior uses `?nl=<reloadKey>` for failed image-page resolution and stale links.
- Acceptance:
  - when first image-page parse fails or resolves invalid image response, reader retries with `nl`.
  - retry budget is bounded and deterministic.

### 2.4 Add EH image error-page detection (at least 509 + empty/HTML invalid)

- Target files:
  - `src/parsers/reader.parser.ts`
  - `src/services/chapter.service.ts`
- Why:
  - current parser only checks `#img src` existence.
  - EH frequently returns limit/error pages that look like "successful HTTP but invalid image payload".
- Acceptance:
  - detect 509 gif and mark as upstream-limit parse/network error.
  - detect HTML/error signatures and trigger reparsing path (not silent success).

## 3. P1 (High Priority): Parser Compatibility and Detail Quality

### 3.1 Detail cover parsing should support real page style structure

- Target files:
  - `src/parsers/detail.parser.ts`
- Why:
  - current parser uses `#gd1 img` only.
  - real detail pages commonly expose cover in `#gd1 > div[style*=url(...)]`.
- Acceptance:
  - cover parsed from style URL first; `img` remains fallback.

### 3.2 Thumbnail parsing should support MPV/new structures

- Target files:
  - `src/parsers/reader.parser.ts`
  - `src/domain/types.ts`
- Why:
  - current parser only accepts `#gdt a[href*='/s/']`.
  - real pages can produce MPV links and require conversion.
- Acceptance:
  - parser can extract image-page links from both `/s/` and MPV variants.
  - MPV conversion path documented in parser/service logic.

### 3.3 Expand `getComicDetail` metadata depth (`titleMeta` + `metadata`)

- Target files:
  - `src/parsers/detail.parser.ts`
  - `src/mappers/detail.mapper.ts`
  - `src/domain/contracts.ts` (if needed to support richer action item shape)
- Why:
  - current output is minimal and misses many detail fields available in EH pages.
  - original requirement asks for richer metadata alignment.
- Acceptance:
  - include key detail fields (dual title, category, uploader, language, size, page count, posted, tags by namespace).
  - schema compatible with Breeze detail rendering expectations.

### 3.4 Implement related-gallery preview mapping in `recommend`

- Target files:
  - `src/services/detail.service.ts`
  - `src/mappers/detail.mapper.ts`
  - `src/network/endpoints.ts` (if adding a related endpoint helper)
- Why:
  - current `recommend` is always empty.
  - requirement expects preview simulation via related gallery thumbs.
- Acceptance:
  - `data.normal.recommend` populated when related data is available.
  - items contain valid cover/thumb URLs and stable IDs.
  - add provenance marker in extension (for example `extension.previewMode = "related-thumb-mock"`).

## 4. P2 (Feature Completeness): Search/Settings/Contract Alignment

### 4.1 Search filters (category/tag) and optional advanced search scheme

- Target files:
  - `src/services/search.service.ts`
  - `src/network/endpoints.ts`
  - `src/index.ts` (export `getAdvancedSearchScheme` / `get_advanced_search_scheme` if implemented)
- Why:
  - current search is keyword-only.
  - requirement expects keyword + category + tag search.
- Acceptance:
  - extern-based category/tag filters can alter upstream request.
  - paging remains correct and contract-stable.

### 4.2 Settings expansion for session/image behavior

- Target files:
  - `src/domain/types.ts`
  - `src/services/settings.service.ts`
  - `src/mappers/settings.mapper.ts`
- Why:
  - current settings only include `site` + unused `imageProxyEnabled`.
  - image reliability may require user cookie and transport behavior knobs.
- Candidate fields:
  - `ehCookie` (text/password-like field)
  - `preferOriginalImage` (switch)
  - `readerConcurrency` (choice/select)
- Acceptance:
  - settings are read from `extern` safely and actually used by services.

### 4.3 Contract shape normalization vs Breeze examples

- Target files:
  - `src/domain/contracts.ts`
  - mappers using `titleMeta`/`metadata`
- Why:
  - local contract typing is narrower than practical Breeze usage in reference plugins.
- Acceptance:
  - avoid over-constraining internal types in ways that block richer detail mapping.
  - keep backward compatibility for current host consumption.

## 5. Test Plan Updates Required

The current fixtures/tests are too idealized for EH edge cases. Add/adjust tests for:

1. `fetchImageBytes` returns `nativeBufferId`.
2. media URL on `s.exhentai.org` / `*.hath.network` is accepted.
3. detail cover parsed from `#gd1 > div[style]`.
4. thumbnail page with MPV links can still resolve image pages.
5. reader retries with `nl` after first failure.
6. 509/error HTML response is detected and surfaced correctly.
7. related preview mapping fills `recommend`.

Suggested files:

- `test/contract.fetch-image.spec.ts`
- `test/parser.reader.edgecases.spec.ts`
- `test/contract.detail.recommend.spec.ts`
- extend `test/network.client.security.spec.ts` with media-host policy assertions

## 6. Recommended Execution Order

1. P0.1 + P0.2 + P0.3 (make image pipeline functional).
2. P0.4 (error-page detection hardening).
3. P1.1 + P1.2 (parser compatibility).
4. P1.3 + P1.4 (detail richness + preview simulation).
5. P2 items (search/settings/contract refinements).
6. broaden fixtures and regression tests.

## 7. File Inventory (Primary Edit Targets)

- `D:\data\project\web\Breeze-plugin-ehentai\src\index.ts`
- `D:\data\project\web\Breeze-plugin-ehentai\src\domain\constants.ts`
- `D:\data\project\web\Breeze-plugin-ehentai\src\domain\types.ts`
- `D:\data\project\web\Breeze-plugin-ehentai\src\domain\contracts.ts`
- `D:\data\project\web\Breeze-plugin-ehentai\src\network\client.ts`
- `D:\data\project\web\Breeze-plugin-ehentai\src\network\endpoints.ts`
- `D:\data\project\web\Breeze-plugin-ehentai\src\parsers\detail.parser.ts`
- `D:\data\project\web\Breeze-plugin-ehentai\src\parsers\reader.parser.ts`
- `D:\data\project\web\Breeze-plugin-ehentai\src\services\detail.service.ts`
- `D:\data\project\web\Breeze-plugin-ehentai\src\services\chapter.service.ts`
- `D:\data\project\web\Breeze-plugin-ehentai\src\services\search.service.ts`
- `D:\data\project\web\Breeze-plugin-ehentai\src\mappers\detail.mapper.ts`
- `D:\data\project\web\Breeze-plugin-ehentai\src\mappers\chapter.mapper.ts`

