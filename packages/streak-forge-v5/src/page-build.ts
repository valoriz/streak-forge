import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, statSync, rmSync } from "node:fs";
import { join, basename } from "node:path";
import {
  renderToString,
  resolvePlaceholders,
  WidgetPlaceholder,
  ComponentPlaceholder,
  Dynamic,
  isKind,
  renderAttrs,
  collectScripts,
  type VNodeChild,
  type CollectedScript,
  type PlaceholderMarker,
  type DynamicProps,
} from "./jsx.js";
import { collectGlobalClasses, prefixHtmlClasses, shortScopePrefix } from "./css-purge.js";
import { hashOf } from "./hash.js";
import { minifyHtml, minifyJsFiles, findFilesByBasename } from "./minify.js";
import { ROOT_SCRIPT_JS } from "./cli/root-script.js";
import { APP_SCRIPT_JS } from "./cli/app-script.js";
import { ASSET_WORKER_JS } from "./cli/asset-worker.js";
import { SPA_ROUTER_JS } from "./cli/spa-router.js";
import type {
  Registry,
  StreakBootSitemap,
  SitemapPageEntry,
  SitemapComponentEntry,
  PageManifest,
  PageWidgetManifestEntry,
  WidgetComponentManifestEntry,
  WidgetInstanceManifest,
  WidgetContent,
  ShellMeta,
  WidgetMeta,
  ComponentMeta,
} from "./types.js";

/**
 * Page build: streak.sitemap.json -> per-page manifest + a set of PERSISTED
 * HTML FRAGMENT FILES, written to the real `out/` directory (NOT
 * `.prebuild/` — that stays TSX->JS + CSS-purge only, see build.ts) — one
 * fragment per layer:
 *
 *   html/<ShellType>/index.html    <html {attrs}><head></head><body></body></html>
 *   head/<ShellType>/index.html    <head>{content}{css links}</head>
 *   pages/<url>/head.html          same shape, per page — only for a page
 *                                    with `metadata`, rendered with
 *                                    `{ data: metadata }` (per-page SEO)
 *   body/<ShellType>/index.html    <body {attrs}>{rootLayout content, with
 *                                    <div data-widget-placeholder=id .../> MARKERS
 *                                    in place of each widget, unresolved}</body>
 *   <widget instance dir>/index.html   that instance's own raw rendered HTML
 *
 * buildPages re-runs `render()` on every widget/shell every time it's
 * called — including any handler/API call a widget's own code makes — so
 * re-running the build (e.g. because an upstream API now returns different
 * data) produces fresh fragment files in `out/` without touching
 * `.prebuild/` at all.
 *
 * There is NO combined, single-file page HTML persisted anywhere. The
 * request-time composer (`composePageFromFiles`) splices the fragments
 * above into one HTML string purely in memory — pure filesystem READS +
 * string splicing, no render()/dynamic-import and no disk WRITE — and
 * that composed string is handed straight to the response, never cached
 * to disk. Every request recomposes from the same fragment files.
 */

const CONTENT_FILE = "content.json";
const META_FILE = "meta.json";
const HTML_FILE = "index.html";
/** Persisted alongside html/<Shell>/index.html and body/<Shell>/index.html
 *  — the SAME attrs `renderAttrs` already baked into those files' opening
 *  tags, just also structured, for composePageAsJson's `htmlAttributes`/
 *  `bodyAttributes` fields (the SPA router's swapPage needs to sync
 *  `<html>`/`<body>`'s own attrs on navigation — `<body>`'s INNER content
 *  gets replaced wholesale, but its own tag never does, so a per-page class
 *  there would otherwise stay stuck on whatever the first page set).
 *  Extracted from the already-scopeClasses-prefixed doc string itself
 *  (parseTagAttrs), not recomputed separately, so the two can never drift. */
const ATTRS_FILE = "attrs.json";
/** A page's own manifest lives at `pages/<folder>/meta.json`; a
 *  PAGE-SPECIFIC widget instance's content.json/index.html/script.js (and
 *  its own components/, if it uses any) live right alongside, at
 *  `pages/<folder>/widgets/<id>/` — scoped under that page's own folder
 *  since the same widget id can mean genuinely different content on a
 *  different page (see WIDGETS_DIR below for the shared/common case). */
const PAGES_DIR = "pages";
/** A page's own `<head>` fragment, next to its meta.json — written only
 *  when the page has `metadata` and its shell has a `head()` entry (see
 *  renderHeadDoc). Absent = the shell's shared head/<Shell>/index.html. */
const PAGE_HEAD_FILE = "head.html";
/** A SHARED/common widget instance (built once, sitemap.shared[], reused
 *  by `ref`) lives at `widgets/<Type>/<id>/` — the SAME folder prebuild's
 *  own CSS-purge output already mirrors into (`widgets/<Type>/<Type>.<hash>.css`),
 *  so opening `out/widgets/<Type>/` shows everything about that shared
 *  widget together: its CSS, plus its one real instance's HTML/script. A
 *  PAGE-SPECIFIC widget instance (its own props, rebuilt per page) is a
 *  different real-world thing per page even when its `type`/`id` repeat
 *  across pages, so it belongs under that PAGE's own folder instead — see
 *  PAGES_DIR below — never under this shared `widgets/<Type>/` tree. */
const WIDGETS_DIR = "widgets";
/** Build/serve-only short URL prefix for a SHARED widget's content.json
 *  (see W_INDEX_FILE's own doc comment for how a bare id resolves back to
 *  its real, type-nested storage path) — matches the real streak-forge
 *  reference's own "w" convention. Dev keeps the verbose, self-describing
 *  `/widgets/<Type>/<id>/...` path (no lookup needed there at all) — this
 *  is purely a build/serve URL-shape concern, independent of caching. */
const SHORT_WIDGET_DIR = "w";
/** Build/serve-only short URL prefix for a Dynamic block's content.json —
 *  matches real streak-forge's own convention, where "c" means Dynamic
 *  (not "component" — streak-forge's own shared-COMPONENT concept has no
 *  direct-fetch path of its own yet, always spliced server-side). Unlike
 *  SHORT_WIDGET_DIR, this needs no lookup table at all: Dynamic storage
 *  (DYNAMIC_DIR) is already flat-by-id, so `/c/<id>/...` is a pure prefix
 *  swap for `/dynamic/<id>/...`, resolved with a fixed rule on the server
 *  (see mock-worker-server.ts), not a per-id index. */
const SHORT_DYNAMIC_DIR = "c";
/** A SHARED widget's real, type-nested storage path (`widgets/<Type>/<id>`)
 *  isn't derivable from its bare id alone the way a Dynamic block's is —
 *  so the short `/w/<id>/...` URL needs this one small lookup, written
 *  once per shared widget build (buildPages), read once by the server per
 *  `/w/` request. Kept deliberately separate from any caching/versioning
 *  concern — this file exists purely to resolve a short id to its real
 *  path, nothing else. */
const W_INDEX_FILE = "w-index.json";
/** Each widget instance's OWN script fragment (just its Script block(s),
 *  IIFE-wrapped) — persisted alongside its content.json/index.html, one
 *  tiny file per instance. Never combined into a per-page file at build
 *  time: concatenating a handful of small self-invoking-function strings
 *  is cheap enough to do on every request instead (see
 *  composeScriptBundle) — same reasoning as composePageFromFiles never
 *  persisting a combined page. */
const WIDGET_SCRIPT_FILE = "script.js";
/** The virtual public filename a page's combined script is served at
 *  ("/common.js", "/page-2/common.js", ...) — never written to disk;
 *  composeScriptBundle produces it fresh, in memory, per request. */
const PAGE_SCRIPT_FILE = "common.js";
const WIDGET_PLACEHOLDER_ATTR = "data-widget-placeholder";
const WIDGET_TYPE_ATTR = "data-widget-type";
/** Stamped onto a LAZY widget's placeholder marker ONLY for build/serve
 *  (manifest.inlineCss) — the direct, static outDir-relative URL to that
 *  instance's own already-persisted content.json (see WidgetContent),
 *  letting the client fetch it straight off disk with no server-side
 *  lookup at all (see cli/root-script.ts's loadLazyWidget). Dev leaves it
 *  off and falls back to the old /__streak/lazy?page=&id= composed
 *  endpoint (cli/app-script.ts's pump checks for this attr first). */
const WIDGET_SRC_ATTR = "data-widget-src";
/** One widget instance's OWN script.js PLUS its non-lazy components'
 *  script.js, already joined — the same content widgetScriptParts
 *  computes at request time (for composeScriptBundle/the old lazy-fragment
 *  path), just also persisted as one real file so WidgetContent.scriptHref
 *  can point straight at it for a direct client <script src> load — no
 *  per-request join needed for that path specifically. */
const WIDGET_BUNDLE_FILE = "bundle.js";
const COMPONENT_PLACEHOLDER_ATTR = "data-component-placeholder";
const COMPONENT_TYPE_ATTR = "data-component-type";
/** Common components used inside a widget nest under that widget's OWN
 *  instance folder ("<widgetPath>/components/<id>/") — never at the top
 *  level, unlike widgets/shared, since a component is only ever built
 *  "for" one specific widget usage (see SitemapComponentEntry's doc). */
const COMPONENTS_DIR = "components";
/** Written verbatim under outDir by buildPages — see ROOT_SCRIPT_JS/
 *  APP_SCRIPT_JS/ASSET_WORKER_JS's own doc comments (cli/root-script.ts,
 *  cli/app-script.ts, cli/asset-worker.ts). Real static files from that
 *  point on; only the fragment fetches they make need a live composer. */
