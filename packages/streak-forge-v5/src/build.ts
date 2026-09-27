import { fullScan, saveRegistry } from "./registry.js";
import { generateWidgetCss, generateCommonCss, collectGlobalClasses, findUndeclaredBracketClasses, shortScopePrefix, type PurgeEngine } from "./css-purge.js";
import { generateBundle, type BundleOptions } from "./js-bundle.js";
import { hashOf } from "./hash.js";
import { minifyCss } from "./minify.js";
import { readFileSync, writeFileSync, mkdirSync, existsSync, cpSync, readdirSync } from "node:fs";
import { join, dirname, basename } from "node:path";
import { removeStaleHashedFiles } from "./fs-utils.js";
import type { Registry, WidgetMeta, ComponentMeta, ShellMeta, CssGenResult } from "./types.js";

export interface PreBuildOptions {
  widgetsDir: string;
  handlersDir: string;
  /** Optional — a shared-component dir (Button, Card, ...) gets the same
   *  registry + CSS-purge treatment as widgets, in its own components/
   *  folder. Omit if the project has no such dir yet. */
  componentsDir?: string;
  /** Optional — a dir containing `html()`/`head()`/`body()` doc-shell
   *  entries (see hoc.ts). Omit if the project has none yet — the shared
   *  common-CSS bundle still gets generated either way, just into an
   *  auto-created `head/Common/` folder instead of a real head() entry's. */
  shellDir?: string;
  /** Optional — a project's static-asset dir (images, fonts, favicon,
   *  manually-authored JS libs, ...), copied wholesale into `outDir/public/`
   *  — same idea as streak-forge's own pre-build step, which does the exact
   *  same `public/` passthrough copy. Omit if the project has none.
   *  Every generated CSS file (widgets, components, handlers, html/head/
   *  body, the common-CSS bundle) is ALSO mirrored into `outDir/public/`
   *  regardless of this option, at the same relative path as its primary
   *  copy — so a static file server pointed at `outDir/public/` can serve
   *  everything, generated or hand-authored, from one root. JS bundles are
   *  deliberately NOT mirrored here (see the bundle loop below) — those are
   *  whole-module, server-side-only build artifacts; page-build.ts's
   *  Script-block extraction is what produces the JS that actually reaches
   *  public/. The primary, registry-colocated copies
   *  (`outDir/widgets/<Type>/...`, used by saveRegistry/loadRegistry) are
   *  unaffected — this only adds copies, never moves anything. */
  publicDir?: string;
  outDir: string;
  fullCssPath: string;
  purgeEngine: PurgeEngine;
  /** Given a widget/component/html/head/body's meta, return sample
   *  rendered HTML used only to seed the purge scan (real per-instance data
   *  doesn't matter here — CSS output is data-independent by design, see
   *  the dynamicClasses rule). */
  renderSample: (entry: WidgetMeta | ComponentMeta | ShellMeta) => Promise<string>;
  /** true = hard-fail the build on lint violations (undeclared bracket
   *  classes). Matches streak-forge's own strict-validator style. */
  strict: boolean;
  /** false skips the JS-bundle step entirely (registry + CSS still run).
   *  Object form is passed through to Bun.build (see js-bundle.ts).
   *  Defaults to bundling on, unminified. */
  bundle?: BundleOptions | false;
  /** CSS-Modules-style per-type class scoping — see css-purge.ts's
   *  prefixCssClasses/shortScopePrefix. Off by default (today's
   *  fully-shared, common-CSS-deduped utility classes, untouched). When
   *  true, the matching `buildPages({ scopeClasses: true })` MUST also be
   *  used — the CSS side renames selectors, the HTML side (page-build.ts)
   *  has to rename the class attribute values that need to match them.
   *  Also runs a collision check across every registered type's short
   *  prefix (see below) and throws before any output is written if two
   *  types collide. */
  scopeClasses?: boolean;
  /** Build-only — minifies every generated CSS file (see minify.ts's
   *  minifyCss) right before it's written, both the primary copy and its
   *  public/ mirror. Off by default so `streak-forge prebuild` (used ahead
   *  of BOTH `dev` and `build`) stays readable for local debugging; pass
   *  true from whichever invocation precedes a real `streak-forge build`
   *  (prebuild has no other way to know which one's coming — see this
   *  option's own CLI flag, `--minify`, in cli/prebuild.ts). Independent
   *  of `bundle`'s own `minify` (that one's for `.prebuild/`'s server-side
   *  whole-module reuse bundles, never shipped to the browser — a
   *  different concern from this one, which affects real public/ output). */
  minify?: boolean;
}

export interface PreBuildResult {
  registry: Registry;
  cssResults: CssGenResult[];
  /** The shared "head" bundle (Tailwind base/preflight + root vars) —
   *  always generated, see generateCommonCss. Not included in cssResults
   *  since it isn't any one widget's own CSS. */
  commonCss: CssGenResult;
  bundleResults: Awaited<ReturnType<typeof generateBundle>>[];
  lintErrors: string[];
}

