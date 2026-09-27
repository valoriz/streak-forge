import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { hashOf } from "./hash.js";
import { minifyCss } from "./minify.js";
import type { CssGenResult, WidgetMeta, ComponentMeta, ShellMeta } from "./types.js";

/**
 * streak-forge does NOT reimplement Tailwind's JIT scanner or PurgeCSS —
 * it wraps whichever one the host project already uses and adds:
 *   1. per-widget/component cache, keyed by sourceHash (source + dynamicClasses)
 *   2. dummy-element injection so annotated dynamicClasses survive the purge
 *      even though they never appear as literal strings in the source
 *   3. common-CSS dedup — strip whatever's already in the shared "head"
 *      bundle (Tailwind's base/preflight + root vars) out of every
 *      individual widget's own CSS, so it's not repeated per-widget
 *
 * `purgeEngine` is supplied by the host app (examples/test-app/streak-forge.config.ts
 * shows a Tailwind CLI-backed one). This keeps streak-forge decoupled from any
 * one CSS toolchain — swap Tailwind for UnoCSS, vanilla PurgeCSS, whatever.
 */
export type PurgeEngine = (params: { html: string; fullCssPath: string }) => Promise<string>;

/** The purge-relevant subset WidgetMeta/ComponentMeta/ShellMeta all satisfy. */
type PurgeableMeta = Pick<WidgetMeta | ComponentMeta | ShellMeta, "type" | "dynamicClasses" | "sourceHash">;

const CACHE_DIR = ".streak-forge-cache/css";

/**
 * The shared "head" bundle: whatever survives purging against ZERO classes
 * present. A rule keyed on a class selector (`.bg-red-500 {...}`) always
 * gets dropped — nothing in an empty scan matches it — but Tailwind's
 * base/preflight rules (`*, ::before, ::after {...}`, element resets like
 * `h3 { ... }`) use element/universal selectors, not classes, so PurgeCSS
 * (or any purge engine following the same "keep unless nothing matches"
 * rule) leaves them alone regardless of content. That's exactly the part
 * that's identical across every widget today — this call is what
 * `runPreBuild` uses to generate it ONCE instead of per-widget.
 */
export async function generateCommonCss(purgeEngine: PurgeEngine, fullCssPath: string): Promise<string> {
  return stripCssComments(await purgeEngine({ html: "", fullCssPath }));
}

/** Strips `/* ... *\/` comments (Tailwind's own preflight ships several —
 *  licensing/provenance notes meant for a human reading the FULL source,
 *  pure dead weight in a purged, shipped asset) and collapses the blank
 *  lines left behind. Applied to whatever a purge engine returns,
 *  regardless of which one is plugged in — comment noise isn't specific
 *  to PurgeCSS. Simple regex, not a real CSS parser: safe here because
 *  Tailwind-generated CSS never puts a literal `/* ` sequence inside a
 *  string/url() value. */
function stripCssComments(css: string): string {
  return css
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * Removes any top-level CSS rule from `css` that's byte-identical to one
 * already present in `commonCss` — the dedup half of the common-CSS split.
 * Deliberately simple (exact top-level `{...}` block matching, not a real
 * CSS AST diff): both strings come from the same deterministic Tailwind
 * build, so a rule that's meant to be shared comes out as the exact same
 * text in both places. Free-standing text between rules (comments, blank
 * lines) is dropped along with everything else that isn't a `{...}` block —
 * harmless for a purged CSS asset, comments carry no runtime meaning.
 */
export function subtractCommonRules(css: string, commonCss: string): string {
  const commonRules = new Set(splitTopLevelRules(commonCss));
  return splitTopLevelRules(css)
    .filter((rule) => !commonRules.has(rule))
    .join("\n\n");
}

function splitTopLevelRules(css: string): string[] {
  const rules: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < css.length; i++) {
    if (css[i] === "{") depth++;
    else if (css[i] === "}") {
      depth--;
      if (depth === 0) {
        rules.push(css.slice(start, i + 1).trim());
        start = i + 1;
      }
    }
  }
  return rules.filter(Boolean);
}

