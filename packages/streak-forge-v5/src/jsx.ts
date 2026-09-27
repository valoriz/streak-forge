/**
 * Minimal, self-contained JSX runtime so widgets can be authored as real
 * TSX components — `<div className="...">...</div>` — instead of building
 * HTML strings by hand. Zero-runtime on the browser side: this only runs at
 * build/render time to turn a VNode tree into an HTML string, same shape
 * streak-forge's own jsx-runtime uses ({ type, props }), so widget authoring
 * conventions (className, style-as-object) carry over even though this
 * package doesn't depend on streak-forge directly — bundling/composition
 * stays streak-forge's job, this is only enough to make `widget()`-wrapped
 * TSX functions produce real HTML for CSS-purge sampling and fragment
 * rendering within streak-forge itself.
 */

export const Fragment = Symbol.for("streak-forge.fragment");
const SCRIPT_BLOCK = Symbol.for("streak-forge.script-block");

export type VNodeChild = VNode | string | number | boolean | null | undefined | VNodeChild[];

export interface VNode {
  // `any` here on purpose, not `Record<string, unknown>`: a specific
  // component's props type (e.g. WidgetPlaceholderProps) is contravariantly
  // incompatible with an index-signature type, same reasoning as hoc.ts's
  // widget/handler/component generics — `any` keeps real component prop
  // types usable as JSX tags instead of forcing every component to widen
  // its own props to Record<string, unknown>.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  type: string | ((props: any) => VNodeChild) | typeof Fragment | typeof SCRIPT_BLOCK;
  props: Record<string, unknown>;
}

export function jsx(type: VNode["type"], props: Record<string, unknown> | null): VNode {
  return { type, props: props ?? {} };
}
export const jsxs = jsx;

// eslint-disable-next-line @typescript-eslint/no-namespace
export namespace JSX {
  export type Element = VNode;
  export interface IntrinsicElements {
    [elemName: string]: Record<string, unknown>;
  }
  export interface ElementChildrenAttribute {
    children: unknown;
  }
  /** Accepted on any component tag (list rendering), never rendered. */
  export interface IntrinsicAttributes {
    key?: unknown;
  }
}

const VOID_TAGS = new Set([
  "area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param", "source", "track", "wbr",
]);
const SKIP_PROPS = new Set(["children", "dangerouslySetInnerHTML", "key", "ref"]);