const LAZY_RUNTIME_DIR = "__streak";
const ROOT_SCRIPT_FILE = "root.js";
const APP_SCRIPT_FILE = "app.js";
const ASSET_WORKER_FILE = "asset-worker.js";
const SPA_ROUTER_FILE = "spa-router.js";
/** dev-only: root.js + app.js concatenated into one file (both are
 *  self-invoking IIFEs, so this just runs one right after the other — same
 *  effective order/behavior as the two separate tags, since neither one is
 *  deferred/async there either). Dev has no Lighthouse-scoring reason to
 *  pay for the split-into-two-requests-plus-addResourceToBody-indirection
 *  build/serve needs (see resolvePageParts' own doc comment on that
 *  chain) — a page that needs the runtime at all in dev just gets ONE
 *  plain, un-deferred `<script src>`, the old simple way. */
const DEV_RUNTIME_FILE = "dev-runtime.js";
/** The client runtime's linked <script src>s — root.js first (defines
 *  addResourceToBody/loadDynamicComponent/generation-cleanup), then app.js
 *  (uses them: the lazy-widget loader, loadPackage), then spa-router.js
 *  (opt-in, uses both). asset-worker.js is never linked as a <script> tag
 *  — app.js's loadPackage instantiates it directly as a Worker, only when
 *  actually called. Build/serve only (inlineCss: true) — dev links
 *  DEV_RUNTIME_HREF instead, see its own doc comment. */
export const ROOT_SCRIPT_HREF = `/${LAZY_RUNTIME_DIR}/${ROOT_SCRIPT_FILE}`;
export const APP_SCRIPT_HREF = `/${LAZY_RUNTIME_DIR}/${APP_SCRIPT_FILE}`;
export const ASSET_WORKER_HREF = `/${LAZY_RUNTIME_DIR}/${ASSET_WORKER_FILE}`;
export const SPA_ROUTER_HREF = `/${LAZY_RUNTIME_DIR}/${SPA_ROUTER_FILE}`;
export const DEV_RUNTIME_HREF = `/${LAZY_RUNTIME_DIR}/${DEV_RUNTIME_FILE}`;
/** Where the client runtime fetches one lazy widget's fragment from —
 *  `?page=<manifest.url>&id=<widget id>` — see composeLazyWidgetFragment
 *  and mock-worker-server.ts's matching route. */
export const LAZY_FRAGMENT_HREF = `/${LAZY_RUNTIME_DIR}/lazy`;
/** Where the client runtime fetches one Dynamic block's fragment from —
 *  `?id=<dynamic id>` — flat by id, no page context needed (see
 *  composeDynamicFragment and mock-worker-server.ts's matching route). */
export const DYNAMIC_FRAGMENT_HREF = `/${LAZY_RUNTIME_DIR}/dynamic`;
const DYNAMIC_SLOT_ATTR = "data-dynamic-slot";
/** Stamped onto a Dynamic slot's own marker ONLY for build/serve
 *  (BuildPagesOptions.inlineCss) — same idea as WIDGET_SRC_ATTR, just for
 *  a Dynamic block instead of a lazy widget: the direct, static, short
 *  `/c/<id>/content.json` URL (see SHORT_DYNAMIC_DIR) to that block's own
 *  already-persisted content.json (see extractDynamicBlocks), so the
 *  client (root.js's loadDynamicComponent) can fetch it straight off disk
 *  — a fixed `/c/` -> DYNAMIC_DIR prefix swap on the server, no per-id
 *  lookup needed (contrast SHORT_WIDGET_DIR/W_INDEX_FILE, which does need
 *  one). Dev leaves it off and falls back to the old /__streak/dynamic?id=
 *  composed endpoint. Unlike WIDGET_SRC_ATTR (which
 *  gets stamped at REQUEST time, since a widget's marker lives in the
 *  shared shell body file), this is baked in at BUILD time, right inside
 *  extractDynamicBlocks — a Dynamic slot's marker is part of its OWNING
 *  widget's own persisted HTML, not a page-shell fragment, so there's no
 *  separate per-request stamping step needed for it at all. */
const DYNAMIC_SRC_ATTR = "data-dynamic-src";
/** Flat, page/widget-independent — `outDir/dynamic/<id>/` — mirrors
 *  WIDGETS_DIR's own flat-by-id convention, since the client only ever
 *  has the bare id (see jsx.ts's Dynamic doc comment). */
const DYNAMIC_DIR = "dynamic";
/** Explicit placeholder marker (same idea as htmlSkeleton's own
 *  `<head></head>`/`<body></body>`, or WIDGET_PLACEHOLDER_ATTR) written
 *  into head/<Shell>/index.html AT BUILD TIME whenever `inlineCss: true`,
 *  in place of any real CSS — the critical/combined CSS itself is never
 *  computed or persisted at build time, only at request time
 *  (composePageFromFiles's collectInlineCss reads each already-persisted
 *  widget's OWN css file fresh, per request, and substitutes it in here).
 *  This is exactly why per-widget CSS stays independently cacheable/
 *  rebuildable — nothing ever combines it ahead of time. */
const CRITICAL_CSS_PLACEHOLDER = "<!--streak-critical-css-->";

/** Reads streak.sitemap.json as plain JSON (JSON.parse, never eval/import)
 *  — same defensive reasoning as streak-distiller's own sitemap reader:
 *  works reliably once bundled, never executes arbitrary code. */
export function readSitemap(filePath: string): StreakBootSitemap {
  const raw = JSON.parse(readFileSync(filePath, "utf-8")) as unknown;
  if (!raw || typeof raw !== "object" || !Array.isArray((raw as StreakBootSitemap).pages)) {
    throw new Error(`${filePath}: expected an object with a "pages" array`);
  }
  return raw as StreakBootSitemap;
}

/**
 * Renders a widget/handler/component/html/head/body/rootLayout's own
 * module and returns whatever it returns, UNTYPED — the caller implements
 * this once (dynamic import + call fn(props)); page-build.ts is what
 * interprets the result per-context, since it's genuinely one of two
 * different shapes depending on which registry category the meta came
 * from: a real VNodeChild for a widget/component/rootLayout/head (gets
 * `renderToString`'d), or a plain attribute object for an html()/body()
 * (there's only ever one <html>/<body> tag — no markup to render, just
 * `{ lang: "en" }`-style attrs, fed to `renderAttrs` instead).
 */
export type RenderInstance = (
  meta: { filePath: string; exportName: string },
  props: Record<string, unknown>,
) => Promise<unknown>;

export interface BuildPagesOptions {
  registry: Registry;
  sitemap: StreakBootSitemap;
  outDir: string;
  render: RenderInstance;
  /** MUST match whatever `runPreBuild({ scopeClasses })` used — this
   *  rewrites every persisted HTML fragment's `class="..."` attribute
   *  values to the same "<shortScopePrefix(type)>__<class>" scheme
   *  css-purge.ts's prefixCssClasses already applied to the matching CSS
   *  selectors, so the two stay in sync. Off by default. */
  scopeClasses?: boolean;
  /** false (default) = `dev`'s behavior: every CSS file discovered under
   *  the project's public dir (see `discoverCssHrefs`, passed as
   *  `cssHrefs`) gets its own `<link>`, baked into head/<Shell>/index.html
   *  once at build time — simple, no per-page eager/lazy distinction,
   *  fine for a local dev loop that rebuilds on every save anyway.
   *  true = `build`'s behavior: head/<Shell>/index.html stays CSS-free;
   *  composePageFromFiles combines common + shell + every EAGER widget's
   *  own CSS into one inline `<style>`, computed fresh per request (only
   *  worth the extra work for a real deployed build/worker, not dev). The
   *  choice is persisted per page manifest (`PageManifest.inlineCss`) so
   *  the request-time composer doesn't need to be told again. */
  inlineCss?: boolean;
  /** Only meaningful when `inlineCss` is false/omitted — hrefs baked as
   *  individual `<link rel="stylesheet">` tags into every shell's
   *  head/index.html. Same list for every page. See `discoverCssHrefs`. */
  cssHrefs?: string[];
  /** Opt-in real client-side navigation (cli/spa-router.ts) — off by
   *  default, matching real streak-forge's own opt-in philosophy: whether
   *  a site "behaves as an SPA" depends purely on whether the router
   *  script is written/linked at all. `/index.json` (composePageAsJson,
   *  mock-worker-server.ts's matching route) is always a real, live route
   *  regardless of this flag — same as real streak-forge's own "every
   *  page already writes an index.json twin, unconditionally" behavior. */
  spa?: boolean;
}

export interface BuildPagesResult {
  pageManifests: PageManifest[];
  sharedBuilt: string[];
}

/** Internal, registry-colocated folder name for a page — "/" -> "index"
 *  (never the bare outDir root, which is reserved for the other category
 *  folders: widgets/, components/, shared/, ...). */
export function cleanUrlToFolder(url: string): string {
  const trimmed = url.replace(/^\/+|\/+$/g, "");
  return trimmed === "" ? "index" : trimmed;
}

/**
 * Resolves a build/serve-only short-prefix request path (`/w/<id>/...` or
 * `/c/<id>/...` — see SHORT_WIDGET_DIR/SHORT_DYNAMIC_DIR/W_INDEX_FILE's own
 * doc comments) back to the real outDir-relative path a static-asset route
 * can actually read — `null` if `pathname` doesn't start with either
 * prefix, or (for `/w/`) the id isn't in W_INDEX_FILE. Called by the
 * server BEFORE its normal static-asset branch, since these paths don't
 * physically exist at their short form. Pure path resolution only, no
 * caching/versioning concern (kept deliberately separate — see this
 * feature's own scoping).
 */
