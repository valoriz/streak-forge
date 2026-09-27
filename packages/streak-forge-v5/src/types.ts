/**
 * streak-forge core types.
 *
 * Naming: "widget" = a stateless render unit (matches streak-forge's own term).
 * "handler" = an async data-fetch function bound to a widget or a page.
 */

export type WidgetKind = "static" | "handler";

export interface WidgetMeta {
  /** Exported function/const name in the source file. */
  exportName: string;
  /** File path, relative to project root. */
  filePath: string;
  /** Widget type name — must match the .tsx filename by convention (PageHead, HelloBanner, ...). */
  type: string;
  /** "static" = props-only, no handler, cache key = type+props hash.
   *  "handler" = bound via widget({ handler: "..." }), cache key = id+data hash. */
  kind: WidgetKind;
  /** Name of the bound handler export, if any (same file or imported). */
  handlerName?: string;
  /** Flat list of literal classnames that must survive CSS purge for this widget,
   *  because they're only assembled at runtime (e.g. `bg-${color}-500` become
   *  `bg-red-500`, `bg-blue-500`, ... declared here up front). Grouped arrays are
   *  accepted for documentation purposes but flattened before purge. */
  dynamicClasses: string[];
  /** Raw dynamicClasses groups as declared (kept for tooling/docs, e.g. lint diffing). */
  dynamicClassGroups: string[][];
  /** Hash of (source text + dynamicClasses) — the cache key for widget-level CSS gen. */
  sourceHash: string;
}

export interface HandlerMeta {
  exportName: string;
  filePath: string;
  /** "widget" handlers are bound to one widget type; "common" runs once per build/request
   *  and its result is passed to every other handler as `common`. */
  scope: "widget" | "common" | "middleware";
}

/**
 * A smaller, presentational piece a widget composes internally (a Button,
 * a Card, ...) — plain TSX, importable/renderable inside a widget with no
 * extra wiring (the JSX runtime already recurses into nested function
 * components). `component()` only exists so it gets the SAME build-time
 * treatment a widget gets: its own registry entry + its own CSS-purge
 * output, in its own `components/<Type>/` folder — not because rendering
 * needs it. No `kind`/`handlerName`: components are props-only, data comes
 * from whichever widget renders them, they don't bind their own handler.
 */
export interface ComponentMeta {
  exportName: string;
  filePath: string;
  /** Component type name — must match the .tsx filename by convention. */
  type: string;
  dynamicClasses: string[];
  dynamicClassGroups: string[][];
  sourceHash: string;
}

/**
 * Doc-shell entry — `html()`, `head()`, or `body()` (see hoc.ts): sets
 * `<html>` attrs (lang, ...), `<head>` content (title/meta/link, real JSX),
 * or `<body>` classes/attrs. One shared shape for all three since they're
 * structurally identical (props-only, no handler, may declare
 * dynamicClasses same as a widget/component) — which doc-shell role a given
 * entry plays is which HOC name matched it, not a field on this type.
 */
export interface ShellMeta {
  exportName: string;
  filePath: string;
  /** Inferred from filename, same convention as widget/component `type`. */
  type: string;
  dynamicClasses: string[];
  dynamicClassGroups: string[][];
  sourceHash: string;
}

export interface Registry {
  /** Schema/version marker so a stale registry.json fails loudly instead of silently. */
  version: 1;
  generatedAt: string;
  widgets: Record<string, WidgetMeta>; // keyed by widget `type`
  handlers: Record<string, HandlerMeta>; // keyed by exportName
  components: Record<string, ComponentMeta>; // keyed by component `type`
  html: Record<string, ShellMeta>;
  head: Record<string, ShellMeta>;
  body: Record<string, ShellMeta>;
  /** `rootLayout()` entries — see hoc.ts. The body content containing
   *  `<WidgetPlaceholder>` markers, resolved per-page by page-build.ts. */
  rootLayout: Record<string, ShellMeta>;
  /** file path -> content hash, used for incremental rescans in dev mode. */
  fileHashes: Record<string, string>;
}

export interface CssGenResult {
  widgetType: string;
  /** Content-hashed path, relative to outDir — e.g.
   *  "widgets/HelloBanner/HelloBanner.a1b2c3.css" (or
   *  "components/Button/Button.a1b2c3.css") — same folder the
   *  widget/component's registry meta.json lives in. join(outDir, fileName)
   *  to locate it on disk, or use it directly as a <link href>. */
  fileName: string;
  css: string;
  fromCache: boolean;
}

