import { readFileSync, statSync } from "node:fs";
import { PurgeCSS } from "purgecss";
import type { PurgeEngine } from "../css-purge.js";

/** Every attribute name used in an attribute selector of the full CSS file
 *  (`[data-active="true"]`, `[aria-expanded="true"]`, `[type="button"]`) —
 *  cached per file + mtime, since the same file is purged once per entry. */
const attributeCache = new Map<string, { mtimeMs: number; names: string[] }>();
function attributeSelectorNames(fullCssPath: string): string[] {
  const { mtimeMs } = statSync(fullCssPath);
  const cached = attributeCache.get(fullCssPath);
  if (cached?.mtimeMs === mtimeMs) return cached.names;
  const selectors = readFileSync(fullCssPath, "utf-8").replace(/\{[^{}]*\}/g, "{}");
  const names = [...new Set([...selectors.matchAll(/\[\s*([a-zA-Z_][-\w]*)\s*(?:[~|^$*]?=|\])/g)].map((m) => m[1]!))];
  attributeCache.set(fullCssPath, { mtimeMs, names });
  return names;
}

/**
 * The CLI's built-in purge engine, backed by the `purgecss` package —
 * streak-forge's contract with a purge engine is just (html, fullCssPath)
 * -> css string; this is the one real, always-available implementation of
 * it, so no consuming project has to hand-roll its own (every project
 * that did, before this moved into the package, wrote the exact same
 * wrapper).
 *
 * `fullCssPath` is expected to already be a real, fully-built Tailwind CSS
 * file (produced by buildFullCss below before pre-build runs) — PurgeCSS
 * only SUBTRACTS rules from it, it can't invent a rule Tailwind's own
 * build never emitted. That's why buildFullCss feeds every
 * widget/component's dynamicClasses into Tailwind's `safelist` first: a
 * runtime-assembled class like `bg-${accentColor}-500` has to already
 * exist in the full CSS, or no amount of purging here can recover it.
 * This function's only job is the subtractive half — given one widget's
 * real rendered HTML (+ its dynamicClasses dummy element, added by
 * streak-forge itself before calling this), keep only the rules that HTML
 * actually uses.
 */
export const defaultPurgeEngine: PurgeEngine = async ({ html, fullCssPath }) => {
  const [result] = await new PurgeCSS().purge({
    content: [{ raw: html, extension: "html" }],
    css: [fullCssPath],
    // PurgeCSS's DEFAULT extractor splits on "." — for a class like
    // "py-1.5" that means it extracts "py-1" (wrong) instead of "py-1.5"
    // (correct), so the purge silently keeps the WRONG rule (padding
    // 0.25rem instead of the real 0.375rem) with no error, no warning.
    // This is Tailwind's own documented PurgeCSS extractor for exactly
    // this reason — keeps a Tailwind class's full token (colons, dots,
    // slashes) intact instead of the default word-boundary split.
    defaultExtractor: (content) => content.match(/[^<>"'`\s]*[^<>"'`\s:]/g) || [],
    // Attribute selectors are decided by their classes alone. Otherwise a
    // Tailwind attribute variant (`data-[active=true]:border-black` →
    // `.data-\[active\=true\]\:border-black[data-active="true"]`) is
    // dropped whenever the sample HTML lacks that exact attribute value —
    // typically set by a client script at runtime.
    dynamicAttributes: attributeSelectorNames(fullCssPath),
  });
  return result?.css ?? "";
};