export function resolveShortAssetPath(outDir: string, pathname: string): string | null {
  const parts = pathname.split("/").filter(Boolean);
  if (parts.length < 2) return null;
  const [prefix, id, ...rest] = parts;
  if (prefix === SHORT_DYNAMIC_DIR) return join(DYNAMIC_DIR, id!, ...rest);
  if (prefix === SHORT_WIDGET_DIR) {
    const wIndexPath = join(outDir, W_INDEX_FILE);
    if (!existsSync(wIndexPath)) return null;
    const wIndex = JSON.parse(readFileSync(wIndexPath, "utf-8")) as Record<string, string>;
    const realPath = wIndex[id!];
    if (!realPath) return null;
    return join(realPath, ...rest);
  }
  return null;
}

/** The REAL public URL path segment for a page — "/" -> "" (so its static
 *  HTML lands at outDir/public/index.html, the actual site root a plain
 *  static file server expects), "/page-2" -> "page-2". Deliberately
 *  different from cleanUrlToFolder: that one avoids writing to the bare
 *  outDir root; this one is exactly what the URL means to a static host,
 *  which has no "pages/" prefix and no reason to special-case "/". */
export function cleanUrlToPublicPath(url: string): string {
  return url.replace(/^\/+|\/+$/g, "");
}

function lookupWidget(registry: Registry, type: string, context: string): WidgetMeta {
  const meta = registry.widgets[type];
  if (!meta) throw new Error(`${context}: no registered widget with type "${type}"`);
  return meta;
}

function lookupComponent(registry: Registry, type: string, context: string): ComponentMeta {
  const meta = registry.components[type];
  if (!meta) throw new Error(`${context}: no registered component with type "${type}"`);
  return meta;
}

function resolveRootLayoutType(registry: Registry, page: SitemapPageEntry): ShellMeta {
  const types = Object.keys(registry.rootLayout);
  const wanted = page.rootLayout ?? (types.length === 1 ? types[0] : undefined);
  if (!wanted) {
    throw new Error(
      `page "${page.url}": no rootLayout specified and the project has ${types.length} rootLayout() entries (${types.join(", ") || "none"}) — set "rootLayout" on this page's sitemap entry.`,
    );
  }
  const meta = registry.rootLayout[wanted];
  if (!meta) throw new Error(`page "${page.url}": rootLayout "${wanted}" is not a registered rootLayout() entry`);
  return meta;
}

/** Writes a widget (or component) instance's rendered HTML both as JSON
 *  (content.json — kept for backward compatibility with anything reading
 *  WidgetContent) and as a literal index.html file (what
 *  composePageFromFiles/resolveWidgetComponents actually read) — plus, if
 *  it collected any `<Script>` blocks, its own small script.js fragment
 *  (what composeScriptBundle reads), and, if it's a WIDGET that uses any
 *  common components, its own meta.json mapping each component
 *  placeholder id to that component usage's own folder (what
 *  resolveWidgetComponents/composeScriptBundle read to resolve them at
 *  request time). A plain component instance never has its own
 *  `components` — they're one level deep only (see SitemapComponentEntry). */
function writeWidgetFiles(
  outDir: string,
  relDir: string,
  html: string,
  scripts: CollectedScript[],
  components: WidgetComponentManifestEntry[] = [],
  /** This instance's own CSS href (already resolved by the caller via
   *  findOwnCssFile, which needs the TYPE this function doesn't otherwise
   *  take) — folded straight into content.json, see WidgetContent.cssHref. */
  cssHref: string | null = null,
): void {
  const dir = join(outDir, relDir);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, HTML_FILE), html);
  if (scripts.length > 0) {
    writeFileSync(join(dir, WIDGET_SCRIPT_FILE), buildScriptBundle(scripts));
  }
  if (components.length > 0) {
    const manifest: WidgetInstanceManifest = { components };
    writeFileSync(join(dir, META_FILE), JSON.stringify(manifest, null, 2));
  }

  // Everything above must be on disk first: resolveWidgetComponents/
  // widgetScriptParts both read THIS instance's own meta.json just written
  // above (for its components list) plus each of those components' own
  // files — already written by now, since buildWidgetComponents always
  // writes a component's own files before its owning widget's (see that
  // function's call site) — so content.json can be fully self-sufficient,
  // with any non-lazy component already spliced in, right here at build
  // time (see WidgetContent's own doc comment on why).
  const resolvedHtml = resolveWidgetComponents(html, relDir, outDir);
  const scriptParts = widgetScriptParts(outDir, relDir);
  let scriptHref: string | null = null;
  if (scriptParts.length > 0) {
    writeFileSync(join(dir, WIDGET_BUNDLE_FILE), scriptParts.join("\n"));
    scriptHref = join(relDir, WIDGET_BUNDLE_FILE);
  }
  const content: WidgetContent = { html: resolvedHtml, cssHref, scriptHref };
  writeFileSync(join(dir, CONTENT_FILE), JSON.stringify(content, null, 2));
}

function readFileOr(path: string, fallback: string): string {
  return existsSync(path) ? readFileSync(path, "utf-8") : fallback;
}

/** Extracts `name="value"` pairs from an opening tag's own attribute text
 *  (e.g. `lang="en" dir="ltr"`, the same string `renderAttrs` produced) —
 *  used to persist ATTRS_FILE from an already-built doc string, so it can
 *  never drift from what's actually in the HTML (see ATTRS_FILE's own doc
 *  comment). Un-escapes the same three entities `escapeAttr` (jsx.ts)
 *  escapes going the other way. */
function parseTagAttrs(attrsText: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  const re = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)="([^"]*)"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(attrsText))) {
    attrs[m[1]!] = m[2]!.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, "&");
  }
  return attrs;
}

/** Single source of truth for a WIDGET placeholder marker's exact HTML —
 *  used both when GENERATING body/index.html (as a real rendered element)
 *  and when SEARCHING for it during composePageFromFiles's string-replace,
 *  so the two can never drift out of byte-for-byte agreement. */
function placeholderMarkerHtml(id: string, type: string): string {
  return `<div${renderAttrs({ [WIDGET_PLACEHOLDER_ATTR]: id, [WIDGET_TYPE_ATTR]: type })}></div>`;
}

/** The build/serve-only augmented form of a LAZY widget's marker — same
 *  attrs as placeholderMarkerHtml plus WIDGET_SRC_ATTR, pointing straight
 *  at that instance's own content.json (see WIDGET_SRC_ATTR's own doc
 *  comment). A SHARED widget gets the short `/w/<id>/...` URL (globally
 *  unique id, resolved via W_INDEX_FILE — see SHORT_WIDGET_DIR's own doc
 *  comment); a PAGE-SPECIFIC widget keeps its full outDir-relative path
 *  (`widgetPath`, PageWidgetManifestEntry.path) — its own id is only
 *  unique WITHIN that page, so a flat short URL would collide across
 *  pages that happen to reuse the same placeholder id. `pageVersion` is
 *  appended as `?v=` (see PageManifest.version's own doc comment) so the
 *  URL is immutable-cacheable — same value for every asset THIS page
 *  stamps, changes together whenever this page rebuilds with different
 *  content. */
function lazyPlaceholderMarkerHtml(id: string, type: string, widgetPath: string, shared: boolean, pageVersion: string): string {
  const path = shared ? `/${SHORT_WIDGET_DIR}/${basename(widgetPath)}/${CONTENT_FILE}` : `/${widgetPath}/${CONTENT_FILE}`;
  const src = `${path}?v=${pageVersion}`;
  return `<div${renderAttrs({ [WIDGET_PLACEHOLDER_ATTR]: id, [WIDGET_TYPE_ATTR]: type, [WIDGET_SRC_ATTR]: src })}></div>`;
}

/** Same idea, one level down — a COMPONENT placeholder marker inside a
 *  widget's own persisted HTML. Distinct attribute names from
 *  placeholderMarkerHtml so the two never collide or get confused, even
 *  though they're resolved in two different passes (page-level splice vs
 *  widget-level splice — see resolveWidgetComponents). */
function componentPlaceholderMarkerHtml(id: string, type: string): string {
  return `<div${renderAttrs({ [COMPONENT_PLACEHOLDER_ATTR]: id, [COMPONENT_TYPE_ATTR]: type })}></div>`;
}

/** Collects every `<marker id=.../>` id in a VNode tree (WidgetPlaceholder
 *  inside a rootLayout, or ComponentPlaceholder inside a widget) — used to
 *  lint the owner's declared entries against what its render output
 *  actually contains (every placeholder must have a matching entry, and
 *  vice versa). Mirrors resolvePlaceholders' walk but collects instead of
 *  replacing. */
function collectPlaceholderIds(node: VNodeChild, marker: PlaceholderMarker, out: Set<string> = new Set()): Set<string> {
  if (node === null || node === undefined || typeof node !== "object") return out;
  if (Array.isArray(node)) {
    for (const child of node) collectPlaceholderIds(child, marker, out);
    return out;
  }
  if (isKind(node.type, marker)) {
    out.add((node.props as unknown as { id: string }).id);
    return out;
  }
  const children = node.props?.children as VNodeChild;
  if (children !== undefined) collectPlaceholderIds(children, marker, out);
  return out;
}

/**
 * Wraps each collected Script block as an IIFE called with `(window,
 * options)` — same shape real streak-forge's own Script wraps its
 * (differently-sourced) serialized function in — then concatenates them.
 * Called once per widget INSTANCE (its own script.js fragment) at build
 * time; composeScriptBundle below does the same join again, across
 * instances, at request time, to make a page's full bundle — cheap either
 * way, since it's just string concatenation of small self-invoking
 * functions. This is the ONLY JS that reaches a page's public output;
 * unlike js-bundle.ts's whole-module bundles (which exist for
 * `.prebuild/`'s server-side reuse, matching streak-forge's own
 * `.prebuild/` convention), nothing here ships server-render logic or
 * imports to the browser — just each Script's own function body plus its
 * options, exactly matching streak-distiller's actual output shape.
 */