export interface BundleGenResult {
  /** widget.type / component.type / handler.exportName. */
  name: string;
  /** Content-hashed path, relative to outDir — e.g.
   *  "widgets/ProductCard/ProductCard.f0e470.js" — same folder that
   *  entry's meta.json (and CSS, for widgets/components) lives in. */
  fileName: string;
  fromCache: boolean;
}

export interface FragmentCacheKey {
  widgetType: string;
  /** For static widgets: hash(props). For handler widgets: hash(handler output). */
  variantHash: string;
}

export interface RenderedFragment {
  html: string;
  cssFile: string | null;
  cachedAt: number;
}

/** Meta object passed to the global `widget(meta)` HOC — see hoc.ts. */
export interface WidgetHocMeta {
  /** Name of the bound handler export, if this widget's data comes from one. */
  handler?: string;
  /** CSS purge safelist — literal classnames only assembled at runtime
   *  (e.g. `bg-${color}-500`), grouped for documentation, flattened before purge. */
  dynamicClasses?: string[][];
}

/** Meta object passed to the global `handler(meta)` HOC — see hoc.ts. */
export interface HandlerHocMeta {
  /** "widget" handlers are bound to one widget type; "common" runs once per build/request
   *  and its result is passed to every other handler as `common`. */
  scope?: "widget" | "common" | "middleware";
}

/** Meta object passed to the global `component(meta)` HOC — see hoc.ts. */
export interface ComponentHocMeta {
  /** CSS purge safelist — same rules as widget({ dynamicClasses }). */
  dynamicClasses?: string[][];
}

/** Meta object passed to the global `html`/`head`/`body`/`rootLayout` HOCs — see hoc.ts. */
export interface ShellHocMeta {
  /** CSS purge safelist — same rules as widget({ dynamicClasses }). Mainly
   *  useful on `body()` (e.g. a runtime-assembled `bg-${theme}-50`). */
  dynamicClasses?: string[][];
}

// ---------------------------------------------------------------------------
// Page build (page-build.ts): streak.sitemap.json -> per-page manifests,
// with an explicit shared-vs-page-specific widget split.
// ---------------------------------------------------------------------------

/** A common component USED BY a widget — the widget's own analogue of a
 *  page's `SitemapWidgetEntry`, one level down. Declared inside a widget's
 *  own sitemap entry (`SharedWidgetEntry.components` /
 *  `SitemapWidgetEntry`'s inline-widget variant's `components`), matched
 *  against a `<ComponentPlaceholder id type/>` the widget's own render
 *  output contains (see jsx.ts). Components are strictly one level deep —
 *  a component itself never declares its own `components[]`, and
 *  page-build.ts's buildPages throws if a component's own render output
 *  contains a `ComponentPlaceholder`. Two different widgets using the same
 *  component `type` each get their own separately-built instance — no
 *  `ref`/sharing concept at this level, unlike widgets. */
export interface SitemapComponentEntry {
  /** This widget instance's own id for the slot — matches a
   *  <ComponentPlaceholder id=.../> in that widget's render output. */
  id: string;
  /** Must match a registered component's `type`. */
  type: string;
  props?: Record<string, unknown>;
  /** Same meaning as SitemapWidgetEntry's own `loadingStrategy` — leaves the
   *  placeholder marker unresolved in the widget's composed HTML instead
   *  of splicing the component's content in at request time. */
  loadingStrategy?: "lazy";
}

/** A widget built ONCE (with its own fixed props) and reused across every
 *  page that references it by `ref` — a shared/global nav, a footer, ... */
export interface SharedWidgetEntry {
  /** Referenced from a page's widgets[] as `{ ref: id }`. */
  id: string;
  /** Must match a registered widget's `type`. */
  type: string;
  props?: Record<string, unknown>;
  /** Common components THIS shared widget instance uses — see
   *  SitemapComponentEntry. Built once, alongside the shared widget itself. */
  components?: SitemapComponentEntry[];
}

