#!/usr/bin/env bun
/**
 * Builds the publishable package into dist/: minified JS only (no .ts
 * sources, no source maps), plus .d.ts type declarations for editors and
 * tsc. package.json's `exports`/`bin` point at dist/.
 *
 *   dist/index.js, globals.js, jsx-runtime.js, jsx-dev-runtime.js,
 *   dist/render-record.js ("streak-forge/render": stage-1 render + record),
 *   dist/runtime.js ("streak-forge/runtime": what prebuilt bundles import),
 *   dist/streak-forge.js (the CLI)
 *   dist/chunk-*.js   shared code (one module instance across entry points)
 *   dist/types/**     .d.ts declarations
 *
 * Dependencies (typescript, chokidar, purgecss) stay external — installed
 * alongside, never inlined.
 */
import { rmSync, cpSync, chmodSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..");
const DIST = join(ROOT, "dist");
const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf-8")) as { dependencies?: Record<string, string> };

rmSync(DIST, { recursive: true, force: true });

const result = await Bun.build({
  entrypoints: [
    join(ROOT, "src/index.ts"),
    join(ROOT, "src/globals.ts"),
    join(ROOT, "src/jsx-runtime.ts"),
    join(ROOT, "src/jsx-dev-runtime.ts"),
    join(ROOT, "src/render-record.ts"),
    join(ROOT, "src/runtime.ts"),
    join(ROOT, "bin/streak-forge.ts"),
  ],
  outdir: DIST,
  root: ROOT,
  target: "bun",
  format: "esm",
  splitting: true,
  minify: true,
  sourcemap: "none",
  external: Object.keys(pkg.dependencies ?? {}),
  naming: { entry: "[name].js", chunk: "chunk-[hash].js" },
});
if (!result.success) {
  for (const log of result.logs) console.error(log);
  process.exit(1);
}

// Entry points are written under their source folder (src/, bin/) — flatten
// them to dist/<name>.js so package.json paths stay short.
for (const out of result.outputs) {
  if (out.kind !== "entry-point") continue;
  const rel = out.path.slice(DIST.length + 1);
  if (!rel.includes("/")) continue;
  const name = rel.split("/").pop()!;
  cpSync(out.path, join(DIST, name));
  rmSync(out.path);
  // Chunk imports are relative to the old folder ("../chunk-x.js").
  const moved = join(DIST, name);
  writeFileSync(moved, readFileSync(moved, "utf-8").replaceAll('"../chunk-', '"./chunk-'));
}
rmSync(join(DIST, "src"), { recursive: true, force: true });
rmSync(join(DIST, "bin"), { recursive: true, force: true });

// The CLI entry needs its shebang and the executable bit.
const cli = join(DIST, "streak-forge.js");
const cliCode = readFileSync(cli, "utf-8").replace(/^#!.*\n/, "");
writeFileSync(cli, `#!/usr/bin/env bun\n${cliCode}`);
chmodSync(cli, 0o755);

// Type declarations (types only, no code).
const tsc = Bun.spawnSync(["bunx", "tsc", "-p", join(ROOT, "tsconfig.build.json")], { cwd: ROOT, stdout: "inherit", stderr: "inherit" });
if (tsc.exitCode !== 0) process.exit(tsc.exitCode ?? 1);
cpSync(join(ROOT, "src/ambient-globals.d.ts"), join(DIST, "types/ambient-globals.d.ts"));

console.info(`built ${result.outputs.length} JS file(s) + types into dist/`);