function buildScriptBundle(scripts: CollectedScript[]): string {
  return scripts.map((s) => `(function(){var __fn=(${s.fnSource});__fn(window,${s.optionsJson});})();`).join("\n");
}

/** Class scoping for one build: false = off, or the project's global
 *  (dynamicClasses) classes, which stay unprefixed — see css-purge.ts's
 *  collectGlobalClasses. */
type Scope = false | { globalClasses: ReadonlySet<string> };

function scopeHtml(html: string, type: string, scope: Scope): string {
  return scope ? prefixHtmlClasses(html, shortScopePrefix(type), scope.globalClasses) : html;
}

/**
 * Renders one `<head>` document for a shell's `head()` entry with the given
 * props — `{}` for the shell's shared head/<Shell>/index.html, `{ data:
 * page.metadata }` for a page's own head.html (per-page title/meta/SEO).
 */
async function renderHeadDoc(
  headMeta: ShellMeta | undefined,
  props: Record<string, unknown>,
  shellType: string,
  render: RenderInstance,
  scopeClasses: Scope,
  inlineCss: boolean,
  cssHrefs: string[],
): Promise<string> {
  const headVNode = headMeta ? ((await render(headMeta, props)) as VNodeChild) : null;
  let headContentHtml = await renderToString(headVNode);
  // Minified BEFORE concatenating cssLinksHtml, never after — cssLinksHtml
  // is CRITICAL_CSS_PLACEHOLDER (an HTML COMMENT) when inlineCss: true,
  // and minifyHtml strips HTML comments; running it on the assembled
  // headDoc would delete that placeholder along with real comments,
  // breaking collectInlineCss's own request-time replace entirely.
  if (inlineCss) headContentHtml = minifyHtml(headContentHtml);
  // inlineCss: true (build/serve) — no CSS links baked in here at all.
  // Which widgets are eager (and so need their CSS inlined) varies per
  // PAGE, not per shell — composePageFromFiles injects the real, per-page
  // combined <style> at request time instead (see collectInlineCss).
  // inlineCss: false (dev) — restores the simple old behavior: every
  // discovered CSS file gets its own <link>, baked in once, same for every
  // page — good enough for a loop that rebuilds on every save anyway.
  const cssLinksHtml = inlineCss ? CRITICAL_CSS_PLACEHOLDER : cssHrefs.map((href) => `<link rel="stylesheet" href="${href}">`).join("");
  let headDoc = `<head>${headContentHtml}${cssLinksHtml}</head>`;
  headDoc = scopeHtml(headDoc, shellType, scopeClasses);
  return headDoc;
}

/**
 * Writes the three shell-layer files for one rootLayout TYPE — html/head/
 * body/index.html (see the module doc comment for their exact shape).
 * Idempotent: every page using the same shell writes the identical
 * content, so calling this once per page (rather than deduping across
 * pages first) is harmless, just a little redundant I/O.
 */
async function writeShellFiles(
  registry: Registry,
  shellType: string,
  render: RenderInstance,
  outDir: string,
  scopeClasses: Scope,
  inlineCss: boolean,
  cssHrefs: string[],
): Promise<void> {
  const htmlMeta = registry.html[shellType];
  const headMeta = registry.head[shellType];
  const bodyMeta = registry.body[shellType];
  const rootLayoutMeta = registry.rootLayout[shellType];

  const htmlAttrs = htmlMeta ? ((await render(htmlMeta, {})) as Record<string, unknown>) : {};
  const htmlDir = join(outDir, "html", shellType);
  mkdirSync(htmlDir, { recursive: true });
  let htmlDoc = `<html${renderAttrs(htmlAttrs)}><head></head><body></body></html>`;
  htmlDoc = scopeHtml(htmlDoc, shellType, scopeClasses);
  if (inlineCss) htmlDoc = minifyHtml(htmlDoc);
  writeFileSync(join(htmlDir, HTML_FILE), htmlDoc);
  const htmlTagMatch = htmlDoc.match(/^<html([^>]*)>/);
  writeFileSync(join(htmlDir, ATTRS_FILE), JSON.stringify(htmlTagMatch ? parseTagAttrs(htmlTagMatch[1]!) : {}));

  const headDir = join(outDir, "head", shellType);
  mkdirSync(headDir, { recursive: true });
  writeFileSync(join(headDir, HTML_FILE), await renderHeadDoc(headMeta, {}, shellType, render, scopeClasses, inlineCss, cssHrefs));

  const bodyAttrs = bodyMeta ? ((await render(bodyMeta, {})) as Record<string, unknown>) : {};
  const layoutVNode = rootLayoutMeta ? ((await render(rootLayoutMeta, {})) as VNodeChild) : null;
  // Components can only be used inside a widget, never directly inside a
  // rootLayout — catch the mistake early with a clear message rather than
  // silently rendering an empty slot (renderToString's ComponentPlaceholder
  // guard would otherwise just swallow it).
  const strayComponentIds = collectPlaceholderIds(layoutVNode, ComponentPlaceholder);
  if (strayComponentIds.size > 0) {
    throw new Error(
      `rootLayout "${shellType}": <ComponentPlaceholder> can only be used inside a widget, not directly in a rootLayout (found: ${[...strayComponentIds].join(", ")})`,
    );
  }
  const markedVNode = await resolvePlaceholders(layoutVNode, WidgetPlaceholder, (id, type) => ({
    type: "div",
    props: { [WIDGET_PLACEHOLDER_ATTR]: id, [WIDGET_TYPE_ATTR]: type },
  }));
  let bodyContentHtml = await renderToString(markedVNode);
  // Safe to minify: WIDGET_PLACEHOLDER_ATTR markers are plain <div>
  // elements with no internal whitespace (built fresh, byte-identical,
  // by placeholderMarkerHtml whenever resolvePageParts searches for one —
  // minifyHtml only ever collapses whitespace BETWEEN tags, never inside
  // one), so collapsing whitespace around them can't break that later
  // string match.
  if (inlineCss) bodyContentHtml = minifyHtml(bodyContentHtml);
  const bodyDir = join(outDir, "body", shellType);
  mkdirSync(bodyDir, { recursive: true });
  let bodyDoc = `<body${renderAttrs(bodyAttrs)}>${bodyContentHtml}</body>`;
  bodyDoc = scopeHtml(bodyDoc, shellType, scopeClasses);
  writeFileSync(join(bodyDir, HTML_FILE), bodyDoc);
  const bodyTagMatch = bodyDoc.match(/^<body([^>]*)>/);
  writeFileSync(join(bodyDir, ATTRS_FILE), JSON.stringify(bodyTagMatch ? parseTagAttrs(bodyTagMatch[1]!) : {}));
}

/**
 * Walks a widget's (or shared widget's) own render output looking for
 * `<Dynamic id>` blocks (jsx.ts) and, for each one found, renders+persists
 * its children as their own flat, page-independent fragment
 * (`outDir/dynamic/<id>/index.html` + `script.js` if it collected any
 * Script blocks of its own — kept OUT of the owning widget's own
 * script.js, so a Dynamic panel's interactivity is deferred right along
 * with its markup), then replaces the node with a plain, empty
 * `<div data-dynamic-slot="id">` — from here on, buildWidgetComponents/
 * collectScripts/renderToString on the OWNER's own vnode see nothing but
 * an ordinary div; they never need to know `Dynamic` was involved. No CSS
 * handling needed here: a Dynamic block's classes are real literal
 * strings in the SAME widget file, so the owner's own CSS-purge sample
 * scan (renderSample, called with `{}`) already sees them — they ship in
 * the owner's existing stylesheet, already linked in `<head>` before this
 * fragment is ever fetched.
 *
 * Called on a widget's freshly-rendered vnode BEFORE buildWidgetComponents
 * — Dynamic and ComponentPlaceholder are independent, orthogonal concerns
 * (no real example nests one inside the other), so order between them
 * doesn't matter; this just runs first for a simpler mental model.
 */
async function extractDynamicBlocks(node: VNodeChild, outDir: string, ownerType: string, scopeClasses: Scope, inlineCss: boolean): Promise<VNodeChild> {
  if (node === null || node === undefined || typeof node !== "object") return node;
  if (Array.isArray(node)) return Promise.all(node.map((child) => extractDynamicBlocks(child, outDir, ownerType, scopeClasses, inlineCss)));

  if (isKind(node.type, Dynamic)) {
    const { id, children } = node.props as unknown as DynamicProps;
    let html = await renderToString(children ?? null);
    html = scopeHtml(html, ownerType, scopeClasses);
    if (inlineCss) html = minifyHtml(html);
    const scripts = await collectScripts(children ?? null);
    const dir = join(outDir, DYNAMIC_DIR, id);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, HTML_FILE), html);
    let scriptHref: string | null = null;
    if (scripts.length > 0) {
      writeFileSync(join(dir, WIDGET_SCRIPT_FILE), buildScriptBundle(scripts));
      scriptHref = join(DYNAMIC_DIR, id, WIDGET_SCRIPT_FILE);
    }
    // No cssHref of its own — a Dynamic block's classes ship in its
    // OWNER's existing stylesheet (see this function's own doc comment),
    // already loaded by the time this content.json is ever fetched.
    const content: WidgetContent = { html, cssHref: null, scriptHref };
    writeFileSync(join(dir, CONTENT_FILE), JSON.stringify(content, null, 2));

    // build/serve only — see DYNAMIC_SRC_ATTR's own doc comment. Baked in
    // right here, at build time, since a Dynamic slot's marker is part of
    // its OWNING widget's own persisted HTML, not a per-request page-shell
    // fragment (contrast WIDGET_SRC_ATTR, stamped later, per request).
    const props: Record<string, string> = { [DYNAMIC_SLOT_ATTR]: id };
    if (inlineCss) props[DYNAMIC_SRC_ATTR] = `/${SHORT_DYNAMIC_DIR}/${id}/${CONTENT_FILE}`;
    return { type: "div", props };
  }

  // Not descending into nested function components (e.g. a
  // Button-inside-ProductCard shape) — same scope as this file's own
  // collectPlaceholderIds/resolvePlaceholders (WidgetPlaceholder/
  // ComponentPlaceholder are likewise only ever matched in a widget's own
  // top-level JSX, never inside a further sub-component); all 3 real
  // Dynamic usages this session ported follow that same shape.
  const children = node.props?.children as VNodeChild;
  if (children === undefined) return node;
  return { type: node.type, props: { ...node.props, children: await extractDynamicBlocks(children, outDir, ownerType, scopeClasses, inlineCss) } };
}