/** One widget slot on a page — either a pointer to a `shared[]` entry
 *  (`ref`), or an inline, page-specific instance. `loadingStrategy: "lazy"`
 *  (default: absent = eager) leaves this slot's placeholder marker in the
 *  shipped HTML instead of resolving it server-side, picked up by the
 *  client-side lazy-widget runtime instead (cli/app-script.ts) — same
 *  field name real streak-forge uses.
 *
 *  A `ref` entry's `id` is optional — it defaults to the `ref` value
 *  itself, so a page using a shared/common widget as-is doesn't need to
 *  repeat its id. An inline entry has no `props`: every inline widget on a
 *  page receives that page's own `metadata` (see SitemapPageEntry) as its
 *  `props.data`, identically — data that should differ per instance
 *  instead of per page belongs on a shared[] entry's own `props`, or is
 *  fetched by the widget's own code via an awaited `handler()` call. */
export type SitemapWidgetEntry =
  | { id?: string; ref: string; loadingStrategy?: "lazy" }
  | { id: string; type: string; loadingStrategy?: "lazy"; components?: SitemapComponentEntry[] };

export interface SitemapPageEntry {
  url: string;
  /** Which `rootLayout()` entry's `type` to use for this page. Defaults to
   *  the only one found if the project has just one — required if it has more. */
  rootLayout?: string;
  /** Arbitrary, page-level data — handed to every INLINE widget on this
   *  page as its `props.data`, identically (not type-keyed like real
   *  streak-forge's per-page dataHandler — streak-forge has no page-level
   *  handler concept, only widget-level ones, see hoc.ts's `handler()`). */
  metadata?: Record<string, unknown>;
  widgets: SitemapWidgetEntry[];
}

/** streak-forge's own sitemap shape — read from a `streak.sitemap.json`-named
 *  file for filename familiarity with streak-forge's convention, but a
 *  richer schema (the `shared[]` section, widget `ref`s) real streak-forge's
 *  own sitemap parser doesn't understand — not meant to be a drop-in replacement. */
export interface StreakBootSitemap {
  shared?: SharedWidgetEntry[];
  pages: SitemapPageEntry[];
}

export interface PageWidgetManifestEntry {
  /** This page's own instance id (matches a <WidgetPlaceholder id=.../> in the rootLayout). */
  id: string;
  type: string;
  /** true = built once under shared/<sharedId>/, reused as-is; false = built
   *  fresh under this page's own folder, just for this page. */
  shared: boolean;
  /** Path relative to outDir to this instance's own folder (meta.json + content.json). */
  path: string;
  /** true = this slot's placeholder marker is left in the composed HTML
   *  instead of being replaced with the widget's real content — see
   *  SitemapWidgetEntry's own `loadingStrategy` doc. */
  lazy: boolean;
  /** This widget type's own CSS file, relative to outDir — null when it
   *  has none (no classNames of its own, or every one purged/deduped away
   *  against the common bundle; see css-purge.ts's generateWidgetCss,
   *  which now skips writing a file in that case). Resolved once here at
   *  build time (the file already exists on disk by the time buildPages
   *  runs — CSS generation is a prebuild step) so composeLazyWidgetFragment
   *  never has to probe the filesystem for it at request time. */
  cssHref: string | null;
}

/** One component slot inside a WIDGET instance — the widget-level
 *  analogue of PageWidgetManifestEntry. No `shared` flag: components are
 *  always built separately per widget usage, never deduped/reused across
 *  widget instances even when the same component `type` repeats. */
export interface WidgetComponentManifestEntry {
  id: string;
  type: string;
  /** Path relative to outDir to this component usage's own folder
   *  (content.json/index.html/script.js), nested under the widget
   *  instance that uses it — e.g. "widgets/ProductCard/index/card-1/components/btn-1". */
  path: string;
  lazy: boolean;
}

/** Persisted alongside a widget instance's own content.json/index.html (as
 *  that instance's own meta.json) WHEN it uses at least one common
 *  component — the widget-level analogue of PageManifest. Read by
 *  composePageFromFiles/composeScriptBundle at request time to resolve
 *  that widget's own `<ComponentPlaceholder>` markers; never written by
 *  anything else, and absent entirely for a widget with no components. */
export interface WidgetInstanceManifest {
  components: WidgetComponentManifestEntry[];
}