function escapeText(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
function escapeAttr(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
}
// Inline <script>/<style> text ends at the first "</script"/"</style" as
// far as the HTML parser is concerned, even inside a JS string. Escaping
// "</script" -> "<\/script" and "<!--" -> "<\!--" is byte-equivalent to a
// JS engine but invisible to the HTML parser. Same as v4 (streak-forge-legacy).
function escapeRawTextElementContent(text: string): string {
  return text.replace(/<!--/g, "<\\!--").replace(/<\/(script|style)/gi, "<\\/$1");
}
// <script>/<style> children are literal text — never HTML-escaped
// (`if (a < b)` must stay `<`, not `&lt;`).
function rawTextChildren(children: unknown): string {
  if (children === null || children === undefined || typeof children === "boolean") return "";
  if (Array.isArray(children)) return children.map(rawTextChildren).join("");
  return String(children);
}
function kebabCase(key: string): string {
  return key.replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase();
}
function styleToCss(style: Record<string, unknown>): string {
  return Object.entries(style)
    .filter(([, v]) => v !== null && v !== undefined && v !== false)
    .map(([k, v]) => `${k.startsWith("--") ? k : kebabCase(k)}:${String(v)}`)
    .join(";");
}
/** Exported for page-build.ts's composeFullPage — the same attr-to-string
 *  logic (className -> class, style object -> CSS text, ...) used to
 *  render `<html {...}>`/`<body {...}>` from html()/body()'s plain
 *  attribute-object return value, which never goes through a real VNode. */
export function renderAttrs(props: Record<string, unknown>): string {
  let out = "";
  for (const key in props) {
    if (SKIP_PROPS.has(key) || /^on[A-Z]/.test(key)) continue; // event handlers are client-only; use a Script block
    const value = props[key];
    if (value === null || value === undefined || value === false) continue;
    const attrName = key === "className" ? "class" : key === "htmlFor" ? "for" : key;
    if (value === true) {
      out += ` ${attrName}`;
      continue;
    }
    if (attrName === "style" && typeof value === "object") {
      out += ` style="${escapeAttr(styleToCss(value as Record<string, unknown>))}"`;
      continue;
    }
    out += ` ${attrName}="${escapeAttr(String(value))}"`;
  }
  return out;
}

export async function renderToString(node: VNodeChild): Promise<string> {
  if (node === null || node === undefined || typeof node === "boolean") return "";
  if (typeof node === "string") return escapeText(node);
  if (typeof node === "number") return String(node);
  if (Array.isArray(node)) return (await Promise.all(node.map(renderToString))).join("");

  const { type, props } = node;
  // An unresolved placeholder (page-build.ts's composePage didn't run
  // resolvePlaceholders first) has no widget content to show — render
  // nothing rather than recursing into WidgetPlaceholder itself, which
  // would just return another identical placeholder VNode forever.
  if (isKind(type, WidgetPlaceholder)) return "";
  // Same reasoning, one level down: a widget's own ComponentPlaceholder is
  // always turned into a marker <div> by page-build.ts's buildPages before
  // this ever runs — this guard is only a defensive fallback.
  if (isKind(type, ComponentPlaceholder)) return "";
  // A Dynamic block's children are extracted out to their own persisted
  // fragment and the node itself replaced with a plain marker <div> by
  // page-build.ts's buildPages, same timing as WidgetPlaceholder/
  // ComponentPlaceholder above — this guard is only a defensive fallback.
  if (isKind(type, Dynamic)) return "";
  // Never rendered inline — collectScripts() (below) extracts it out of the
  // tree separately; see Script()'s own doc comment for why.
  if (type === SCRIPT_BLOCK) return "";
  if (typeof type === "function") return renderToString(await type(props));

  const children = (props?.children as VNodeChild) ?? null;
  if (type === Fragment) return renderToString(children);

  const attrs = renderAttrs(props ?? {});
  if (VOID_TAGS.has(type)) return `<${type}${attrs}>`;
  const isRawText = type === "script" || type === "style";
  const innerHtml = (props?.dangerouslySetInnerHTML as { __html?: unknown } | undefined)?.__html;
  let inner: string;
  if (innerHtml !== null && innerHtml !== undefined) inner = String(innerHtml);
  else if (isRawText) inner = rawTextChildren(children);
  else inner = await renderToString(children);
  if (isRawText) inner = escapeRawTextElementContent(inner);
  return `<${type}${attrs}>${inner}</${type}>`;
}

export interface WidgetPlaceholderProps {
  /** This page's own instance id for the slot — matches a
   *  PageWidgetManifestEntry.id (see types.ts). */
  id: string;
  /** Widget type to resolve into this slot. */
  type: string;
}

/**
 * Marks where a page's widget content gets spliced in — same idea as
 * streak-forge's own `WidgetPlaceholder`. A real component (not a magic
 * string tag), so it's ordinary JSX inside a `rootLayout()`:
 * `<WidgetPlaceholder id="nav-1" type="Nav" />`. Never actually rendered
 * for its own sake — `renderToString` treats it as empty by default (see
 * above); `resolvePlaceholders` (below) is what a real page build uses to
 * replace it with the widget's actual content before the final
 * `renderToString` pass.
 */
export function WidgetPlaceholder(props: WidgetPlaceholderProps): VNode {
  return { type: WidgetPlaceholder, props: props as unknown as Record<string, unknown> };
}

export interface ComponentPlaceholderProps {
  /** This widget instance's own id for the slot — matches a
   *  WidgetComponentManifestEntry.id (see types.ts). */
  id: string;
  /** Component type to resolve into this slot. */
  type: string;
}

/**
 * Marks where a widget's OWN common-component content gets spliced in —
 * the exact same idea as `WidgetPlaceholder`, one level down: a widget's
 * TSX writes `<ComponentPlaceholder id="btn-1" type="Button" />` instead
 * of rendering `<Button .../>` directly, so that component usage gets the
 * same treatment a widget gets inside a page — its own registered sitemap
 * entry (declared in that widget's own `components[]`), its own persisted
 * output, built separately even when two different widgets use the same
 * component type. Never actually rendered for its own sake (see
 * `renderToString` above); components are strictly one level deep — a
 * component's own render output must never contain another
 * `ComponentPlaceholder` (page-build.ts's buildPages enforces this).
 */
export function ComponentPlaceholder(props: ComponentPlaceholderProps): VNode {
  return { type: ComponentPlaceholder, props: props as unknown as Record<string, unknown> };
}

export interface DynamicProps {
  /** Globally unique across the whole build — the client calls
   *  `gDom.loadDynamicComponent(id, callback)` with just this id, no other
   *  context, so it doubles as the persisted fragment's own folder name
   *  (`outDir/dynamic/<id>/`, see page-build.ts's extractDynamicBlocks). */
  id: string;
  children?: VNodeChild;
}

/**
 * Marks a block that's excluded from its owning widget's initial HTML and
 * fetched only on explicit client-side demand (a click, a scroll, a delay
 * — author's choice) via `gDom.loadDynamicComponent(id, callback)` — same
 * idea as real streak-forge's own `<Dynamic>`. Unlike WidgetPlaceholder/
 * ComponentPlaceholder, its children are real, inline JSX using the
 * widget's own render-time data — page-build.ts's buildPages extracts
 * them out to their own persisted fragment and replaces this node with a
 * plain `<div data-dynamic-slot="id">` before the widget's own
 * `renderToString` pass ever runs (see extractDynamicBlocks there).
 */
export function Dynamic(props: DynamicProps): VNode {
  if (!props.id) throw new Error("Dynamic: id is required");
  return { type: Dynamic, props: props as unknown as Record<string, unknown> };
}

// Placeholder/Dynamic nodes are recognized by a KIND tag, not only by
// function identity: streak-forge and streak-boot each ship their own copy
// of this file, and a VNode built by one (a shell/widget bundle importing
// streak-forge) must still be recognized by the other (streak-boot's
// page build). Same global Symbol.for key in both copies.
const KIND = Symbol.for("streak-forge.kind");
(WidgetPlaceholder as unknown as Record<symbol, string>)[KIND] = "widget-placeholder";
(ComponentPlaceholder as unknown as Record<symbol, string>)[KIND] = "component-placeholder";
(Dynamic as unknown as Record<symbol, string>)[KIND] = "dynamic";

/** True if `type` is `marker` itself, or the other package's copy of it. */
export function isKind(type: unknown, marker: (props: never) => VNode): boolean {
  if (type === marker) return true;
  if (typeof type !== "function") return false;
  const kind = (type as unknown as Record<symbol, string | undefined>)[KIND];
  return kind !== undefined && kind === (marker as unknown as Record<symbol, string | undefined>)[KIND];
}

export type PlaceholderResolver = (id: string, type: string) => Promise<VNodeChild> | VNodeChild;
/** Either `WidgetPlaceholder` or `ComponentPlaceholder` — the marker
 *  function identity `resolvePlaceholders`/`collectPlaceholderIds` match
 *  against, kept generic so the identical walk serves both the page level
 *  (rootLayout -> widgets) and the widget level (widget -> components). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type PlaceholderMarker = (props: any) => VNode;

/**
 * Walks a VNode tree (a rootLayout()'s rendered output, or a widget's own)
 * and replaces every `<marker id type/>` (WidgetPlaceholder or
 * ComponentPlaceholder) with whatever `resolve(id, type)` returns,
 * producing a new tree with every slot filled — hand that to
 * `renderToString` for the final HTML. Doesn't call into function
 * components (Button, a widget, ...) along the way; it only recurses
 * through plain-element/array structure, since placeholders are expected
 * to sit directly in their own owner's markup, not nested inside another
 * component's internals. A tree with no matching placeholders round-trips
 * unchanged.
 */
export async function resolvePlaceholders(node: VNodeChild, marker: PlaceholderMarker, resolve: PlaceholderResolver): Promise<VNodeChild> {
  if (node === null || node === undefined || typeof node === "boolean" || typeof node === "string" || typeof node === "number") {
    return node;
  }
  if (Array.isArray(node)) return Promise.all(node.map((child) => resolvePlaceholders(child, marker, resolve)));

  const { type, props } = node;
  if (isKind(type, marker)) {
    const { id, type: markedType } = props as unknown as WidgetPlaceholderProps;
    return resolve(id, markedType);
  }

  const children = props?.children as VNodeChild;
  if (children === undefined) return node;
  return { type, props: { ...props, children: await resolvePlaceholders(children, marker, resolve) } };
}

export interface ScriptProps<O extends Record<string, unknown> = Record<string, unknown>> {
  id: string;
  /** The ONLY bridge from server-rendered values to browser code — the
   *  function is serialized via source-text extraction (see below), so
   *  anything it closes over vanishes; pass what it needs through here
   *  instead, JSON-serialized into the emitted script. */
  options?: O;
  children: (gDom: Window, options: O) => void;
}

/**
 * Client-side interactivity — same idea as streak-forge's own `<Script>`
 * (see the context doc): never rendered inline into a widget's own HTML
 * output. `page-build.ts`'s `collectScripts` extracts every Script block
 * out of each widget instance's VNode tree at build time and merges them
 * into that PAGE's one shared script file — matching streak-forge/
 * streak-distiller's own convention of merging eager-widget scripts into a
 * single per-page bundle, not shipping one `.js` file per widget.
 *
 * Source-text extraction here is `Function.prototype.toString()` on the
 * `children` function, captured immediately (not deferred) — simpler than
 * streak-forge's own build-time source-text transform (a Bun `onLoad`
 * plugin), at the cost of not surviving minification of the widget's own
 * bundle. Fine for this reference package, which doesn't minify widget
 * source by default; a fork wanting that would need the same build-time
 * transform streak-forge uses.
 */
export function Script<O extends Record<string, unknown> = Record<string, unknown>>(props: ScriptProps<O>): VNode {
  const fnSource = typeof props.children === "function" ? props.children.toString() : String(props.children);
  const optionsJson = JSON.stringify(props.options ?? {});
  return { type: SCRIPT_BLOCK, props: { id: props.id, fnSource, optionsJson } };
}

export interface CollectedScript {
  id: string;
  fnSource: string;
  optionsJson: string;
}

/**
 * Walks a VNode tree (a single widget instance's own render output) and
 * collects every `<Script id>` block found. Unlike collectPlaceholderIds
 * (valid staying shallow — a rootLayout's WidgetPlaceholders always sit
 * directly in its own markup), this HAS to call into nested function
 * components — a Script block routinely lives inside a composed
 * sub-component (e.g. `<Button/>` inside `<ProductCard/>`), not in the
 * widget's own top-level JSX. Mirrors `renderToString`'s real traversal
 * (including its WidgetPlaceholder guard — WidgetPlaceholder itself IS a
 * function, so without that check `typeof type === "function"` would call
 * it and get the identical marker back forever) but collects instead of
 * stringifying. Called once per widget instance during page-build.ts's
 * buildPages, same scope as that instance's own renderToString call for
 * its content.json.
 */
export async function collectScripts(node: VNodeChild, out: CollectedScript[] = []): Promise<CollectedScript[]> {
  if (node === null || node === undefined || typeof node === "boolean" || typeof node === "string" || typeof node === "number") {
    return out;
  }
  if (Array.isArray(node)) {
    for (const child of node) await collectScripts(child, out);
    return out;
  }

  const { type, props } = node;
  if (type === SCRIPT_BLOCK) {
    out.push(props as unknown as CollectedScript);
    return out;
  }
  if (isKind(type, WidgetPlaceholder) || isKind(type, ComponentPlaceholder) || isKind(type, Dynamic)) return out; // nothing to descend into
  if (typeof type === "function") {
    await collectScripts(await type(props), out);
    return out;
  }

  const children = props?.children as VNodeChild;
  if (children !== undefined) await collectScripts(children, out);
  return out;
}
