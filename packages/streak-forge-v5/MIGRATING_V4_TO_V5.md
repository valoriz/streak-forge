# Migrating from streak-forge v4 to v5

v5 is not a drop-in upgrade — it's a from-scratch rewrite of the same ideas, split into two packages along a line v4 never had (dev/prebuild vs. build/serve). This covers real API and behavioral differences, not just renamed commands. If you maintain a v4 project, read this in full before starting — several things below have **no migration path**, only a rewrite path.

## 1. Package and dependency changes

**`package.json`**:
```diff
- "streak-forge": "^4.1.18"
+ "streak-forge": "^5.0.0"
+ "streak-boot": "^0.1.0"
```
Two packages now, likely from two different sources (`streak-forge` stays on its usual registry; `streak-boot` is a separate, currently-private package — check with your team for how it's distributed until that's settled).

**`tsconfig.json`**:
```diff
  "types": [
-   "streak-forge/globals"
+   "streak-forge/globals"
  ]
```
The `types` entry name is unchanged (still points at `streak-forge`) — no edit needed there. What *is* new: `streak-boot` has **no** `./globals` export at all. If your build tooling or CI ever added `streak-boot/globals` (or an equivalent) to `types`, remove it — authoring-time globals only ever come from `streak-forge`.

## 2. CLI command mapping

| v4 command | v5 equivalent | Package |
|---|---|---|
| `streak-forge dev` | `streak-forge dev` | `streak-forge` |
| `streak-forge validate` | **no equivalent** — real gap, not yet ported | — |
| `streak-forge pre-build` | `streak-forge safelist && ... && streak-forge prebuild` (safelist is new — see below) | `streak-forge` |
| `streak-forge build` | `streak-boot build` | `streak-boot` |
| *(none)* | `streak-boot serve` — v4 always deployed via the private "Nexus" system, no local serve command existed | `streak-boot` |

The `safelist` step is new in v5: it writes `.streak-forge-cache/dynamic-classes.json` from `@dynamicClasses`-annotated bracket-syntax classes (`bg-[#123456]`), for your own CSS build to pick up before `prebuild` purges. v4 didn't need this — its CSS pipeline differs (see §3).

## 3. Output format — not compatible, no migration path

v4's intermediate artifact is `out/<url>/<version>/raw-content.json` (one JSON snapshot per page, written by Stage 1, read by `streak-distiller`'s own Stage 2). v5's is `.prebuild/<kind>/<Type>/` — one folder per widget/handler/component/shell **entry** (not per page), each with its own `meta.json` + purged CSS + bundled JS, plus a top-level `streak-boot.registry.json` marker. These are different data models, not different serializations of the same thing. There is no converter — a v4 project's existing build output/cache is discarded, not migrated.

## 4. Sitemap format — different schema, not compatible

**v4**: a JSON *array* of `{ url, renderConfig: { renderId, rootLayout, widgets: [...], dataHandler? } }`.

**v5**: a JSON *object*: `{ shared？: SharedWidgetEntry[], pages: SitemapPageEntry[] }`. No `renderId`. No page-level `dataHandler`. A new `shared[]`/`{ ref }` mechanism v4 has no equivalent of (a widget built once, referenced by multiple pages via `{ "ref": "SharedWidgetId" }` instead of rebuilt per page).

Hand-write a new `streak.sitemap.json` — there's no automatic conversion, and the shapes don't map field-for-field.

## 5. No `CommonHandler`/`Middleware` equivalent — real gap

v4 reserves two filenames with special meaning: `CommonHandler.ts` (data fetched once per build/request, passed as `common` to every other handler) and `Middleware.ts` (runs first on every URL resolution, can override the render config for a URL not in the sitemap — enabling dynamic routes).

v5's `HandlerMeta.scope` field accepts `"common"` or `"middleware"` as a label, but **nothing in the current codebase reads or dispatches on it** (confirmed by grep across `registry.ts`/`page-build.ts`/`render.ts`) — it's inert metadata, not a working feature yet. If your v4 project relies on either mechanism, there is no v5 equivalent to migrate to today. Flag this to whoever owns the v5 roadmap before committing to the migration.

## 6. `<Script>` shape differs

**v4**: children are serialized at **build time** (a Bun-plugin source transform, survives minification of the widget's own bundle). Signature `(gDom: GDom, options?: any) => void` — `options` is *optional*, `gDom` is a rich `GDom` type (`loadPackage`, `loadDynamicComponent`, `onVisible`, `geById`, `debounce`, `stall`, `setCookie`/`getCookie`, `sf:pageload`/`sf:pageunload` events), plus a CSP `nonce` prop.

**v5**: children are serialized at **render time** via `Function.prototype.toString()` (does *not* survive bundle minification, by the source's own comment). Signature `(gDom: Window, options: Record<string, unknown>) => void` — `options` is **required** (pass `{}` if unused), `gDom` is plain `Window` (no `GDom` alias — the equivalent helpers exist at runtime via the generated `root.js`/`app.js` scripts, just without the TypeScript ergonomics), and there is **no `nonce` prop**.

```diff
- <Script id="x">{(gDom, options) => { ... }}</Script>   // v4, options optional
+ <Script id="x" options={{}}>{(gDom, options) => { ... }}</Script>   // v5, options required
```

## 7. No `<Preload>` component — real gap

v4 has one (`streak-forge/components`'s `Preload`, for resource preload hints). v5 has no equivalent. If your widgets use it, there's nothing to migrate to yet.

## 8. Named export + filename-based type (v5) vs. default export + sitemap `type` field (v4)

```diff
- export default function HelloNav(props) { ... }   // v4-style, type comes from sitemap
+ export const HelloNav = widget({})((props) => { ... });   // v5, type comes from the FILENAME
```
The file must be named `HelloNav.tsx` in v5 — the registry infers `type` from the filename, not from any export name or sitemap field. A v4 project with default exports and filenames that don't match their sitemap `type` needs both renamed.

## 9. What does NOT change

- The overall philosophy: pre-render everything at build time, ship plain HTML + a tiny client runtime, no framework runtime, no hydration.
- `.dev`/`.prebuild`/`out` as the general staged-output naming idea (the *shape* inside each changed, per §3, but the three-stage concept is the same).
- `Dynamic`/`WidgetPlaceholder` component shapes are structurally compatible (same props).

## Real-world reference

`examples/hello-streak-app` in the `streak-boot` repo (this rewrite's own reference app) documents the same differences from the *app author's* side, with concrete code examples for the `<Script>`/handler/shared-widget patterns above — see that project's own `CLAUDE.md`, "What's different from streak-forge" section, if you want to see a full working app built against these v5 APIs rather than just the abstract diff.