/**
 * A widget's own components[], one level deep: validates the widget's
 * render output's `<ComponentPlaceholder>`s against its sitemap-declared
 * `components[]` (both directions, same cross-check as pages do for
 * widgets), renders + persists each declared component SEPARATELY under
 * `<widgetPath>/components/<id>/` (even if another widget elsewhere uses
 * the identical component type — no dedup/sharing at this level, unlike
 * widgets themselves), and turns the widget's own `<ComponentPlaceholder>`
 * nodes into real marker `<div>`s ready for `renderToString`. Enforces
 * "one level only": throws if a component's OWN render output contains
 * another `<ComponentPlaceholder>`, and if a widget's OWN render output
 * contains a stray `<WidgetPlaceholder>` (that belongs in a rootLayout,
 * not here).
 */
async function buildWidgetComponents(
  registry: Registry,
  vnode: VNodeChild,
  componentEntries: SitemapComponentEntry[] | undefined,
  render: RenderInstance,
  outDir: string,
  widgetPath: string,
  context: string,
  scopeClasses: Scope,
  inlineCss: boolean,
): Promise<{ markedVNode: VNodeChild; components: WidgetComponentManifestEntry[] }> {
  const strayWidgetIds = collectPlaceholderIds(vnode, WidgetPlaceholder);
  if (strayWidgetIds.size > 0) {
    throw new Error(`${context}: <WidgetPlaceholder> can only be used inside a rootLayout, not inside a widget (found: ${[...strayWidgetIds].join(", ")})`);
  }

  const entries = componentEntries ?? [];
  const byId = new Map(entries.map((c) => [c.id, c]));
  const placeholderIds = collectPlaceholderIds(vnode, ComponentPlaceholder);
  for (const id of placeholderIds) {
    if (!byId.has(id)) throw new Error(`${context}: has <ComponentPlaceholder id="${id}"/> with no matching entry in its sitemap components[]`);
  }
  for (const id of byId.keys()) {
    if (!placeholderIds.has(id)) throw new Error(`${context}: sitemap component "${id}" has no matching <ComponentPlaceholder id="${id}"/> in its own render output`);
  }

  const components: WidgetComponentManifestEntry[] = [];
  for (const c of entries) {
    const meta = lookupComponent(registry, c.type, `${context}, component "${c.id}"`);
    const cVnode = (await render(meta, c.props ?? {})) as VNodeChild;
    const nestedComponentIds = collectPlaceholderIds(cVnode, ComponentPlaceholder);
    if (nestedComponentIds.size > 0) {
      throw new Error(
        `${context}, component "${c.id}" (type "${c.type}"): components are one level deep only — a component cannot itself use <ComponentPlaceholder> (found: ${[...nestedComponentIds].join(", ")})`,
      );
    }
    let cHtml = await renderToString(cVnode);
    cHtml = scopeHtml(cHtml, c.type, scopeClasses);
    if (inlineCss) cHtml = minifyHtml(cHtml);
    const path = join(widgetPath, COMPONENTS_DIR, c.id);
    writeWidgetFiles(outDir, path, cHtml, await collectScripts(cVnode), [], findOwnCssFile(outDir, COMPONENTS_DIR, c.type));
    components.push({ id: c.id, type: c.type, path, lazy: c.loadingStrategy === "lazy" });
  }

  const markedVNode = await resolvePlaceholders(vnode, ComponentPlaceholder, (id, type) => ({
    type: "div",
    props: { [COMPONENT_PLACEHOLDER_ATTR]: id, [COMPONENT_TYPE_ATTR]: type },
  }));

  return { markedVNode, components };
}

/** Reads a widget instance's own meta.json (if it wrote one — only widgets
 *  using at least one common component do) — the widget-level analogue of
 *  reading a page's manifest, used at request time by
 *  resolveWidgetComponents/composeScriptBundle/buildPages' own hasScript
 *  check. Empty array (not a throw) when the widget uses no components. */
function readWidgetComponentManifest(outDir: string, widgetPath: string): WidgetComponentManifestEntry[] {
  const metaPath = join(outDir, widgetPath, META_FILE);
  if (!existsSync(metaPath)) return [];
  return (JSON.parse(readFileSync(metaPath, "utf-8")) as WidgetInstanceManifest).components;
}

/**
 * Builds every `shared[]` widget once, then every page: renders each
 * page-specific widget instance with its own real props, links shared
 * instances by reference instead of rebuilding them, validates the page's
 * rootLayout's placeholders against its widgets[], writes the html/head/
 * body shell files for that page's rootLayout type, and writes the page's
 * manifest to `outDir/pages/<url>/meta.json`.
 */
