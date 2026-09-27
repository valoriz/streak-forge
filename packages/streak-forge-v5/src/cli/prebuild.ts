import { existsSync } from "node:fs";
import { runPreBuild } from "../build.js";
import { defaultPurgeEngine } from "./purge-engine.js";
import { renderSample } from "./render.js";
import { projectPaths } from "./conventions.js";

/**
 * `streak-forge prebuild` — TSX->JS conversion + per-widget CSS purge only
 * (see build.ts's own doc comment for why that split matters). Treats
 * `fullCssPath` as a REQUIRED, ALREADY-BUILT input — this command never
 * invokes a CSS compiler itself; that's the project's own `css-build`
 * script, meant to run immediately before this in the same chain (a
 * project's package.json: `"prebuild": "streak-forge safelist && bun run
 * css-build && streak-forge prebuild"`), exactly mirroring how a real
 * streak-forge app already separates the two.
 *
 * Only ever a precursor to a real `streak-forge build` — `streak-forge dev`
 * has its own separate, internal `runPreBuild` call (cli/dev.ts's
 * runDevBuildOnce), writing straight to `.dev/` and never touching this
 * command, MINIFY, or `.prebuild/` at all. That's why CSS minification
 * (below) can safely default ON here: there's no dev-mode path that could
 * ever inherit it by accident.
 */
export async function runPrebuildCommand(root: string): Promise<void> {
  const paths = projectPaths(root);

  if (!existsSync(paths.fullCssPath)) {
    throw new Error(
      `streak-forge prebuild: ${paths.fullCssPath} does not exist yet — run your CSS build first ` +
        `(e.g. "streak-forge safelist && bun run css-build && streak-forge prebuild").`,
    );
  }

  // Env var, not a --flag — same convention runServeCommand already uses
  // for PORT. On by default (this command is only ever a precursor to a
  // real `streak-forge build`, never `dev` — see this file's own doc
  // comment); set MINIFY=0 to opt out for a one-off unminified build.
  const minify = process.env.MINIFY !== "0" && process.env.MINIFY !== "false";

  const result = await runPreBuild({
    widgetsDir: paths.widgetsDir,
    handlersDir: paths.handlersDir,
    componentsDir: existsSync(paths.componentsDir) ? paths.componentsDir : undefined,
    shellDir: existsSync(paths.shellDir) ? paths.shellDir : undefined,
    publicDir: existsSync(paths.publicDir) ? paths.publicDir : undefined,
    outDir: paths.prebuildDir,
    fullCssPath: paths.fullCssPath,
    purgeEngine: defaultPurgeEngine,
    strict: true,
    renderSample,
    scopeClasses: true,
    minify,
  });

  console.log(`Widgets registered: ${Object.keys(result.registry.widgets).join(", ")}`);
  console.log(`Handlers registered: ${Object.keys(result.registry.handlers).join(", ")}`);
  console.log(`Components registered: ${Object.keys(result.registry.components).join(", ")}`);
  console.log(
    `Shell registered: html=${Object.keys(result.registry.html)}, head=${Object.keys(result.registry.head)}, body=${Object.keys(result.registry.body)}, rootLayout=${Object.keys(result.registry.rootLayout)}`,
  );
  console.log(`CSS files generated: ${result.cssResults.filter((r) => r.fileName).length}`);
  console.log(`JS bundles generated: ${result.bundleResults.length}`);
  console.log(`Lint errors: ${result.lintErrors.length}`);
}
