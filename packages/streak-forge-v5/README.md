# streak-forge (v5)

**Dev server + pre-build engine for [Streak.js](https://docs.streakjs.com/) — a performance-first static site generator that ships zero framework overhead to the browser.**

[![npm version](https://img.shields.io/npm/v/streak-forge)](https://www.npmjs.com/package/streak-forge)
[![docs](https://img.shields.io/badge/docs-docs.streakjs.com-blue)](https://docs.streakjs.com/)
[![license](https://img.shields.io/badge/license-Apache%202.0-green)](./LICENSE)

> This is v5 — the real `streak-forge` name and `bin`. The old v4 package now
> lives alongside it at `packages/streak-forge` under the name
> `streak-forge-legacy` (folder unchanged, only its `package.json` name/bin
> were renamed, to free up `streak-forge` for this package).

---

## What is Streak.js?

Streak.js is a static site generator that pre-renders every page to plain HTML at build time. The only thing delivered to the browser is the generated HTML and a tiny client-side runtime that enables progressive features (lazy-loaded widgets, dynamic components, third-party JS loading) — no framework runtime, no virtual DOM, no hydration.

**v5 splits the v4 pipeline into two packages**: this one (`streak-forge`) covers authoring, the dev server, and pre-build; **[`streak-boot`](https://github.com/streakjs/streakjs/tree/main/packages/streak-boot)** (a separate repo) covers page composition (`build`) and serving (`serve`). A real deploy runs them in genuinely different places — dev locally, build inside an isolated container with no project source tree — so v5 splits along that line where v4 didn't need to.

**What Streak is NOT:**
- No hydration — output is complete static HTML
- No virtual DOM in the browser — DOM mutations use plain JS in `Script` functions
- No CSS-in-JS — styling is collected, purged, and shipped as plain CSS, scoped per widget

---

## Install

```bash
bun add streak-forge streak-boot
```

Both packages are needed for a full local workflow (`streak-forge dev`) or a full pipeline (`streak-forge prebuild` in CI, `streak-boot build && streak-boot serve` wherever the site is actually served).

## CLI

```bash
streak-forge safelist   # write .streak-forge-cache/dynamic-classes.json (run before your own CSS build)
streak-forge prebuild   # TSX->JS conversion + per-widget CSS purge -> .prebuild/
streak-forge dev        # watch + rebuild into .dev/, serve with live-reload
```

Page composition and serving moved to the **`streak-boot`** package:

```bash
streak-boot build       # .prebuild/ -> out/ (HTML fragments, never a combined page)
streak-boot serve       # serve out/ (no live-reload)
```

## Core Concepts

- **`streak.sitemap.json`** — `{ shared?: [...], pages: [{ url, rootLayout, widgets: [...] }] }`. Different shape from v4's array-of-`renderConfig` — see the migration guide if upgrading.
- **Annotation HOCs** (`src/hoc.ts`, exposed as ambient globals via `streak-forge/globals`) — `widget({...})(fn)`, `handler({...})(fn)`, `component({...})(fn)`, `html/head/body/rootLayout({...})(fn)`. A widget's `type` comes from its **filename**, not a threaded field — `HelloNav.tsx` registers as `"HelloNav"` regardless of export name.
- **`@dynamicClasses`** annotation — declares Tailwind-style bracket-syntax classes (`bg-[#123]`) that the CSS-purge scan can't discover by static analysis alone.
- **CSS-Modules-style scoping** — every widget's CSS is purged and prefixed to a short, deterministic per-type code, so two widgets can safely use the same class name.
- **`<Script>`** — `(gDom: Window, options) => void`, serialized via `Function.prototype.toString()` at render time. `options` is required (pass `{}` if unused). See the migration guide for how this differs from v4.

## Output

`.prebuild/` — one folder per widget/handler/component/shell entry (`widgets/<Type>/meta.json` + purged CSS + a bundled, self-contained JS file), plus a top-level `streak-boot.registry.json` marker (filename intentionally unchanged — it's the file-format contract `streak-boot`'s own `registry.ts` reads). Hand this whole directory (zipped, in a real pipeline) to `streak-boot build`.

## Deployment

`streak-boot build`+`serve` (this repo's sibling package) handle turning `.prebuild/` into a servable site. For a real multi-tenant/isolated pipeline, see `apps/build-system` and `apps/serve-worker` in the `streak-boot` repo (Cloudflare Container + Worker, built as a reference implementation — not yet wired to this package by default).

---

## License

Apache-2.0