export async function buildPages(options: BuildPagesOptions): Promise<BuildPagesResult> {
  const { registry, sitemap, outDir, render, inlineCss = false, cssHrefs = [], spa = false } = options;
  const scopeClasses: Scope = options.scopeClasses
    ? {
        globalClasses: collectGlobalClasses([
          ...Object.values(registry.widgets),
          ...Object.values(registry.components),
          ...Object.values(registry.html),
          ...Object.values(registry.head),
          ...Object.values(registry.body),
          ...Object.values(registry.rootLayout),
        ]),
      }
    : false;
  const sharedById = new Map(sitemap.shared?.map((s) => [s.id, s]) ?? []);
  const wIndex: Record<string, string> = {};

  for (const shared of sitemap.shared ?? []) {
    const meta = lookupWidget(registry, shared.type, `shared widget "${shared.id}"`);
    let vnode = (await render(meta, shared.props ?? {})) as VNodeChild;
    vnode = await extractDynamicBlocks(vnode, outDir, shared.type, scopeClasses, inlineCss);
    const path = join(WIDGETS_DIR, shared.type, shared.id);
    wIndex[shared.id] = path;
    const { markedVNode, components } = await buildWidgetComponents(
      registry,
      vnode,
      shared.components,
      render,
      outDir,
      path,
      `shared widget "${shared.id}"`,
      scopeClasses,
      inlineCss,
    );
    let html = await renderToString(markedVNode);
    html = scopeHtml(html, shared.type, scopeClasses);
    if (inlineCss) html = minifyHtml(html);
    writeWidgetFiles(outDir, path, html, await collectScripts(markedVNode), components, findOwnCssFile(outDir, WIDGETS_DIR, shared.type));
  }
  // Build/serve only — see W_INDEX_FILE's own doc comment. Written
  // unconditionally whenever there's at least one shared widget AND
  // inlineCss, cheap and idempotent, same as root.js/app.js/etc below.
  if (inlineCss && Object.keys(wIndex).length > 0) {
    writeFileSync(join(outDir, W_INDEX_FILE), JSON.stringify(wIndex, null, 2));
  }

  const pageManifests: PageManifest[] = [];
  const shellsWritten = new Set<string>();

  for (const page of sitemap.pages) {
    const folder = cleanUrlToFolder(page.url);
    const rootLayoutMeta = resolveRootLayoutType(registry, page);

    const widgets: PageWidgetManifestEntry[] = [];
    for (const w of page.widgets) {
      const lazy = w.loadingStrategy === "lazy";
      if ("ref" in w) {
        const id = w.id ?? w.ref;
        const shared = sharedById.get(w.ref);
        if (!shared) throw new Error(`page "${page.url}": widget "${id}" refs unknown shared id "${w.ref}"`);
        const path = join(WIDGETS_DIR, shared.type, shared.id);
        widgets.push({ id, type: shared.type, shared: true, path, lazy, cssHref: findOwnCssFile(outDir, WIDGETS_DIR, shared.type) });
      } else {
        const context = `page "${page.url}", widget "${w.id}"`;
        const meta = lookupWidget(registry, w.type, context);
        let vnode = (await render(meta, { data: page.metadata ?? {} })) as VNodeChild;
        vnode = await extractDynamicBlocks(vnode, outDir, w.type, scopeClasses, inlineCss);
        const path = join(PAGES_DIR, folder, WIDGETS_DIR, w.id);
        const { markedVNode, components } = await buildWidgetComponents(registry, vnode, w.components, render, outDir, path, context, scopeClasses, inlineCss);
        let html = await renderToString(markedVNode);
        html = scopeHtml(html, w.type, scopeClasses);
        if (inlineCss) html = minifyHtml(html);
        const widgetCssHref = findOwnCssFile(outDir, WIDGETS_DIR, w.type);
        writeWidgetFiles(outDir, path, html, await collectScripts(markedVNode), components, widgetCssHref);
        widgets.push({ id: w.id, type: w.type, shared: false, path, lazy, cssHref: widgetCssHref });
      }
    }

    const layoutVNode = (await render(rootLayoutMeta, {})) as VNodeChild;
    const placeholderIds = collectPlaceholderIds(layoutVNode, WidgetPlaceholder);
    for (const id of placeholderIds) {
      if (!widgets.some((w) => w.id === id)) {
        throw new Error(`page "${page.url}": rootLayout has <WidgetPlaceholder id="${id}"/> with no matching entry in sitemap widgets[]`);
      }
    }
    for (const w of widgets) {
      if (!placeholderIds.has(w.id)) {
        throw new Error(`page "${page.url}": sitemap widget "${w.id}" has no matching <WidgetPlaceholder id="${w.id}"/> in its rootLayout`);
      }
    }

    if (!shellsWritten.has(rootLayoutMeta.type)) {
      await writeShellFiles(registry, rootLayoutMeta.type, render, outDir, scopeClasses, inlineCss, cssHrefs);
      shellsWritten.add(rootLayoutMeta.type);
    }

    const pageDir = join(outDir, PAGES_DIR, folder);
    mkdirSync(pageDir, { recursive: true });

    // Per-page <head> (title/meta/canonical per product, collection, ...):
    // the shell's head() rendered again with this page's own metadata.
    // Pages without metadata keep using the shell's shared head file.
    const headMeta = registry.head[rootLayoutMeta.type];
    const pageHeadPath = join(pageDir, PAGE_HEAD_FILE);
    let headPath: string | undefined;
    if (headMeta && page.metadata) {
      writeFileSync(pageHeadPath, await renderHeadDoc(headMeta, { data: page.metadata }, rootLayoutMeta.type, render, scopeClasses, inlineCss, cssHrefs));
      headPath = join(PAGES_DIR, folder, PAGE_HEAD_FILE);
    } else {
      rmSync(pageHeadPath, { force: true });
    }

    // No combined per-page script file is written here — each widget
    // instance already wrote its OWN tiny script.js above (if it had any
    // Script blocks), and so did each of its OWN components; composeScriptBundle
    // joins the non-lazy ones fresh, in memory, per request (see its doc
    // comment). All the manifest needs to know up front is WHETHER to emit
    // a <script src> tag at all.
    const hasScript = widgets.some((w) => {
      if (w.lazy) return false;
      if (existsSync(join(outDir, w.path, WIDGET_SCRIPT_FILE))) return true;
      return readWidgetComponentManifest(outDir, w.path).some((c) => !c.lazy && existsSync(join(outDir, c.path, WIDGET_SCRIPT_FILE)));
    });

    // Only resolved for build/serve (inlineCss) — dev links per-file
    // <link>s instead (writeShellFiles' own cssHrefs param, discovered from
    // public/ once up front), so a per-page combined list would go unused.
    const pageCssHrefs = inlineCss ? collectCssHrefs(widgets, rootLayoutMeta.type, outDir) : [];
    const version = computePageVersion(widgets, rootLayoutMeta.type, outDir, headPath);

    const manifest: PageManifest = { url: page.url, rootLayoutType: rootLayoutMeta.type, widgets, hasScript, inlineCss, spa, cssHrefs: pageCssHrefs, version };
    if (headPath) manifest.headPath = headPath;
    writeFileSync(join(pageDir, META_FILE), JSON.stringify(manifest, null, 2));
    pageManifests.push(manifest);
  }

  // Written unconditionally (cheap, tiny, idempotent) so they're always
  // real static files under outDir — see ROOT_SCRIPT_JS/APP_SCRIPT_JS/
  // ASSET_WORKER_JS's own doc comments. Pages with no lazy widgets/Dynamic
  // slots simply never link root.js/app.js; asset-worker.js is never
  // linked at all, only instantiated as a Worker on demand.
  const runtimeDir = join(outDir, LAZY_RUNTIME_DIR);
  mkdirSync(runtimeDir, { recursive: true });
  writeFileSync(join(runtimeDir, ROOT_SCRIPT_FILE), ROOT_SCRIPT_JS);
  writeFileSync(join(runtimeDir, APP_SCRIPT_FILE), APP_SCRIPT_JS);
  writeFileSync(join(runtimeDir, ASSET_WORKER_FILE), ASSET_WORKER_JS);
  // dev-only combined file — see DEV_RUNTIME_FILE's own doc comment.
  writeFileSync(join(runtimeDir, DEV_RUNTIME_FILE), `${ROOT_SCRIPT_JS}\n${APP_SCRIPT_JS}`);
  // Opt-in — only written (and so only servable/linkable) when spa: true,
  // matching real streak-forge's own "one file, one loader statement"
  // opt-in design (see cli/spa-router.ts's own doc comment).
  if (spa) writeFileSync(join(runtimeDir, SPA_ROUTER_FILE), SPA_ROUTER_JS);

  // Build/serve only — see minify.ts's own doc comments. One walk finds
  // every widget/component/dynamic-block script.js/bundle.js this run
  // wrote (wherever it lives — no need to track paths as they're written)
  // plus the shared runtime files; ONE batched Bun.build call minifies
  // them all, real AST-based minification, not hand-rolled regex (unlike
  // minifyHtml/minifyCss — see minifyJsFiles' own doc comment on why JS
  // specifically needs that). DEV_RUNTIME_FILE is deliberately excluded —
  // it's dev-only (see its own doc comment), never linked in build/serve.
  if (inlineCss) {
    const jsBasenames = new Set([WIDGET_SCRIPT_FILE, WIDGET_BUNDLE_FILE, ROOT_SCRIPT_FILE, APP_SCRIPT_FILE, ASSET_WORKER_FILE, SPA_ROUTER_FILE]);
    await minifyJsFiles(findFilesByBasename(outDir, jsBasenames), outDir);
  }

  return { pageManifests, sharedBuilt: [...sharedById.keys()] };
}

/** Splices a widget's OWN already-rendered HTML for each of its non-lazy
 *  components — one level, no recursion needed (components can't
 *  themselves contain a ComponentPlaceholder, enforced at build time by
 *  buildWidgetComponents). A widget with no components (no meta.json)
 *  round-trips its HTML unchanged. */
function resolveWidgetComponents(html: string, widgetPath: string, outDir: string): string {
  let out = html;
  for (const c of readWidgetComponentManifest(outDir, widgetPath)) {
    if (c.lazy) continue; // leave the marker as-is for later client-side resolution
    const marker = componentPlaceholderMarkerHtml(c.id, c.type);
    const componentHtmlPath = join(outDir, c.path, HTML_FILE);
    if (!existsSync(componentHtmlPath)) throw new Error(`resolveWidgetComponents: missing ${componentHtmlPath} — did buildPages run first?`);
    out = out.split(marker).join(readFileSync(componentHtmlPath, "utf-8"));
  }
  return out;
}

/** The one non-`.common.` `.css` file under `outDir/<kindDir>/<type>/`, if
 *  any (a widget/component/shell entry with no classNames at all writes
 *  none) — same naming convention `generateWidgetCss`/`mirrorToPublic`
 *  already use (`<Type>.<hash>.css`), just discovered by directory listing
 *  instead of threading the hash through. Returned path is relative to
 *  outDir, matching what a `<link href>`/inline `<style>` read both need. */
function findOwnCssFile(outDir: string, kindDir: string, type: string): string | null {
  const dir = join(outDir, kindDir, type);
  if (!existsSync(dir)) return null;
  const file = readdirSync(dir).find((f) => f.endsWith(".css") && !f.includes(".common."));
  return file ? join(kindDir, type, file) : null;
}

/** The shared "head" bundle (Tailwind base/preflight + root vars — see
 *  css-purge.ts's generateCommonCss) — written once, under whichever head
 *  type happened to be built first (build.ts's own doc comment on this),
 *  so it isn't findable by a fixed path; a shallow walk of outDir/head/*
 *  for the one `*.common.*.css` file is simpler than threading that
 *  build-time choice through to request time. */
function findCommonCssFile(outDir: string): string | null {
  const headDir = join(outDir, "head");
  if (!existsSync(headDir)) return null;
  for (const shellType of readdirSync(headDir)) {
    const dir = join(headDir, shellType);
    if (!statSync(dir).isDirectory()) continue;
    const file = readdirSync(dir).find((f) => f.includes(".common."));
    if (file) return join("head", shellType, file);
  }
  return null;
}

/**
 * Every eager/static piece of a page's own CSS — common bundle + the
 * shell's own (html/head/body/rootLayout) CSS + every NON-lazy widget's
 * own CSS + their own non-lazy components' CSS — resolved to a deduped,
 * ordered list of outDir-relative paths. Called ONCE per page, at build
 * time (buildPages), and persisted onto PageManifest.cssHrefs — the whole
 * point being that the request-time composer (collectInlineCss) never has
 * to touch the filesystem's directory structure itself, just read the
 * paths this already found. Lazy/Dynamic content is deliberately excluded:
 * its CSS is pushed as a real `<link>` by the client at fetch time instead
 * (cli/app-script.ts), not inlined upfront — see this module's own doc
 * comment. A `Set` guards against listing the same file twice (two eager
 * widgets sharing a type, or a component reused across widgets).
 */
function collectCssHrefs(widgets: PageWidgetManifestEntry[], shellType: string, outDir: string): string[] {
  const seen = new Set<string>();
  const hrefs: string[] = [];
  const add = (relPath: string | null): void => {
    if (!relPath || seen.has(relPath)) return;
    seen.add(relPath);
    hrefs.push(relPath);
  };

  add(findCommonCssFile(outDir));
  for (const kindDir of ["html", "head", "body", "rootLayout"]) {
    add(findOwnCssFile(outDir, kindDir, shellType));
  }
  for (const w of widgets) {
    if (w.lazy) continue;
    add(w.cssHref);
    for (const c of readWidgetComponentManifest(outDir, w.path)) {
      if (c.lazy) continue;
      add(findOwnCssFile(outDir, COMPONENTS_DIR, c.type));
    }
  }
  return hrefs;
}

