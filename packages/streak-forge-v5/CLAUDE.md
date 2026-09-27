# CLAUDE.md — streak-forge (v5)

## What this package does

Dev server + pre-build engine for Streak.js. Owns everything authoring-time: the annotation-based widget/handler/component registry, TSX→JS compilation, per-widget CSS purge, and the live-reload dev server. It does **not** compose or serve pages — that's the sibling `streak-boot` package (different repo: `streakjs/packages/streak-boot`), which reads this package's `.prebuild/` output and never runs source-scanning code of its own.

## Essential commands

```bash
bun run typecheck   # tsc --noEmit
bun run test         # bun test
bun run build         # bundle this package itself -> dist/
```

## Architecture

- **Registry model**: `widget({...})(fn)` / `handler({...})(fn)` / `component({...})(fn)` / `html|head|body|rootLayout({...})(fn)` are real function calls (not comment annotations), structurally matched via `annotations.ts`'s TS AST parse — never executed at scan time. `registry.ts`'s `fullScan` walks the project's `src/widgets|handlers|components|shell` dirs once; `incrementalRescan` (dev only) re-parses just a changed file plus its direct importers.
- **`.dev/` vs `.prebuild/`**: `cli/dev.ts` and `cli/prebuild.ts` call the *same* `runPreBuild()` (`build.ts`) with different flags (`strict`/`minify`/`outDir`) — dev must see byte-identical purged CSS to a real build, by design. There is no separate "dev prebuild" implementation.
- **CSS scoping**: every widget's CSS is purged (via a host-supplied `purgeEngine`, see `cli/purge-engine.ts`) and prefixed to a short, deterministic per-type code (`css-purge.ts`'s `shortScopePrefix`), so two widgets sharing a class name never collide.

## Key files

| File | Role |
|---|---|
| `src/build.ts` | `runPreBuild()` — registry scan → CSS purge → JS bundle → registry save |
| `src/registry.ts` | `fullScan`/`saveRegistry`/`incrementalRescan` — the FULL version; `streak-boot`'s copy is read-only (`loadRegistry` only) |
| `src/js-bundle.ts` | `generateBundle` — `external: ["streak-forge", "streak-forge/*"]` **must stay in sync with this package's own name** (see gotcha below) |
| `src/cli/dev.ts` | `streak-forge dev` — watch loop + live-reload wiring |
| `src/cli/prebuild.ts` | `streak-forge prebuild` — one-shot, strict, minified |

## Gotchas

- **`js-bundle.ts`'s `external` list is a literal string, not a path** — it must match this package's own published name exactly, or a compiled bundle's `jsx-runtime` import won't resolve for whoever loads it later (a real project, or `streak-boot`'s `renderInstanceFromBundle`). If this package is ever renamed again, that line has to change too.
- **`REGISTRY_MARKER_PATH` (`registry.ts`) is `"streak-boot.registry.json"` — NOT renamed to match this package.** It's a real file-format contract with `streak-boot`'s own `registry.ts` (this package writes it, that one reads it). Do not "fix" this to say `streak-forge`.
- **Handler memoization is per-function-reference, not per-name** — a `dev` rebuild that re-imports a widget busts its own cache via the `?v=<mtime>` query in `cli/render.ts`'s `importAndCall`, but an unchanged file elsewhere in the same process does not get a fresh reference. Restart `dev` to pick up an edit that isn't reflected.
- **The old v4 package is now `streak-forge-legacy`** (`packages/streak-forge`, folder unchanged, only its `package.json` `name`/`bin` were renamed) — this package holds the real `streak-forge` name/bin now.

## Follow-ups (explicitly out of scope, not started)

- `streak-boot`'s eventual relationship to `streak-distiller` (replace vs. coexist) — deliberately deferred.
- Wiring this package into `apps/streak-forge-build` (the existing cloud build pipeline) or the `streak-boot` repo's `apps/build-system`/`apps/serve-worker` (a working reference implementation of the same idea, built independently) — not connected yet.
