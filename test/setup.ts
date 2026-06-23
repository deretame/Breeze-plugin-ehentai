/**
 * Polyfill `BreezeHtml` for Node-based tests.
 *
 * The production plugin runs inside Breeze's QuickJS runtime where
 * `BreezeHtml` is injected globally. In rstest (Node) we provide the same
 * surface using cheerio so parser tests can run without the host runtime.
 */
import { load } from "cheerio";

const global = globalThis as typeof globalThis & {
  BreezeHtml?: { load: typeof load };
};

if (!global.BreezeHtml) {
  global.BreezeHtml = { load };
}
