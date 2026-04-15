import { data as tagTranslationData } from "../data.js";

type TranslationTagEntry = {
  name?: string;
};

type TranslationNamespaceEntry = {
  namespace?: string;
  frontMatters?: {
    aliases?: string[];
  };
  data?: Record<string, TranslationTagEntry>;
};

type TranslationDataset = {
  data?: TranslationNamespaceEntry[];
};

function normalizeKey(value: string): string {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

const namespaceAliasMap = new Map<string, string>();
const namespaceNameMap = new Map<string, string>();
const tagNameMap = new Map<string, Map<string, string>>();

const entries = (tagTranslationData as TranslationDataset).data ?? [];
for (const entry of entries) {
  const namespace = normalizeKey(entry.namespace ?? "");
  if (!namespace) {
    continue;
  }

  namespaceAliasMap.set(namespace, namespace);
  const aliases = Array.isArray(entry.frontMatters?.aliases)
    ? entry.frontMatters.aliases
    : [];
  for (const alias of aliases) {
    const aliasKey = normalizeKey(alias);
    if (aliasKey) {
      namespaceAliasMap.set(aliasKey, namespace);
    }
  }

  if (namespace === "rows") {
    const rowEntries = entry.data ?? {};
    for (const [key, value] of Object.entries(rowEntries)) {
      const translatedNamespace = String(value?.name ?? "").trim();
      const namespaceKey = normalizeKey(key);
      if (namespaceKey && translatedNamespace) {
        namespaceNameMap.set(namespaceKey, translatedNamespace);
      }
    }
    continue;
  }

  const tags = new Map<string, string>();
  for (const [rawTag, value] of Object.entries(entry.data ?? {})) {
    const tagKey = normalizeKey(rawTag);
    const translatedTag = String(value?.name ?? "").trim();
    if (tagKey && translatedTag) {
      tags.set(tagKey, translatedTag);
    }
  }
  tagNameMap.set(namespace, tags);
}

function resolveNamespace(namespace: string): string {
  const normalized = normalizeKey(namespace);
  return namespaceAliasMap.get(normalized) ?? normalized;
}

export function translateNamespace(namespace: string): string {
  const canonicalNamespace = resolveNamespace(namespace);
  return namespaceNameMap.get(canonicalNamespace) ?? namespace;
}

export function translateTag(namespace: string, tag: string): string {
  const canonicalNamespace = resolveNamespace(namespace);
  const tagKey = normalizeKey(tag);
  const namespaceTags = tagNameMap.get(canonicalNamespace);
  return namespaceTags?.get(tagKey) ?? tag;
}