/**
 * A fingerprint of everything this page currently serves — see
 * PageManifest.version's own doc comment for the full "why" (including
 * what this deliberately does NOT yet cover: a shared widget rebuilt in
 * isolation from a page that only references it by `ref`). Hashes the
 * shell's own fragments plus every widget's own already-persisted
 * content.json, in a fixed order, joined with a separator that can't
 * appear in either (so two different splits never hash the same).
 */
function computePageVersion(widgets: PageWidgetManifestEntry[], shellType: string, outDir: string, headPath?: string): string {
  const parts: string[] = [];
  for (const kindDir of ["html", "head", "body", "rootLayout"]) {
    parts.push(readFileOr(join(outDir, kindDir, shellType, HTML_FILE), ""));
  }
  if (headPath) parts.push(readFileOr(join(outDir, headPath), ""));
  for (const w of widgets) {
    parts.push(readFileOr(join(outDir, w.path, CONTENT_FILE), ""));
  }
  return hashOf(parts.join("\u0000"));
}

/**
 * Every eager/static piece of a page's own CSS, combined into one string,
 * meant to be inlined as one `<style>` tag in `<head>` (see
 * composePageFromFiles). Pure manifest read + file reads — no directory
 * scanning, no existence probing: manifest.cssHrefs was already resolved
 * and validated once at build time (collectCssHrefs), so there's nothing
 * left to "check and maybe not find" per request.
 */
function collectInlineCss(manifest: PageManifest, outDir: string): string {
  return manifest.cssHrefs.map((href) => readFileSync(join(outDir, href), "utf-8")).join("\n");
}

/**
 * The request-time composer: pure filesystem READS + string splicing, no
 * render()/dynamic-import and NO disk write — every piece it reads was
 * already persisted by buildPages, and the composed result is never saved
 * anywhere; it's recomputed fresh on every call. Exactly the algorithm
 * described: read the html skeleton, replace its empty `<head></head>`
 * with the real head file, replace its empty `<body></body>` with the
 * real body file (which itself still has every widget's placeholder
 * marker in it), then within that, replace each NON-lazy widget's marker
 * with that widget's own HTML (itself first resolved one level further,
 * splicing in any of ITS OWN non-lazy components — see
 * resolveWidgetComponents) — lazy ones keep their marker in the shipped
 * output, for a client-side runtime to resolve later (not built yet).
 */
/** Shared by composePageFromFiles and composePageAsJson: every fragment
 *  read + widget splice + CSS combine + closing-scripts computation both
 *  need, so the two can never drift apart on what "this page" actually
 *  contains — they only differ in how they ASSEMBLE these pieces (one
 *  whole HTML string vs a JSON shape with head/body kept separate). */
function resolvePageParts(manifest: PageManifest, outDir: string): { headHtml: string; bodyHtml: string; closingScripts: string } {
  const shellType = manifest.rootLayoutType;
  const headHtml = readFileOr(join(outDir, manifest.headPath ?? join("head", shellType, HTML_FILE)), "<head></head>");
  let bodyHtml = readFileOr(join(outDir, "body", shellType, HTML_FILE), "<body></body>");

  for (const w of manifest.widgets) {
    if (w.lazy) {
      // build/serve: stamp the marker with this instance's own direct,
      // static content.json path — the client (cli/root-script.ts's
      // loadLazyWidget) fetches it straight off disk, no server lookup at
      // all. Dev leaves the marker generic (no WIDGET_SRC_ATTR) and falls
      // back to the old /__streak/lazy?page=&id= composed endpoint (see
      // cli/app-script.ts's pump) — matching the same dev-vs-build split
      // used everywhere else in this function.
      if (manifest.inlineCss) {
        const marker = placeholderMarkerHtml(w.id, w.type);
        bodyHtml = bodyHtml.split(marker).join(lazyPlaceholderMarkerHtml(w.id, w.type, w.path, w.shared, manifest.version));
      }
      continue;
    }
    const marker = placeholderMarkerHtml(w.id, w.type);
    const widgetPath = join(outDir, w.path, HTML_FILE);
    if (!existsSync(widgetPath)) throw new Error(`resolvePageParts: missing ${widgetPath} — did buildPages run first?`);
    let widgetHtml = readFileSync(widgetPath, "utf-8");
    widgetHtml = resolveWidgetComponents(widgetHtml, w.path, outDir);
    bodyHtml = bodyHtml.split(marker).join(widgetHtml);
  }

  // Only combine when THIS page was built that way (see
  // BuildPagesOptions.inlineCss) — dev's pages already have their CSS
  // <link>s baked into headHtml at build time (writeShellFiles) and never
  // contain CRITICAL_CSS_PLACEHOLDER at all, so this replace is a no-op
  // for them. Never written to disk anywhere — computed fresh right here,
  // per request, from each widget's own already-persisted (and
  // independently cacheable/rebuildable) CSS file — see collectInlineCss.
  const combinedCss = manifest.inlineCss ? collectInlineCss(manifest, outDir) : "";
  const headWithCss = headHtml.replace(CRITICAL_CSS_PLACEHOLDER, combinedCss ? `<style id="streak-inline-css">${combinedCss}</style>` : "");

  // Same dev-vs-build split as inlineCss (see BuildPagesOptions.inlineCss's
  // own doc comment) — the Lighthouse-motivated loading chain is a
  // build/serve-only concern, not a dev one. Dev rebuilds on every save;
  // paying for indirection there just makes local debugging harder to
  // reason about for no real benefit.
  let closingScripts = "";
  const needsRuntime = manifest.spa || manifest.widgets.some((w) => w.lazy) || bodyHtml.includes(DYNAMIC_SLOT_ATTR);

  if (manifest.inlineCss) {
    // build/serve: matching real streak-forge exactly — the page links ONE
    // deferred script (root.js) — never a direct, unattributed
    // <script src="/common.js"> (render-blocking, the thing that actually
    // hurts a mobile Lighthouse score). root.js's own last step loads
    // app.js (also deferred, see cli/root-script.ts); app.js's own last
    // step loads THIS page's common.js bundle (async, computed from
    // location.pathname — see cli/app-script.ts) and runs the lazy-widget
    // loader. Needed whenever the page has a script bundle at all, not
    // just for lazy/Dynamic/spa content, since common.js itself now only
    // ever loads through this chain.
    // ?v= — see PageManifest.version's own doc comment: this page's own
    // fingerprint, so the CDN/browser can treat this exact URL as
    // immutable-cacheable (a content change here means a new ?v= on the
    // next request, not the same URL serving stale content).
    if (manifest.hasScript || needsRuntime) closingScripts += `<script src="${ROOT_SCRIPT_HREF}?v=${manifest.version}" defer></script>`;
  } else {
    // dev: the old, simple way — direct, un-deferred tags, no chain, no
    // indirection through addResourceToBody, and (unlike build/serve) no
    // root.js/app.js SPLIT either — just one plain tag for DEV_RUNTIME_JS
    // (root.js + app.js concatenated, see its own doc comment). Dev has no
    // Lighthouse score to protect, so there's nothing the two-file split
    // buys it.
    // DEV_RUNTIME_JS goes FIRST, on purpose — it defines the gDom globals
    // (window.loadPackage/loadDynamicComponent/addResourceToBody) a widget's
    // own Script block may call SYNCHRONOUSLY the moment common.js's tag
    // executes (e.g. HelloAnimated's `await gDom.loadPackage(...)`, run
    // immediately as part of buildScriptBundle's IIFE) — if common.js ran
    // first, that call would throw (gDom.loadPackage is not a function
    // yet). Both tags still sit after all the real page content (see
    // composePageFromFiles' own placement), so DEV_RUNTIME_JS running
    // first doesn't break runLazyLoader's DOM scan either way.
    // Stable id — app.js's own internal common.js loader (deferred via its
    // own setTimeout specifically so it runs AFTER this later tag has been
    // parsed, see cli/app-script.ts) checks for this exact id first and
    // skips its own load when it finds it, so common.js never runs twice
    // (once from this direct tag, once from the runtime).
    if (needsRuntime) closingScripts += `<script src="${DEV_RUNTIME_HREF}"></script>`;
    if (manifest.hasScript) closingScripts += `<script id="streak-common-script" src="${pageScriptHref(manifest.url)}"></script>`;
  }
  // spa-router.js stays its own separate, directly-linked script (not
  // chained through app.js) — same "one file, one loader statement, opt-in
  // and independently removable" reasoning as real streak-forge's own
  // spa-router.js. ?v= only for build/serve, same as everywhere else here.
  if (manifest.spa) {
    const versionQuery = manifest.inlineCss ? `?v=${manifest.version}` : "";
    closingScripts += `<script src="${SPA_ROUTER_HREF}${versionQuery}"${manifest.inlineCss ? " defer" : ""}></script>`;
  }

  return { headHtml: headWithCss, bodyHtml, closingScripts };
}

export function composePageFromFiles(manifest: PageManifest, outDir: string): string {
  const shellType = manifest.rootLayoutType;
  const htmlSkeleton = readFileOr(join(outDir, "html", shellType, HTML_FILE), "<html><head></head><body></body></html>");
  const { headHtml, bodyHtml, closingScripts } = resolvePageParts(manifest, outDir);

  let composed = htmlSkeleton.replace("<head></head>", headHtml).replace("<body></body>", bodyHtml);
  if (closingScripts) composed = composed.replace("</body>", `${closingScripts}</body>`);
  return composed;
}

/** Strips a fragment's own outer `<tag ...>`/`</tag>` wrapper, returning
 *  just its inner content — composePageAsJson's `headHtml`/`bodyHtml`
 *  fields need the INNER content only (matching what the SPA router's
 *  `reconcileHead`/`document.body.innerHTML =` each expect — see
 *  cli/spa-router.ts), unlike composePageFromFiles' own htmlSkeleton
 *  splice, which wants the whole tag. */
