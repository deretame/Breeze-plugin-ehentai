# Breeze Docs Update Suggestion

## Why this file exists

During `Breeze-plugin-ehentai` implementation, the current plugin docs are not explicit enough for `titleMeta` and `metadata` contracts. This causes plugin authors to guess field names, ordering, and value types.

## Missing contract definitions

1. `titleMeta` has no canonical schema.
   - Missing: required/optional keys, display order, multilingual naming rules.
   - Suggested minimum schema:
     - `name: string`
     - `value: string`
     - Optional `key: "japaneseTitle" | "englishTitle" | string` for stable programmatic usage.

2. `metadata` lacks enum/registry for semantic `type`.
   - Current plugins use free-form values (`artist`, `group`, `file_size`, etc.).
   - Suggested: publish recommended enum keys and aliases.

3. `metadata.value` type constraints are unclear.
   - Some fields are naturally numbers (`page_count`, `rating_count`), some are sizes (`file_size`), but contract only implies string arrays.
   - Suggested: add optional `valueType` (`string` | `number` | `size` | `datetime`) and keep backward-compatible `value`.

4. No guidance for detail-page preview provenance.
   - This plugin uses related gallery covers as preview simulation data.
   - Suggested: document whether simulated preview is allowed, and how to mark provenance (for example via `extension.previewMode`).

5. No mapping guide for bilingual titles.
   - In EH ecosystem, `#gj` (Japanese/original) and `#gn` (English/translated) are both important.
   - Suggested: add explicit recommendation for dual-title mapping under `titleMeta`.

## Proposed canonical examples

```ts
titleMeta: [
  { key: "japaneseTitle", name: "日文原名", value: "..." },
  { key: "englishTitle", name: "英文名", value: "..." },
]
```

```ts
metadata: [
  { type: "artist", name: "Artist", value: ["..."] },
  { type: "group", name: "Group", value: ["..."] },
  { type: "category", name: "Category", value: ["Manga"] },
  { type: "uploader", name: "Uploader", value: ["..."] },
  { type: "language", name: "Language", value: ["English"] },
  { type: "page_count", name: "page count", value: ["42"], valueType: "number" },
]
```

## Compatibility note

All suggestions above can be introduced as additive fields and guidance, without breaking existing plugins.