export async function generateWidgetCss(
  widget: PurgeableMeta,
  renderedSampleHtml: string,
  purgeEngine: PurgeEngine,
  fullCssPath: string,
  outDir: string,
  kindDir: "widgets" | "components" | "html" | "head" | "body" | "rootLayout" = "widgets",
  /** Subtracted from the result via subtractCommonRules — see
   *  generateCommonCss. Omit to skip dedup (e.g. for the common bundle's
   *  own generation, which has nothing to subtract from itself). */
  commonCss?: string,
  /** CSS-Modules-style class scoping (see prefixCssClasses below) — every
   *  class selector this entry's CSS keeps gets renamed to
   *  "<type>__<class>". Off by default: today's fully-shared,
   *  common-CSS-deduped utility classes are untouched unless a caller
   *  opts in (PreBuildOptions.scopeClasses). */
  scopeClasses = false,
  /** Build-only (see PreBuildOptions.minify) — applied LAST, after
   *  subtractCommonRules/prefixCssClasses, never before: dedup compares
   *  RAW rule text against `commonCss` (also raw — see writeCommonCss's
   *  own doc comment on why it stays unminified internally), so minifying
   *  earlier would make matching rules stop looking byte-identical and
   *  silently break the dedup. */
  minify = false,
): Promise<CssGenResult> {
  const baseFileName = `${widget.type}.${widget.sourceHash}.css`;
  // widgets/<Type>/ (or components/<Type>/, html/<Type>/, ...) — same
  // folder registry.ts writes that entry's meta.json into, so its
  // metadata + CSS live together.
  const entryDir = join(outDir, kindDir, widget.type);
  // Forward-slash on purpose: this is what callers join with outDir to
  // locate the file, and what it becomes in a real <link href> — not a
  // raw OS filesystem path, so it shouldn't vary by platform.
  const fileName = `${kindDir}/${widget.type}/${baseFileName}`;

  mkdirSync(CACHE_DIR, { recursive: true });

  const cacheFile = join(CACHE_DIR, baseFileName);

  // Cache stores the RAW purge result (pre-dedup) so a change to the common
  // bundle alone (e.g. a Tailwind config edit) is still reflected on a
  // cache hit — dedup always runs fresh against the current commonCss,
  // never gets baked into what's cached.
  let rawCss: string;
  let fromCache: boolean;
  if (existsSync(cacheFile)) {
    rawCss = readFileSync(cacheFile, "utf-8");
    fromCache = true;
  } else {
    // Dummy elements carrying the annotated classes — makes them "appear"
    // in the HTML the purge engine scans, without touching the actual
    // render output. Flattened groups: grouping in the annotation is for
    // human documentation only, purge doesn't care about the grouping.
    const dummyMarkup = widget.dynamicClasses.length
      ? `<div class="${widget.dynamicClasses.join(" ")}"></div>`
      : "";
    const scanHtml = `${renderedSampleHtml}\n${dummyMarkup}`;
    rawCss = stripCssComments(await purgeEngine({ html: scanHtml, fullCssPath }));
    writeFileSync(cacheFile, rawCss);
    fromCache = false;
  }

  let css = commonCss !== undefined ? subtractCommonRules(rawCss, commonCss) : rawCss;
  if (scopeClasses) css = prefixCssClasses(css, shortScopePrefix(widget.type));
  if (minify) css = minifyCss(css);

  // Nothing survived purge/dedup (e.g. a widget with no classNames of its
  // own, or every one of them shared with the common bundle) — write no
  // file at all, so it's never found by findOwnCssFile/discoverCssHrefs
  // and never turns into a wasted request for an empty stylesheet. An
  // empty `fileName` signals "no file" to callers (mirrorToPublic skips
  // it too).
  if (css.trim() === "") {
    return { widgetType: widget.type, fileName: "", css: "", fromCache };
  }

  mkdirSync(entryDir, { recursive: true });
  writeFileSync(join(entryDir, baseFileName), css);

  return { widgetType: widget.type, fileName, css, fromCache };
}

/**
 * A short, deterministic per-TYPE prefix — "ProductCard"/"HelloFeatures"
 * as a literal prefix on EVERY class of EVERY element adds up fast (real
 * HTML-size cost, not just noise); a few characters of a stable hash of
 * the type name gets the same collision-proofing at a fraction of the
 * size. Leads with a fixed letter so the result is always a valid CSS
 * identifier even though a hex hash can start with a digit (`.3f2{...}`
 * is invalid CSS without escaping; `.c3f2{...}` always parses). Pure
 * function of `type` alone — every call site (CSS selectors here, HTML
 * class attributes in page-build.ts) computes the identical prefix
 * independently, no shared lookup table needed.
 *
 * Only 3 hex chars (4096 combinations) — deliberately kept minimal to cut
 * HTML/CSS size, not "as many as fit comfortably". That trades away
 * strong collision-proofing on its own (a real risk once a project has
 * many widget/component/shell types), so this is paired with a real
 * safety net instead of just hoping: build.ts's runPreBuild computes
 * every registered type's prefix up front and throws a clear, named error
 * if two DISTINCT types ever collide, before anything is written — a
 * collision becomes a loud build failure, never silent style corruption.
 */
export function shortScopePrefix(type: string): string {
  return `c${hashOf(type).slice(0, 3)}`;
}

