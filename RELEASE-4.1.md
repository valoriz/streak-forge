# streak-forge 4.1

streak-forge 4.1 builds on the v4 rewrite with a per-site script optimization that cuts a large chunk out of production build time, a stable `<Script>` runtime surface that behaves identically in `dev` and in a distilled production build, and a handful of correctness fixes for real projects.

If you are coming from v3.x, read [The v4 rewrite, recapped](#the-v4-rewrite-recapped) and [Breaking changes](#breaking-changes) first — v4 changed the build output format and the client runtime surface. If you are already on v4.0.x, 4.1 is a drop-in upgrade: no config, sitemap, handler, or import changes.

What's in this release:

- [**Build-time script minification cache**](#build-time-script-minification-cache) — each unique widget script is minified once per site build instead of once per page
- [**`<Script>` window utilities, guaranteed in both modes**](#script-window-utilities-guaranteed-in-both-modes) — `geById`, `debounce`, `onVisible`, `stall`, `setCookie`, `getCookie`
- [**Deterministic script execution order**](#deterministic-script-execution-order) — the client runtime is always defined before any widget script runs
- [**`<Script options>` serialization check**](#script-options-serialization-check) — a clear error instead of a crash deep inside the framework
- [**`streak-forge/core` additions**](#streak-forgecore-additions) — `getCommonHandlerData` and `ProgressMetaInfo` for external build tooling
- [**`node_modules` transform scoping fix**](#node_modules-transform-scoping-fix) — third-party CJS packages are no longer run through the widget transform

---

## Build-time script minification cache

Every `<Script>` component compiles to a self-invoking function wrapper embedded as an inline `<script>` in the widget's HTML:

```js
(((gDom, options) => {
  /* the widget's authored JS — identical for every page that renders this widget */
})(window, { "accentColor": "#818cf8", "animationMs": 700 }));
```

The function body is byte-identical on every page that uses the widget; only the `options` data differs. Previously the downstream finalize step (Nexus) minified the entire string — body included — on every page. Profiling showed this was its single largest per-page cost (~400ms of ~600–1100ms). Because that step runs as isolated per-page invocations in production, it has no shared process in which to cache the result.

streak-forge renders every page of a site in one process, so it is the right place to deduplicate. 4.1 adds a module-level cache keyed by the widget's authored function source:

- On a cache miss, the wrapper template is minified once (via `terser`, now a direct dependency) and stored.
- The real per-page `options` are **never baked into the cached template**. They ship as a separate `data-sf-opts` attribute on the `<script>` tag, JSON-stringified through the framework's existing attribute escaping. The template carries a bare `__SF_OPTS__` placeholder where the data goes — a free identifier that survives minification untouched.
- If minification throws, streak-forge falls back to the unminified wrapper (still correct, just larger) and logs a warning rather than failing the build.

Net effect: a widget used on 50 pages is minified once per build, not 50 times. In the full pipeline the finalize step's per-page cost dropped from ~400–420ms to ~24–28ms. Content built by older versions (no `data-sf-opts`) automatically falls back to the previous full-minify path, so nothing breaks before a rebuild.

## `<Script>` window utilities, guaranteed in both modes

A widget's `<Script>` body can't tell whether it is running under `streak-forge dev` or a distilled production build, so any helper it calls has to exist in both. 4.1 defines these on `window` in the dev/preview client runtime, mirroring what the production distiller injects:

| Helper | Behavior |
| --- | --- |
| `geById(id)` | `document.getElementById` bound to `document` |
| `debounce(fn, ms)` | trailing-edge debounce wrapper |
| `onVisible(el, cb, { onlyOnce? }, meta?)` | `IntersectionObserver` at threshold 0.1 |
| `stall(ms)` | `Promise` that resolves after `ms` |
| `setCookie(name, value, days?)` | writes `document.cookie` with `path=/` |
| `getCookie(name)` | reads a cookie value, or `null` |

This reverses the v4.0.0 removal of these helpers — they are supported again, with a single consistent implementation across both modes. Widget-loading and hydration (`addWidgetToBody`, dynamic component loading, the SPA router) keep their own dev-appropriate implementations that fetch from the dev content endpoint. `window.ftr` remains removed.

## Deterministic script execution order

Plain inline `<script>` tags run in document order. If a widget's trailing script called `loadDynamicComponent`, `addWidgetToBody`, `geById`, or another runtime helper at its top level, and that script happened to be emitted before the core runtime, it hit an undefined function.

4.1 always emits the core client runtime **before** any widget trailing scripts, so every runtime helper is defined by the time the first widget script executes.

## `<Script options>` serialization check

`JSON.stringify` returns `undefined` — not a string — for a function, a symbol, or an object whose `toJSON()` returns `undefined`. Passing such a value in `options` previously surfaced as `"undefined is not an object"` deep inside a framework file, with nothing pointing back at the widget.

`<Script>` now throws a named error instead:

```
<Script id="hero">'s "options" prop must be JSON-serializable — it contains a
value (e.g. a function or symbol) that JSON.stringify can't represent.
```

## `streak-forge/core` additions

The `streak-forge/core` entry point (programmatic `render()` for internal build tooling — not a public API for application code) gains two re-exports:

- `getCommonHandlerData` — lets an external build system call `CommonHandler.ts` once per batch and pass its output into every `render()` call via `options.common`, avoiding a redundant `CommonHandler` call per page.
- `ProgressMetaInfo` — the type behind the `onProgress` callback's `metaInfo`, so external callers can type their own callback precisely.

## `node_modules` transform scoping fix

The widget/handler/layout transform (closure-leak check + script transform) was matching every `.ts/.tsx/.js/.jsx` file the process imported, including third-party package internals. Forcing a CJS bundle through it corrupted Bun's CJS/ESM interop detection — `rxjs`'s CJS entrypoint, for example, started throwing `Export named 'X' not found`.

The transform's file filter now excludes anything under `node_modules`. Only the consuming app's own source goes through it.

---

## The v4 rewrite, recapped

For anyone upgrading straight from v3.x, this is what v4 changed. The app-facing contract — `streak.sitemap.json`, layouts, widgets, and the `streak-forge/components` API (`Dynamic`, `Preload`, `Script`, `WidgetPlaceholder`) — is unchanged in shape. Everything underneath it was replaced.

### No more 7-stage pipeline

v3 processed every page through a fixed chain of internal stages (`validateStreakConfig` → `pageDataHandler` → `renderRootLayout` → `renderWidgets` → `pageBuildAndOptimize` → `prepareStyle` → `prepareRawForBuild`). v4 uses a direct render path: resolve `Middleware.ts` (if present) → resolve `CommonHandler.ts` (if present) → call the page's data handler → render the layout → render the widgets → collect styles. No processor chain, no stage names.

### Zero React dependency

v4 has its own minimal JSX runtime. No `react`/`react-dom` in the dependency tree, no hooks, nothing hydrates in the browser. TSX is build-time templating syntax only.

### `CommonHandler.ts` — shared data, fetched once

An optional, auto-discovered handler (`src/handlers/CommonHandler.ts`) for data every page needs (branding, nav). Called **once per `build`** and shared with every page's data handler as `{ common }`. In `dev` it runs fresh on every request so the server never serves stale shared data.

### `Middleware.ts` — dynamic route resolution

An optional, auto-discovered handler (`src/handlers/Middleware.ts`) that runs first on every page resolution — every `dev` request and every page in a `build`. Given `(url, req?)` it can return a full render config to use instead of what `streak.sitemap.json` says, or `undefined` to fall through. This is what lets a URL that isn't listed in the sitemap resolve to a fully rendered page.

### Data handlers receive real context

Handlers are called as `(metadata, { common }) => {...}`. Existing zero-argument handlers keep working unchanged — JavaScript ignores extra arguments a function doesn't declare.

### Handler timing and visibility

- Any handler (page, `CommonHandler`, or `Middleware`) taking more than 1s prints an escalating warning; more than 2s prints as an error, repeating every 2s until it resolves.
- `STREAK_DEBUG=true` turns on per-page timing output for `build`/`dev-build`. Off by default.

### A smaller client runtime

`gDom`, passed to every `<Script>` function, is four methods: `loadPackage`, `loadDynamicComponent`, `addWidgetToBody`, `addResourceToBody` — all direct DOM insertion, no Web Worker. Lazy widgets ship a skeleton placeholder in the initial HTML; their real content and scripts are fetched and swapped in after load.

---

## Breaking changes

These landed in v4.0.0 and still apply. There are no new breaking changes in 4.1.

- **Build output format.** `streak-forge build` writes `out/<url>/<version>/raw-content.json` per page — an intermediate rendered snapshot, not a final `index.html`. Publishing that snapshot to a live site is a separate step (Nexus, for hosted projects).
- **Package import path.** Components import from `"streak-forge/components"`. If you used `"streak/components"`, update your imports.
- **Client runtime surface.** `window.ftr` is gone. `onVisible`, `debounce`, `geById`, `stall`, `setCookie`, `getCookie` were removed in 4.0.0 and **restored in 4.1** — if you are going straight from v3 to 4.1 they are available; if you are briefly on 4.0.x they are not.
- **No Web Worker asset pipeline.** `loadPackage()` does direct `<script>`/`<link>` insertion. Same outcome (a promise that resolves when the asset loads), without the thread hop.
- **`streak.sitemap.json` schema is unchanged** — `renderId` / `metadata` / `dataHandler` / `rootLayout` / `widgets[]` / `version` all mean the same thing. No sitemap changes needed to upgrade.
- **`terser` is now a direct dependency** (BSD-2-Clause). Installed automatically; no action needed.
- **`<script>` tags now carry a `data-sf-opts` attribute.** If anything downstream parses rendered widget HTML, it should preserve this attribute and the `__SF_OPTS__` placeholder.

---

## CLI

```bash
streak-forge dev         # local dev server, hot reload, live per-request rendering
streak-forge validate    # check the whole project for <Script> closure leaks
streak-forge pre-build   # optional: bundle source into a cache for faster builds
streak-forge build       # render every sitemap page, write raw-content.json per page
```

---

## Upgrading

### From 4.0.x

Drop-in. Update the dependency and rebuild:

```bash
bun add streak-forge@latest
streak-forge build
```

The first rebuild is what puts `data-sf-opts` into your output and unlocks the faster finalize path downstream.

### From 3.x

1. Update imports: `streak/components` → `streak-forge/components`.
2. `onVisible` / `debounce` / `geById` / `stall` / `setCookie` / `getCookie` still work in 4.1. Replace any use of `window.ftr` with an inline equivalent.
3. If anything downstream of your build reads `out/`, update it for `out/<url>/<version>/raw-content.json` instead of `out/<renderId>/index.html`.
4. Nothing else changes — `streak.sitemap.json`, layouts, widgets, and data handlers keep working, with `metadata` / `common` available as new optional handler arguments.

Full documentation: **[docs.streakjs.com](https://docs.streakjs.com/)**