type PurgeCategory = "widgets" | "components" | "html" | "head" | "body" | "rootLayout";

/**
 * Full pre-build pipeline, mirrors streak-forge's own stage order
 * (packages/streak-forge/src/build/preBuild.ts):
 *   1. registry full-scan          (this package's classpath-scan equivalent)
 *   2. lint pass                    (undeclared bracket-class check — hard fail if strict)
 *   3. common-CSS gen                (see generateCommonCss — always runs, once)
 *   4. per-entry CSS gen              (cached by sourceHash, common-deduped, see css-purge.ts)
 *   5. per-entry JS bundle              (cached by whole-file hash, see js-bundle.ts)
 * Widgets, components, and html/head/body doc-shell entries all go through
 * the identical lint + CSS-purge + bundle steps — the only structural
 * difference between them is which HOC name matched (see annotations.ts).
 * Page-join (turning bundled widgets into a composed page) stays in
 * streak-forge itself — this only adds the registry + CSS + JS-bundle +
 * cache layer on top.
 */
export async function runPreBuild(options: PreBuildOptions): Promise<PreBuildResult> {
  const registry = fullScan(options.widgetsDir, options.handlersDir, options.componentsDir, options.shellDir);

  const purgeCategories: Array<{ kindDir: PurgeCategory; entries: (WidgetMeta | ComponentMeta | ShellMeta)[] }> = [
    { kindDir: "widgets", entries: Object.values(registry.widgets) },
    { kindDir: "components", entries: Object.values(registry.components) },
    { kindDir: "html", entries: Object.values(registry.html) },
    { kindDir: "head", entries: Object.values(registry.head) },
    { kindDir: "body", entries: Object.values(registry.body) },
    { kindDir: "rootLayout", entries: Object.values(registry.rootLayout) },
  ];

  const lintErrors: string[] = [];
  for (const { entries } of purgeCategories) {
    for (const entry of entries) {
      const source = readFileSync(entry.filePath, "utf-8");
      const undeclared = findUndeclaredBracketClasses(source, entry.dynamicClasses);
      if (undeclared.length > 0) {
        lintErrors.push(
          `${entry.filePath}: bracket-syntax class(es) ${undeclared.join(", ")} used but not declared in dynamicClasses`,
        );
      }
    }
  }

  if (lintErrors.length > 0 && options.strict) {
    throw new Error(`streak-forge pre-build failed:\n${lintErrors.join("\n")}`);
  }

  // shortScopePrefix is deliberately tiny (3 hex chars — see its own doc
  // comment) to keep scoped HTML/CSS small, which trades away strong
  // collision-proofing on its own. This is the real safety net: every
  // registered type's prefix computed up front, hard-fail with the exact
  // colliding names if two distinct types ever land on the same one —
  // loud and immediate, instead of two widgets silently sharing (and
  // corrupting) each other's styles in the shipped output.
  if (options.scopeClasses) {
    const allTypes = purgeCategories.flatMap(({ entries }) => entries.map((e) => e.type));
    const seenByPrefix = new Map<string, string>();
    for (const type of allTypes) {
      const prefix = shortScopePrefix(type);
      const existing = seenByPrefix.get(prefix);
      if (existing && existing !== type) {
        throw new Error(
          `streak-forge pre-build failed: scopeClasses prefix collision — "${existing}" and "${type}" both hash to ` +
            `"${prefix}". Rename one of the two types (the filename) to resolve it.`,
        );
      }
      seenByPrefix.set(prefix, type);
    }
  }

  // Shared "head" bundle — the part identical across every widget (Tailwind
  // base/preflight, root vars), generated ONCE regardless of whether a
  // real head() entry exists in the project. If one does, it lives in that
  // entry's own folder; if not, streak-forge creates a synthetic "Common"
  // one so there's always a single file every page can load once instead
  // of every widget repeating it.
  const globalClasses = collectGlobalClasses(purgeCategories.flatMap(({ entries }) => entries));
  const commonCssText = await generateCommonCss(options.purgeEngine, options.fullCssPath, [...globalClasses]);
  const headType = Object.keys(registry.head)[0] ?? "Common";
  const commonCss = writeCommonCss(commonCssText, options.outDir, headType, options.minify ?? false);
  mirrorToPublic(options.outDir, commonCss.fileName, commonCss.css);

  const cssResults: CssGenResult[] = [];
  for (const { kindDir, entries } of purgeCategories) {
    for (const entry of entries) {
      const sampleHtml = await options.renderSample(entry);
      const result = await generateWidgetCss(
        entry,
        sampleHtml,
        options.purgeEngine,
        options.fullCssPath,
        options.outDir,
        kindDir,
        commonCssText,
        options.scopeClasses ?? false,
        options.minify ?? false,
        globalClasses,
      );
      cssResults.push(result);
      if (result.fileName) mirrorToPublic(options.outDir, result.fileName, result.css);
      const publicEntryDir = join(options.outDir, "public", kindDir, entry.type);
      removeStaleHashedFiles(publicEntryDir, entry.type, ".css", result.fileName ? basename(result.fileName) : null);
    }
  }

  const bundleResults = [];
  if (options.bundle !== false) {
    const bundleOptions = options.bundle ?? {};
    const bundleCategories: Array<{ kindDir: PurgeCategory | "handlers"; items: { filePath: string; name: string }[] }> = [
      { kindDir: "widgets", items: Object.values(registry.widgets).map((w) => ({ filePath: w.filePath, name: w.type })) },
      {
        kindDir: "handlers",
        items: Object.values(registry.handlers).map((h) => ({ filePath: h.filePath, name: h.exportName })),
      },
      {
        kindDir: "components",
        items: Object.values(registry.components).map((c) => ({ filePath: c.filePath, name: c.type })),
      },
      { kindDir: "html", items: Object.values(registry.html).map((e) => ({ filePath: e.filePath, name: e.type })) },
      { kindDir: "head", items: Object.values(registry.head).map((e) => ({ filePath: e.filePath, name: e.type })) },
      { kindDir: "body", items: Object.values(registry.body).map((e) => ({ filePath: e.filePath, name: e.type })) },
      {
        kindDir: "rootLayout",
        items: Object.values(registry.rootLayout).map((e) => ({ filePath: e.filePath, name: e.type })),
      },
    ];
    for (const { kindDir, items } of bundleCategories) {
      for (const item of items) {
        const result = await generateBundle(
          { filePath: item.filePath, name: item.name, fileHash: registry.fileHashes[item.filePath] ?? "" },
          options.outDir,
          kindDir,
          bundleOptions,
        );
        bundleResults.push(result);
        // Deliberately NOT mirrored to public/ — this is a whole-module
        // bundle (imports, server-render logic, everything), meant for
        // .prebuild/'s own server-side reuse (matching streak-forge's own
        // .prebuild/ convention: skip re-parsing/re-transpiling TS on every
        // import), not for shipping to the browser. Confirmed against real
        // streak-distiller's actual output: every .js file it ever writes
        // to its final static-out/ is Script-block-derived only, never a
        // whole widget module — see page-build.ts's collectScripts/
        // buildScriptBundle, which is what DOES reach public/out/.
      }
    }
  }

  // Hand-authored static assets (images, fonts, favicon, ...) — passthrough
  // copy, same as streak-forge's own pre-build step.
  if (options.publicDir && existsSync(options.publicDir)) {
    cpSync(options.publicDir, join(options.outDir, "public"), { recursive: true });
  }

  saveRegistry(registry, options.outDir);

  return { registry, cssResults, commonCss, bundleResults, lintErrors };
}