/**
 * CSS-Modules-style class scoping: every class selector in `css` gets
 * renamed to "<prefix>__<originalClass>" — a widget/component/shell TYPE
 * never shares a class name with another one's CSS again, at the cost of
 * losing common-CSS dedup for any class this touches (a shared Tailwind
 * utility like `.bg-blue-500` turns into a separately-duplicated rule per
 * type that uses it — an accepted, deliberate tradeoff for callers who
 * opt in, not the default).
 *
 * Only rewrites text in SELECTOR position, recursing into @media/@supports
 * bodies for their own nested selectors — a declaration block's property
 * VALUES (e.g. `margin: 0.5rem`) are never touched, so a decimal point is
 * never mistaken for a class token. Preserves whatever escaping the
 * source selector already used (Tailwind escapes `:`, `/`, `.`, `[`, `]`
 * in generated class selectors, e.g. `.hover\:bg-blue-500`) — this is
 * exactly why prefixHtmlClasses below stays in sync without any shared
 * lookup table: both are pure functions of (prefix, class name), CSS
 * keeping the source's own escaping, HTML using the literal unescaped form
 * a class ATTRIBUTE value actually needs. Callers pass a prefix — usually
 * `shortScopePrefix(type)`, not the raw type name (see its own doc comment).
 */
export function prefixCssClasses(css: string, prefix: string): string {
  return rewriteSelectorsInBlocks(css, prefix);
}

function rewriteSelectorsInBlocks(css: string, prefix: string): string {
  let out = "";
  let i = 0;
  while (i < css.length) {
    const braceIdx = css.indexOf("{", i);
    if (braceIdx === -1) {
      out += css.slice(i);
      break;
    }
    const head = css.slice(i, braceIdx);
    let depth = 1;
    let j = braceIdx + 1;
    while (j < css.length && depth > 0) {
      if (css[j] === "{") depth++;
      else if (css[j] === "}") depth--;
      j++;
    }
    const body = css.slice(braceIdx + 1, j - 1);
    if (head.trim().startsWith("@")) {
      // @media/@supports/@keyframes/... — its body holds its own nested
      // selector+declaration pairs (or, for @keyframes, "selectors" like
      // 0%/50%/from/to that never start with "." — rewriting is a
      // harmless no-op there), so recurse instead of treating `head` as
      // a plain selector.
      out += `${head}{${rewriteSelectorsInBlocks(body, prefix)}}`;
    } else {
      out += `${prefixSelectorText(head, prefix)}{${body}}`;
    }
    i = j;
  }
  return out;
}

// A "." followed by one or more of: an escaped char (\X, consuming
// whatever X is — this is how Tailwind escapes :, /, ., [, ] inside a
// class selector) or a plain identifier character. Stops at the first
// UNESCAPED selector-syntax character (space, comma, combinator,
// bracket, or a real (non-escaped) pseudo-class colon), so
// `.hover\:bg-blue-500:hover` captures the class token but not `:hover`.
const CLASS_TOKEN = /\.((?:\\.|[^\s.,>+~()[\]{}\\:])+)/g;

function prefixSelectorText(selector: string, prefix: string): string {
  return selector.replace(CLASS_TOKEN, (_match, className: string) => `.${prefix}__${className}`);
}

/**
 * The HTML-side half of the same scoping scheme — rewrites every class
 * name in `html`'s `class="..."` attributes to "<prefix>__<class>", kept
 * in sync with prefixCssClasses purely by both being deterministic
 * functions of (prefix, class name), no shared lookup table needed.
 * Applied to a widget/component/shell instance's OWN rendered HTML at
 * build time (page-build.ts) — never to the sample HTML used for the
 * purge SCAN itself (generateWidgetCss above), which needs the real,
 * unprefixed class names for Tailwind/PurgeCSS to recognize at all.
 */
export function prefixHtmlClasses(html: string, prefix: string): string {
  return html.replace(/class="([^"]*)"/g, (_match, classList: string) => {
    const prefixed = classList
      .split(/\s+/)
      .filter(Boolean)
      .map((cls) => `${prefix}__${cls}`)
      .join(" ");
    return `class="${prefixed}"`;
  });
}

/**
 * Bracket-syntax guard (`bg-[#123456]`, `w-[37px]`): these are NOT allowed
 * as inline string literals in widget source unless declared verbatim in
 * @dynamicClasses. This function is what the companion ESLint rule
 * (see eslint-rules.ts) calls to check a source string against the
 * annotation. Anything else must be plain inline style, not a Tailwind
 * arbitrary-value class.
 */
export function findUndeclaredBracketClasses(sourceText: string, declared: string[]): string[] {
  const bracketClassPattern = /[a-zA-Z-]+-\[[^\]]+\]/g;
  const found = sourceText.match(bracketClassPattern) ?? [];
  const declaredSet = new Set(declared);
  return [...new Set(found)].filter((cls) => !declaredSet.has(cls));
}
