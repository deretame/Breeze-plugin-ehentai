/**
 * Type declarations for BreezeHtml — the Rust-backed cheerio-compatible API
 * injected into every plugin runtime.
 *
 * This is a minimal, read-only subset of the cheerio API that covers the
 * operations used by Breeze plugins.
 *
 * Existing plugins that import from `"cheerio"` can drop that dependency and
 * use `const load = BreezeHtml.load;` directly. Copy this declaration file into
 * the plugin project and reference it from the global type declarations so
 * TypeScript knows about `BreezeHtml` and the returned selection types.
 */

export interface BreezeMappedResult<T> {
  readonly length: number;
  get(): T[];
}

export interface BreezeSelection {
  readonly length: number;

  find(selector: string): BreezeSelection;
  first(): BreezeSelection;
  last(): BreezeSelection;
  eq(index: number): BreezeSelection;
  closest(selector: string): BreezeSelection;
  parent(): BreezeSelection;
  is(selector: string): boolean;

  attr(name: string): string | undefined;
  text(): string;
  html(): string | undefined;

  toArray(): BreezeSelection[];
  each(callback: (index: number, element: BreezeSelection) => void): void;
  map<T>(callback: (index: number, element: BreezeSelection) => T): BreezeMappedResult<T>;
}

export interface BreezeDocument {
  select(selector: string): BreezeSelection;
}

export type BreezeApi = {
  (selector: string): BreezeSelection;
  (element: BreezeSelection): BreezeSelection;
};

export interface BreezeHtmlStatic {
  load(html: string): BreezeApi;
}

declare global {
  const BreezeHtml: BreezeHtmlStatic;
}

// Compatibility aliases for plugins that still reference cheerio type names.
export type CheerioAPI = BreezeApi;
export type Cheerio<T = any> = BreezeSelection;