export interface PageManifest {
  url: string;
  rootLayoutType: string;
  widgets: PageWidgetManifestEntry[];
  /** true if any non-lazy widget on this page collected a `<Script>`
   *  block — tells the composer whether to emit a <script src> tag at
   *  all. The bundle itself is never persisted: each widget instance
   *  writes its own tiny script.js fragment (see page-build.ts's
   *  writeWidgetFiles), and composeScriptBundle joins the non-lazy ones
   *  fresh, in memory, per request — cheap, since it's just string
   *  concatenation of small self-invoking functions. */
  hasScript: boolean;
  /** Persisted copy of `BuildPagesOptions.inlineCss` — tells the
   *  request-time composer whether this page's head/index.html already
   *  has its CSS `<link>`s baked in (false/dev) or needs the combined
   *  inline `<style>` computed fresh per request (true/build — see
   *  page-build.ts's collectInlineCss). Read straight off the manifest so
   *  composePageFromFiles doesn't need a second, out-of-band signal for a
   *  choice buildPages already made once. */
  inlineCss: boolean;
  /** Persisted copy of `BuildPagesOptions.spa` — tells composePageFromFiles
   *  whether to also link `__streak/spa-router.js` (client-side navigation,
   *  index.json prefetch). Opt-in, default false — the one thing that
   *  makes a site behave as an SPA at all; see cli/spa-router.ts's own
   *  doc comment. */
  spa: boolean;
  /** Every eager/static CSS file this page needs, already resolved,
   *  deduped and ordered — common bundle, then the shell's own
   *  (html/head/body/rootLayout) CSS, then each non-lazy widget's own CSS
   *  and its own non-lazy components' CSS. Only populated when `inlineCss`
   *  is true (build/serve); empty for dev, which links per-file `<link>`s
   *  instead (see writeShellFiles). Computed once here at build time (see
   *  collectCssHrefs) specifically so the request-time composer
   *  (collectInlineCss) never has to scan outDir's directories itself —
   *  it just reads each path in this list straight off disk. */
  cssHrefs: string[];
  /** A fingerprint of everything THIS page currently serves — its own
   *  shell fragments (html/head/body/rootLayout) plus every one of its
   *  widgets' own already-persisted content.json — recomputed on every
   *  buildPages run, so a page-specific widget's content change naturally
   *  changes it (that widget only lives inside this one page's own
   *  build). Stamped as `?v=` onto every asset URL this page's own
   *  request-time composition stamps (see resolvePageParts), build/serve
   *  only, so a CDN/browser can cache that exact URL `immutable` — a
   *  content change here means a NEW `?v=` on the next request, not the
   *  same URL going stale.
   *
   *  Deliberately does NOT yet account for a SHARED widget rebuilt in
   *  isolation from a page that references it via `ref` — the "if a
   *  requested page depends on a widget whose own version changed, fold
   *  that into the page's effective key too" logic still needs a small
   *  central widget-version map the server reads per request (not
   *  implemented yet — flagged for a follow-up). This field alone is
   *  correct today for a full rebuild (which is when it's produced) and
   *  for any PAGE-SPECIFIC widget change either way. */
  version: string;
}

/** One widget instance's real rendered content, persisted alongside its
 *  meta.json/index.html/script.js — self-sufficient enough for a client to
 *  fetch it DIRECTLY, by its own static outDir-relative path, and render
 *  it with no other request needed first (see cli/root-script.ts's
 *  loadLazyWidget, and WIDGET_SRC_ATTR's own doc comment in page-build.ts
 *  for how a lazy widget's marker gets pointed at this file). `html` here
 *  is already FULLY resolved — unlike index.html (which keeps any non-lazy
 *  component's own placeholder marker unresolved, for composePageFromFiles'
 *  own request-time splice), this has that splicing already done, since
 *  nothing else touches this file's content afterward. */
export interface WidgetContent {
  html: string;
  /** This instance's own CSS file's public href, or null if it has none —
   *  pushed as a real `<link>` (never inlined) so a strict CSP's
   *  `style-src` stays happy even for lazily-loaded content. */
  cssHref: string | null;
  /** This instance's own script.js PLUS its non-lazy components' script.js,
   *  already joined into one file (WIDGET_BUNDLE_FILE) — its public href,
   *  or null if neither the widget nor any non-lazy component has one.
   *  Loaded as a real `<script src>`, same CSP reasoning as cssHref. */
  scriptHref: string | null;
}
