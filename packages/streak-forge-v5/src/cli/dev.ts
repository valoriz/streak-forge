import { existsSync, cpSync, watch, type FSWatcher } from "node:fs";
import { join } from "node:path";
import { runPreBuild } from "../build.js";
import { readSitemap, buildPages } from "../page-build.js";
import { defaultPurgeEngine } from "./purge-engine.js";
import { renderSample, renderInstance } from "./render.js";
import { discoverCssHrefs } from "./discover-css-hrefs.js";
import { writeDynamicClassesSafelist } from "./safelist.js";
import { createMockWorkerServer } from "./mock-worker-server.js";
import { projectPaths } from "./conventions.js";

/**
 * `streak-forge dev` — watches widgets/handlers/components/shell/sitemap,
 * rebuilds into `.dev/` on change, serves it with live-reload. Every
 * rebuild runs the real per-widget CSS purge (never a shortcut like
 * serving the unpurged full CSS) — dev has to see the SAME purged CSS a
 * real build ships, or a class missing from the safelist would render
 * fine in dev and only break once a real build purges it for real.
 *
 * Deliberately does NOT touch the project's full CSS build (no
 * `tailwindcss` invocation anywhere in this package, in dev or otherwise
 * — see safelist.ts's own doc comment). It only rewrites the
 * dynamicClasses safelist JSON (a streak-forge-native concern) on each
 * rebuild; keeping `src/app.full.css` itself fresh is a SEPARATE process
 * this expects to already be running alongside it — a project's
 * `tailwindcss --watch`, wired via its own `dev` script (`concurrently
 * "bun run css-build -- --watch" "streak-forge dev"`), exactly mirroring
 * how a real streak-forge app already runs its CSS watcher and its dev
 * server as two independent processes, not one.
 */
/**
 * One dev build pass — extracted from `runDevCommand` so it's directly
 * testable (a full `runDevCommand` starts a live server and watches files
 * forever, which a test can't easily call and assert on). `runDevCommand`
 * below just calls this on startup and again on every watched file change.
 */
export async function runDevBuildOnce(root: string): Promise<{ lintErrors: string[] }> {
  const paths = projectPaths(root);

  writeDynamicClassesSafelist({
    root: paths.root,
    widgetsDir: paths.widgetsDir,
    handlersDir: paths.handlersDir,
    componentsDir: existsSync(paths.componentsDir) ? paths.componentsDir : undefined,
    shellDir: existsSync(paths.shellDir) ? paths.shellDir : undefined,
  });

  const prebuild = await runPreBuild({
    widgetsDir: paths.widgetsDir,
    handlersDir: paths.handlersDir,
    componentsDir: existsSync(paths.componentsDir) ? paths.componentsDir : undefined,
    shellDir: existsSync(paths.shellDir) ? paths.shellDir : undefined,
    publicDir: existsSync(paths.publicDir) ? paths.publicDir : undefined,
    outDir: paths.devDir,
    fullCssPath: paths.fullCssPath,
    purgeEngine: defaultPurgeEngine,
    // false, not true: a lint miss (an undeclared bracket-syntax class)
    // shouldn't take the whole dev server down — just warn and keep
    // serving whatever DID build, same as any other dev-mode warning.
    strict: false,
    renderSample,
    scopeClasses: true,
  });

  // Promote .dev/public/'s generated CSS/JS + passthrough static assets
  // (images, motion.js, ...) up into .dev/ itself, flat — mirrors what
  // cli/build.ts's runBuildCommand does for a real build. Without this,
  // the mock server (which resolves a static asset at outDir/<path>
  // directly, matching the real out/'s flat layout) never finds a plain
  // passthrough file like /images/streak-logo.svg — generated CSS
  // happened to still work by coincidence (it's already written to its
  // flat, registry-colocated path too), which is what made this easy to
  // miss until a passthrough-only asset was actually requested.
  const publicDir = join(paths.devDir, "public");
  if (existsSync(publicDir)) cpSync(publicDir, paths.devDir, { recursive: true });

  // dev: simple per-file <link> list (no combine/inline logic) — good
  // enough for a loop that rebuilds on every save anyway. See
  // BuildPagesOptions.inlineCss's own doc comment for why build/serve
  // does it differently.
  const cssHrefs = discoverCssHrefs(publicDir);
  const sitemap = readSitemap(paths.sitemapPath);
  await buildPages({ registry: prebuild.registry, sitemap, outDir: paths.devDir, render: renderInstance, scopeClasses: true, cssHrefs });

  return { lintErrors: prebuild.lintErrors };
}

