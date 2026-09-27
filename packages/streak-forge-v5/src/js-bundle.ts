import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { removeStaleHashedFiles } from "./fs-utils.js";
import { join } from "node:path";
import type { BundleGenResult } from "./types.js";

/**
 * Bundles a widget/handler/component's TSX/TS source (plus every local
 * file it imports — Button.tsx into ProductCard.js, say) into one
 * standalone JS file: don't make every later render re-parse/re-transpile
 * TS from source, bundle it once, reuse the bundle. Written into the SAME
 * folder registry.ts/css-purge.ts already write that entry's meta.json/CSS
 * into, so the whole entry (metadata + CSS + compiled JS) lives in one
 * directory.
 *
 * `streak-forge` itself is externalized (`external: ["streak-forge", ...]`)
 * — the auto-injected `jsxImportSource` import (jsx-runtime/jsx-dev-runtime)
 * is left unresolved in the output rather than duplicated into every single
 * bundle. This matters beyond just bundle size: `streak-boot`'s
 * `renderInstanceFromBundle` (streakjs repo) imports these bundles in an
 * isolated container with NO project source tree — that caller needs
 * `streak-forge` resolvable in ITS OWN node_modules (an optional
 * peerDependency of `streak-boot`, plus the ambient `widget()`/etc. globals
 * preloaded via `streak-forge/globals`) for this externalized import to
 * resolve at all.
 */
export interface BundleOptions {
  /** Passed straight through to Bun.build. Defaults to false (readable
   *  output) — streak-forge's own pre-build always minifies; flip this to
   *  match that if the bundle is headed for production use, not inspection. */
  minify?: boolean;
}

export interface BundleTarget {
  /** Entrypoint — the widget/handler/component's own source file. */
  filePath: string;
  /** widget.type / component.type / handler.exportName — the folder + base filename. */
  name: string;
  /** Whole-file content hash (registry.fileHashes[filePath]) — the bundle
   *  cache key. Distinct from a widget/component's CSS sourceHash (which
   *  hashes only the annotated node + dynamicClasses, not the whole file
   *  or its imports) because bundling depends on the entire import graph. */
  fileHash: string;
}

const CACHE_DIR = ".streak-forge-cache/js";

export async function generateBundle(
  target: BundleTarget,
  outDir: string,
  kindDir: "widgets" | "handlers" | "components" | "html" | "head" | "body" | "rootLayout",
  options: BundleOptions = {},
): Promise<BundleGenResult> {
  const baseFileName = `${target.name}.${target.fileHash}.js`;
  const entryDir = join(outDir, kindDir, target.name);
  // Forward-slash on purpose — same convention as CssGenResult.fileName:
  // relative to outDir, joinable, or directly usable as an import specifier.
  const fileName = `${kindDir}/${target.name}/${baseFileName}`;

  const cacheDir = join(CACHE_DIR, kindDir);
  mkdirSync(cacheDir, { recursive: true });
  mkdirSync(entryDir, { recursive: true });

  const cacheFile = join(cacheDir, baseFileName);

  if (existsSync(cacheFile)) {
    const js = readFileSync(cacheFile, "utf-8");
    writeFileSync(join(entryDir, baseFileName), js);
    removeStaleHashedFiles(entryDir, target.name, ".js", baseFileName);
    return { name: target.name, fileName, fromCache: true };
  }

  const result = await Bun.build({
    entrypoints: [target.filePath],
    target: "bun",
    minify: options.minify ?? false,
    external: ["streak-forge", "streak-forge/*"],
  });

  if (!result.success) {
    const messages = result.logs.map((log) => String(log)).join("\n");
    throw new Error(`streak-forge: failed to bundle "${target.name}" (${target.filePath}):\n${messages}`);
  }

  const output = result.outputs.find((o) => o.kind === "entry-point") ?? result.outputs[0];
  if (!output) {
    throw new Error(`streak-forge: bundling "${target.name}" (${target.filePath}) produced no output`);
  }
  const js = await output.text();

  writeFileSync(cacheFile, js);
  writeFileSync(join(entryDir, baseFileName), js);
  removeStaleHashedFiles(entryDir, target.name, ".js", baseFileName);

  return { name: target.name, fileName, fromCache: false };
}