/** Writes the shared common-CSS bundle directly (it's already-purged text,
 *  nothing left to purge again) into head/<type>/ — the same folder
 *  registry.ts writes a real head() entry's own meta.json into, or an
 *  auto-created head/Common/ if the project declares no head() at all.
 *  Hashed/named from the RAW (pre-minify) text — deterministic either
 *  way, since minifyCss always produces the same output for the same
 *  input, but keeps this consistent with the RAW `commonCssText` every
 *  generateWidgetCss call still dedups against (see PreBuildOptions.minify
 *  and generateWidgetCss's own doc comment on why that comparison must
 *  never see minified text on either side). */
function writeCommonCss(css: string, outDir: string, type: string, minify: boolean): CssGenResult {
  const hash = hashOf(css);
  const baseFileName = `${type}.common.${hash}.css`;
  const dir = join(outDir, "head", type);
  mkdirSync(dir, { recursive: true });
  const finalCss = minify ? minifyCss(css) : css;
  writeFileSync(join(dir, baseFileName), finalCss);
  // Only one common bundle may exist (findCommonCssFile takes the first):
  // drop older ones, in every head/<Type>/ dir and its public/ mirror.
  for (const root of [join(outDir, "head"), join(outDir, "public", "head")]) {
    if (!existsSync(root)) continue;
    for (const headType of readdirSync(root)) {
      const keep = headType === type && root === join(outDir, "head") ? baseFileName : null;
      removeStaleHashedFiles(join(root, headType), `${headType}.common`, ".css", keep);
    }
  }
  return { widgetType: type, fileName: `head/${type}/${baseFileName}`, css: finalCss, fromCache: false };
}

/** Mirrors a generated file (CSS or JS text) into outDir/public/ at the
 *  same relative path as its primary, registry-colocated copy — additive
 *  only, never a move, so saveRegistry/loadRegistry's paths stay untouched. */
function mirrorToPublic(outDir: string, fileName: string, content: string): void {
  const dest = join(outDir, "public", fileName);
  mkdirSync(dirname(dest), { recursive: true });
  writeFileSync(dest, content);
}