function stripOuterTag(html: string, tag: string): string {
  return html.replace(new RegExp(`^<${tag}[^>]*>`), "").replace(new RegExp(`</${tag}>$`), "");
}

/**
 * The `index.json` counterpart to composePageFromFiles — same underlying
 * composition (resolvePageParts), shaped for the SPA router's swapPage
 * instead of a single HTML string: `headHtml`/`bodyHtml` are INNER content
 * only (no outer `<head>`/`<body>` tag), attrs come from ATTRS_FILE
 * (written once per shell by writeShellFiles, never recomputed here).
 * Exactly as "never persisted anywhere" as composePageFromFiles itself —
 * computed fresh, per request, from the same already-built fragment files.
 */
export interface ComposedPageJson {
  headHtml: string;
  htmlAttributes: Record<string, string>;
  bodyAttributes: Record<string, string>;
  bodyHtml: string;
  /** Never embedded as a literal `<script>` tag in `bodyHtml` — setting
   *  `.innerHTML` (what the SPA router's swapPage does with this field)
   *  never executes embedded `<script>` tags, the exact bug already fixed
   *  once this session for lazy/Dynamic fragments. The router instead
   *  loads this explicitly, through root.js's addResourceToBody, after
   *  the DOM swap — see cli/spa-router.ts. null when the page has no
   *  script bundle at all. root.js/app.js themselves are NOT included
   *  here: they're already loaded from the real, cold page load and never
   *  need to re-run during an SPA session (their own globals persist). */
  scriptHref: string | null;
}

export function composePageAsJson(manifest: PageManifest, outDir: string): ComposedPageJson {
  const shellType = manifest.rootLayoutType;
  const htmlAttributes = JSON.parse(readFileOr(join(outDir, "html", shellType, ATTRS_FILE), "{}")) as Record<string, string>;
  const bodyAttributes = JSON.parse(readFileOr(join(outDir, "body", shellType, ATTRS_FILE), "{}")) as Record<string, string>;
  const { headHtml, bodyHtml } = resolvePageParts(manifest, outDir);

  return {
    headHtml: stripOuterTag(headHtml, "head"),
    htmlAttributes,
    bodyAttributes,
    bodyHtml: stripOuterTag(bodyHtml, "body"),
    scriptHref: manifest.hasScript ? pageScriptHref(manifest.url) : null,
  };
}

/** The virtual public URL a page's combined script is requested at — pure
 *  function of the url, no file lookup, since PAGE_SCRIPT_FILE is never
 *  actually written to disk (composeScriptBundle produces it on demand). */
export function pageScriptHref(url: string): string {
  return `/${join(cleanUrlToPublicPath(url), PAGE_SCRIPT_FILE)}`;
}

/** Where the SPA router (cli/spa-router.ts) fetches a page's composePageAsJson
 *  shape from — mirrors real streak-forge's own `jsonUrlFor` convention
 *  exactly (`/` -> `/index.json`, `/docs` -> `/docs/index.json`). */
export function pageJsonHref(url: string): string {
  return `/${join(cleanUrlToPublicPath(url), "index.json")}`;
}

/** The reverse of pageJsonHref — given a request pathname ending in
 *  `/index.json`, recovers the page url it's for. Returns null for a
 *  pathname that isn't an index.json request at all. */
export function pageUrlFromJsonPath(pathname: string): string | null {
  if (!pathname.endsWith("/index.json")) return null;
  const stripped = pathname.slice(0, -"/index.json".length);
  return stripped === "" ? "/" : stripped;
}

/** One widget instance's own script.js content plus its non-lazy
 *  components' script.js content, in order — the shared piece between
 *  composeScriptBundle (joins this across every non-lazy widget on the
 *  page) and composeLazyWidgetFragment (uses it for one lazy widget,
 *  fetched separately by the client runtime). */
function widgetScriptParts(outDir: string, widgetPath: string): string[] {
  const parts: string[] = [];
  const scriptPath = join(outDir, widgetPath, WIDGET_SCRIPT_FILE);
  if (existsSync(scriptPath)) parts.push(readFileSync(scriptPath, "utf-8"));
  for (const c of readWidgetComponentManifest(outDir, widgetPath)) {
    if (c.lazy) continue;
    const cScriptPath = join(outDir, c.path, WIDGET_SCRIPT_FILE);
    if (existsSync(cScriptPath)) parts.push(readFileSync(cScriptPath, "utf-8"));
  }
  return parts;
}

/**
 * Composes a page's FULL client-script bundle fresh, in memory, by
 * concatenating every non-lazy widget's own already-persisted script.js
 * fragment (written by writeWidgetFiles/buildPages), PLUS each of that
 * widget's own non-lazy components' script.js fragments — the
 * request-time counterpart to composePageFromFiles, same reasoning:
 * joining a handful of small self-invoking-function strings is cheap
 * enough to redo on every request rather than precompute and persist a
 * combined file.
 */
export function composeScriptBundle(manifest: PageManifest, outDir: string): string {
  const parts: string[] = [];
  for (const w of manifest.widgets) {
    if (w.lazy) continue;
    parts.push(...widgetScriptParts(outDir, w.path));
  }
  return parts.join("\n");
}

/**
 * Builds a lazy/Dynamic fragment's response as a real, self-executing
 * script — not a JSON blob the client has to manually parse and inject.
 * Loaded via a real `<script src>` (cli/app-script.ts's addResourceToBody),
 * so the browser just runs it like any other script: no `innerHTML`
 * (which never executes embedded `<script>` tags — a real bug hit earlier
 * this session) and no manual "revive" step needed at all, since nothing
 * was ever inserted via innerHTML in the first place — the widget's own
 * script runs as a normal, direct function call inside this same script's
 * execution.
 *
 * `cssHref`, when present, is pushed as a real `<link>` FIRST — the whole
 * point being CSP-friendliness (a `<link>`, never an inline `<style>`
 * injected after the fact) and avoiding a flash of unstyled content: the
 * HTML/script only run once that stylesheet has actually loaded (or
 * failed — either way, the widget still appears, just possibly unstyled
 * for an instant on a failed load rather than never at all).
 */
function buildFragmentScript(selector: string, html: string, script: string, cssHref: string | null): string {
  return `(function(){
  var el = document.querySelector(${JSON.stringify(selector)});
  function show(){
    var t=document.createElement("div");
    t.innerHTML=${JSON.stringify(html)};
    // Every top-level node, not just the first: a widget may render
    // several root elements (e.g. a backdrop + a drawer).
    if (el) el.replaceWith.apply(el, Array.prototype.slice.call(t.childNodes));
    (function(){${script}})();
  }
  var cssHref=${JSON.stringify(cssHref)};
  if (cssHref) {
    var link=document.createElement("link");
    link.rel="stylesheet";
    link.href=cssHref;
    link.addEventListener("load", show, {once:true});
    link.addEventListener("error", show, {once:true});
    document.head.appendChild(link);
  } else {
    show();
  }
})();`;
}

/**
 * The lazy-widget counterpart to composePageFromFiles's per-widget splice
 * — fetched by the client runtime (cli/app-script.ts) at LAZY_FRAGMENT_HREF
 * instead of being spliced in at page-compose time. Same reads as the
 * eager path (resolveWidgetComponents splices in any of ITS OWN non-lazy
 * nested components, unchanged), just wrapped as a real executable script
 * (see buildFragmentScript) instead of concatenated into the page. Returns
 * null for an unknown id or a non-lazy one — callers (the HTTP route) turn
 * that into a 404.
 */
export function composeLazyWidgetFragment(manifest: PageManifest, widgetId: string, outDir: string): string | null {
  const w = manifest.widgets.find((entry) => entry.id === widgetId && entry.lazy);
  if (!w) return null;
  const widgetHtmlPath = join(outDir, w.path, HTML_FILE);
  if (!existsSync(widgetHtmlPath)) return null;
  const html = resolveWidgetComponents(readFileSync(widgetHtmlPath, "utf-8"), w.path, outDir);
  const script = widgetScriptParts(outDir, w.path).join("\n");
  return buildFragmentScript(`[${WIDGET_PLACEHOLDER_ATTR}="${widgetId}"]`, html, script, w.cssHref ? `/${w.cssHref}` : null);
}

/**
 * The `<Dynamic>` counterpart to composeLazyWidgetFragment — fetched by
 * the client runtime's `gDom.loadDynamicComponent(id, callback)` at
 * DYNAMIC_FRAGMENT_HREF. Simpler than the lazy-widget path: no page
 * manifest lookup needed at all, since extractDynamicBlocks (buildPages)
 * already persisted this flat, by id, independent of any page/widget —
 * just a direct file read. Returns null for an unknown id, same contract
 * as composeLazyWidgetFragment (callers turn that into a 404).
 */
export function composeDynamicFragment(id: string, outDir: string): string | null {
  const dir = join(DYNAMIC_DIR, id);
  const htmlPath = join(outDir, dir, HTML_FILE);
  if (!existsSync(htmlPath)) return null;
  const html = readFileSync(htmlPath, "utf-8");
  const scriptPath = join(outDir, dir, WIDGET_SCRIPT_FILE);
  const script = existsSync(scriptPath) ? readFileSync(scriptPath, "utf-8") : "";
  // Dynamic content shares its owning widget's CSS file (already loaded —
  // inlined if the owner is eager, or already pushed by the owner's own
  // lazy fetch if not) — no separate CSS push needed here.
  return buildFragmentScript(`[${DYNAMIC_SLOT_ATTR}="${id}"]`, html, script, null);
}
