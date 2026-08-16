# streak-forge v4.0.0

**streak-forge v4 is a complete rewrite of the framework's internals.** The app-facing contract you already know — `streak.sitemap.json`, layouts, widgets, and the `streak-forge/components` API (`Dynamic`, `Preload`, `Script`, `WidgetPlaceholder`) — is unchanged in shape, but everything underneath it is new: no more chain-of-processor build pipeline, no React dependency, a simpler and fully-accurate client runtime, and two new handler types that let you cut redundant work out of a build and add dynamic routing without leaving the framework's own conventions.

This is a major version for a reason — see **Breaking Changes** below before upgrading.

---

## Highlights

### No more 7-stage pipeline

Earlier versions processed every page through a fixed chain of internal stages (`validateStreakConfig` → `pageDataHandler` → `renderRootLayout` → `renderWidgets` → `pageBuildAndOptimize` → `prepareStyle` → `prepareRawForBuild`). v4 replaces that entirely with a straightforward, direct render path: resolve `Middleware.ts` (if present) → resolve `CommonHandler.ts` (if present) → call the page's data handler → render the layout → render the widgets → collect styles. No processor chain, no stage names to reason about, less indirection end to end.

### Zero React dependency

v4 has its own minimal JSX runtime. There's no `react`/`react-dom` in the dependency tree, no hooks, and nothing hydrates in the browser — TSX is a build-time templating syntax only, exactly as before, just without a framework underneath it.

### `CommonHandler.ts` — shared data, fetched once

A new, optional, auto-discovered handler (`src/handlers/CommonHandler.ts`) for data every page needs (site branding, nav, etc.). It's called **once for an entire `build`** and shared across every page's data handler as `{ common }` — instead of every page's own handler independently re-fetching the same thing. In `dev` it's called fresh on every request, since a live server should never serve stale shared data.

### `Middleware.ts` — dynamic route resolution

A new, optional, auto-discovered handler (`src/handlers/Middleware.ts`) that runs first on every page resolution attempt — every `dev` request, and every page during a `build`. Given `(url, req?)`, it can return a full render config to use instead of whatever `streak.sitemap.json` says for that URL, or `undefined` to fall through to normal resolution. This is what lets a URL that isn't statically listed in the sitemap at all still resolve to a real, fully rendered page.

### Data handlers now receive real context

Handlers are called as `(metadata, { common }) => {...}` — `metadata` is the sitemap entry's own metadata field (previously unused by the handler itself), and `common` is `CommonHandler`'s output. Existing zero-argument handlers keep working unmodified; JavaScript ignores extra call arguments a function doesn't declare.

### Slow-handler visibility

Any handler (a page's own, or `CommonHandler`/`Middleware`) that takes more than 1 second now prints an escalating warning, and more than 2 seconds prints as an error, repeating every 2 seconds until it resolves — so a slow external API call during a build shows up loudly in the log instead of silently stalling everything.

### Per-page build timing, opt-in

`STREAK_DEBUG=true` turns on verbose, per-page timing output for `build`/`dev-build` (`building X`, `X took Yms to render`, overall summary). Off by default — a normal run stays silent except for warnings and real failures.

### A simpler, fully accurate client runtime

The browser-side runtime (`gDom`, passed to every `<Script>` function) is now exactly four methods: `loadPackage`, `loadDynamicComponent`, `addWidgetToBody`, `addResourceToBody` — all doing direct DOM insertion, no Web Worker involved. Lazy widgets ship a lightweight skeleton placeholder in the initial HTML; their real content and scripts are fetched and swapped in after page load via the same mechanism `Dynamic` uses.

---

## Breaking Changes

- **Build output format.** `streak-forge build` now writes `out/<url>/<version>/raw-content.json` per page — an intermediate rendered snapshot, not a final `index.html`. Publishing that snapshot to a live site is a separate step (handled by Nexus for hosted projects).
- **Package import path.** Components import from `"streak-forge/components"`. If you're upgrading from a version that used `"streak/components"`, update your imports.
- **Client runtime surface reduced to what's real.** `onVisible`, `debounce`, `geById`, `stall`, `setCookie`/`getCookie`, and `window.ftr` are gone — they were never load-bearing for the actual rendering model and added surface area that wasn't reliably implemented. If you were using any of them from a `<Script>` body, replace with a plain `IntersectionObserver`, your own debounce, `document.cookie`, etc. — write it inline, or load it via `loadPackage`.
- **No Web Worker asset pipeline.** `loadPackage()` now does a direct `<script>`/`<link>` tag insertion. Functionally the same outcome (a promise that resolves once the asset is loaded), just simpler and without the extra thread hop.
- **`streak.sitemap.json` schema is unchanged** — `renderId`/`metadata`/`dataHandler`/`rootLayout`/`widgets[]`/`version` all mean the same thing. No sitemap changes needed to upgrade.

---

## CLI

```bash
streak-forge dev         # local dev server, hot reload, live per-request rendering
streak-forge validate    # check the whole project for <Script> closure leaks
streak-forge pre-build   # optional: bundle source into a cache for faster subsequent builds
streak-forge build       # render every sitemap page, write raw-content.json per page
```

---

## Internal integration

A `streak-forge/core` entry point (`render()`) exists for programmatic integration by internal build tooling (the system that turns a `build` snapshot into a hosted site). It's not a documented public API for application code — if you're building a Streak.js site, you won't need it.

---

## Upgrading from v3.x

1. Update imports: `streak/components` → `streak-forge/components`.
2. If any `<Script>` body used `onVisible`/`debounce`/`stall`/`setCookie`/`getCookie`/`window.ftr`, replace it with an inline equivalent (see Breaking Changes above).
3. If anything downstream of your build reads `out/`, update it for the new `out/<url>/<version>/raw-content.json` shape instead of `out/<renderId>/index.html`.
4. Nothing else changes — `streak.sitemap.json`, layouts, widgets, and data handlers all keep working as they did, with `metadata`/`common` available as new (optional) arguments to your handlers going forward.

Full documentation: **[docs.streakjs.com](https://docs.streakjs.com/)**
