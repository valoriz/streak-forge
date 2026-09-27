import { readdirSync, statSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";

/**
 * A pragmatic, dependency-free minifier for the small CSS fragments this
 * package generates (purged Tailwind output) — not a full CSS optimizer,
 * just comment/whitespace stripping, matching the rest of this codebase's
 * own regex-based CSS handling (stripCssComments, prefixCssClasses, ... in
 * css-purge.ts) rather than pulling in a real CSS AST parser/dependency.
 * Quoted string literals (e.g. `content: "a  b"`) are protected first so
 * their internal whitespace is never touched.
 */
export function minifyCss(css: string): string {
  const strings: string[] = [];
  const protectedCss = css.replace(/"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'/g, (match) => {
    strings.push(match);
    return `\u0000${strings.length - 1}\u0000`;
  });
  const minified = protectedCss
    .replace(/\/\*[\s\S]*?\*\//g, "") // comments
    .replace(/\s+/g, " ") // collapse whitespace runs
    .replace(/\s*([{}:;,])\s*/g, "$1") // no space around structural characters
    .replace(/;}/g, "}") // drop the now-redundant trailing ;
    .trim();
  return minified.replace(/\u0000(\d+)\u0000/g, (_, i: string) => strings[Number(i)]!);
}

/**
 * Same pragmatic approach for the small HTML fragments this package
 * writes — collapses inter-tag whitespace and strips comments, protecting
 * <pre>/<textarea>/<script>/<style> blocks verbatim (their whitespace can
 * be meaningful — e.g. a widget rendering a literal code sample) rather
 * than a full HTML parser.
 */
export function minifyHtml(html: string): string {
  const blocks: string[] = [];
  const protectedHtml = html.replace(/<(pre|textarea|script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, (match) => {
    blocks.push(match);
    return `\u0000${blocks.length - 1}\u0000`;
  });
  const minified = protectedHtml
    .replace(/<!--[\s\S]*?-->/g, "") // comments
    .replace(/>\s+</g, "><") // whitespace BETWEEN tags
    .replace(/\s+/g, " ") // any remaining whitespace runs (e.g. leading/trailing text)
    .trim();
  return minified.replace(/\u0000(\d+)\u0000/g, (_, i: string) => blocks[Number(i)]!);
}

/**
 * Real, native, AST-based minification for JS — deliberately NOT
 * hand-rolled with regex like minifyCss/minifyHtml above: naive whitespace
 * collapsing risks corrupting string/template/regex literals in real
 * executable code. This package already runs on Bun, which ships a fast
 * native minifier for free (Bun.build), so there's no reason to hand-roll
 * one or add a dependency.
 *
 * Batches every path into ONE Bun.build call — a real bundler has real
 * per-call setup cost, and calling it once per small widget script.js
 * adds up fast on a site with many widgets (~12x slower in a 30-file
 * benchmark, separate calls vs one batched call).
 *
 * `result.outputs` is NOT returned in entrypoint order — Bun sorts it by
 * output path, confirmed empirically (a real build with page-specific
 * widgets sharing an instance id across pages, e.g.
 * pages/about/widgets/hello-message/script.js and
 * pages/docs/widgets/hello-message/script.js, came back alphabetically,
 * silently writing one widget's minified script into a COMPLETELY
 * different file, __streak/root.js among them — a severe, silent
 * correctness bug caught only by inspecting real build output, not by an
 * earlier same-basename-collision benchmark that happened not to trigger
 * it). Mapped back by `output.path` instead, which Bun sets to each
 * entrypoint's path relative to `root` (explicitly passed here, rather
 * than relying on the default resolution) — verified 1:1, no gaps, no
 * extras, against a real multi-directory file set.
 */
export async function minifyJsFiles(filePaths: string[], root: string): Promise<void> {
  if (filePaths.length === 0) return;
  const result = await Bun.build({ entrypoints: filePaths, minify: true, root });
  if (!result.success) {
    throw new Error(`minifyJsFiles: Bun.build failed — ${result.logs.map((l) => l.message).join("; ")}`);
  }
  const byRelativePath = new Map(filePaths.map((p) => [relative(root, p), p]));
  const entryOutputs = result.outputs.filter((o) => o.kind === "entry-point");
  if (entryOutputs.length !== filePaths.length) {
    throw new Error(`minifyJsFiles: expected ${filePaths.length} entry-point output(s), got ${entryOutputs.length}`);
  }
  for (const output of entryOutputs) {
    const sourcePath = byRelativePath.get(output.path);
    if (!sourcePath) {
      throw new Error(`minifyJsFiles: could not map minified output "${output.path}" back to a source file`);
    }
    writeFileSync(sourcePath, await output.text());
  }
}

/** Recursively finds every file under `dir` whose basename is in
 *  `basenames` — used to collect every widget/component/dynamic-block
 *  script.js/bundle.js a buildPages run wrote, for one batched
 *  minifyJsFiles call at the end (see page-build.ts's own call site)
 *  instead of a separate Bun.build call per file. */
export function findFilesByBasename(dir: string, basenames: Set<string>): string[] {
  const found: string[] = [];
  const walk = (current: string): void => {
    for (const entry of readdirSync(current)) {
      const full = join(current, entry);
      if (statSync(full).isDirectory()) {
        walk(full);
      } else if (basenames.has(entry)) {
        found.push(full);
      }
    }
  };
  walk(dir);
  return found;
}