export async function runDevCommand(root: string): Promise<void> {
  const paths = projectPaths(root);
  const port = Number(process.env.PORT ?? 4000);

  async function build(): Promise<void> {
    const { lintErrors } = await runDevBuildOnce(root);
    if (lintErrors.length > 0) {
      console.warn(`[dev] ${lintErrors.length} lint warning(s):`);
      for (const err of lintErrors) console.warn(`  - ${err}`);
    }
  }

  function watchDir(dir: string, onChange: (reason: string) => void): FSWatcher | undefined {
    if (!existsSync(dir)) return undefined;
    // recursive: true — Bun/Node's fs.watch supports it on Linux/macOS,
    // which is all this reference dev server targets.
    return watch(dir, { recursive: true }, (_event, filename) => onChange(filename ?? dir));
  }

  async function waitForFullCss(timeoutMs = 10000): Promise<void> {
    if (existsSync(paths.fullCssPath)) return;
    console.log(`[dev] waiting for ${paths.fullCssPath} (run your CSS watcher alongside this, e.g. "bun run css-build -- --watch")...`);
    const start = Date.now();
    while (!existsSync(paths.fullCssPath)) {
      if (Date.now() - start > timeoutMs) {
        console.warn(`[dev] ${paths.fullCssPath} still missing after ${timeoutMs}ms — starting anyway; the next file-change rebuild will retry.`);
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
  }

  console.log("[dev] initial build...");
  await waitForFullCss();
  await build();
  console.log("[dev] build complete.");

  // liveReload: true — dev-only. No HMR here on purpose: these are
  // server-rendered HTML fragments, not a client-side component tree with
  // state worth preserving, so a full reload (pushed to the browser over
  // SSE the moment a rebuild finishes, instead of hitting refresh
  // yourself) is the correct fit, not a shortcut.
  const server = createMockWorkerServer({ outDir: paths.devDir, port, liveReload: true });
  console.log(`[dev] serving ${paths.devDir} at ${server.url} (live-reload on)`);

  let rebuilding = false;
  let pending = false;
  const rebuild = (reason: string) => {
    if (rebuilding) {
      pending = true;
      return;
    }
    rebuilding = true;
    console.log(`[dev] change detected (${reason}) — rebuilding...`);
    const start = performance.now();
    build()
      .then(() => {
        console.log(`[dev] rebuild complete (${Math.round(performance.now() - start)}ms).`);
        server.notifyReload();
      })
      .catch((err) => console.error("[dev] rebuild failed:", err))
      .finally(() => {
        rebuilding = false;
        if (pending) {
          pending = false;
          rebuild("queued change");
        }
      });
  };

  // Debounced — an editor save routinely fires several fs events for one
  // logical change (write + rename + metadata), which would otherwise
  // trigger several overlapping rebuilds for a single edit.
  let debounce: ReturnType<typeof setTimeout> | undefined;
  const onFsEvent = (reason: string) => {
    if (debounce) clearTimeout(debounce);
    debounce = setTimeout(() => rebuild(reason), 150);
  };

  const watchers = [
    watchDir(paths.widgetsDir, onFsEvent),
    watchDir(paths.handlersDir, onFsEvent),
    watchDir(paths.componentsDir, onFsEvent),
    watchDir(paths.shellDir, onFsEvent),
    // Static assets are copied into .dev/ on each build — without this, a
    // CSS watcher writing into public/ (or a new image) never reaches it.
    watchDir(paths.publicDir, onFsEvent),
  ].filter((w): w is FSWatcher => w !== undefined);
  if (existsSync(paths.sitemapPath)) {
    watchers.push(watch(paths.sitemapPath, () => onFsEvent("streak.sitemap.json")));
  }

  console.log("[dev] watching for changes (widgets/handlers/components/shell/public/streak.sitemap.json)...");

  process.on("SIGINT", () => {
    for (const w of watchers) w.close();
    server.stop();
    process.exit(0);
  });
}
