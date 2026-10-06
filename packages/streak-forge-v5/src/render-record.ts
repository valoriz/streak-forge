/**
 * `streak-forge/render` — stage 1 of a streak-boot build: render a release's
 * prebuilt widgets and record the results, nothing else. Runs where client
 * code runs (the stage-1 container), so it carries none of the page build
 * (composition, CSS, minify); that is streak-boot's stage 2, which replays
 * these records.
 *
 * The record format is a contract with streak-boot (render-plan.ts /
 * vnode-codec.ts there): the same keys (`renderKey`, `STAGE_PROJECT_ROOT`,
 * `hashValue`) and the same encoding. Changing either side means changing
 * both; the stage-1 container test (record here, replay there, compare with
 * a direct build) catches a mismatch.
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { basename, extname, join, resolve } from "node:path";
import { hashValue } from "./hash";
import { ComponentPlaceholder, Dynamic, Fragment, SCRIPT_BLOCK, WidgetPlaceholder, isKind, type VNode, type VNodeChild } from "./jsx";
import type { ComponentMeta, Registry, ShellMeta, SharedWidgetEntry, SitemapPageEntry, WidgetMeta } from "./types";

export type { Registry, SharedWidgetEntry, SitemapPageEntry } from "./types";

// ---------------------------------------------------------------------------
// Reading a prebuild (no TypeScript, no scanning: what `streak-forge prebuild`
// wrote is read back as-is)
// ---------------------------------------------------------------------------

/** Project root both stages resolve registry paths against: streak-forge
 *  stores each entry's filePath relative to the project, and record keys
 *  include the resolved path, so stage 1 and stage 2 (each with the prebuild
 *  in a different folder) must use the same root. Not a real directory. */
export const STAGE_PROJECT_ROOT = "/streak-project";

const REGISTRY_MARKER = "streak-boot.registry.json";
const KIND_DIRS = ["widgets", "components", "handlers", "html", "head", "body", "rootLayout"] as const;

function entries(dir: string): string[] {
  try {
    return readdirSync(dir);
  } catch {
    return [];
  }
}

/** The registry of an unpacked prebuild (`<prebuildDir>/<kind>/<name>/meta.json`). */
export function readPrebuildRegistry(prebuildDir: string, projectRoot = STAGE_PROJECT_ROOT): Registry | null {
  const markerPath = join(prebuildDir, REGISTRY_MARKER);
  if (!existsSync(markerPath)) return null;
  const marker = JSON.parse(readFileSync(markerPath, "utf-8")) as { version: number; generatedAt: string };
  if (marker.version !== 1) throw new Error(`${REGISTRY_MARKER} has version ${marker.version}, expected 1`);

  const registry: Registry = {
    version: 1,
    generatedAt: marker.generatedAt,
    widgets: {},
    handlers: {},
    components: {},
    html: {},
    head: {},
    body: {},
    rootLayout: {},
    fileHashes: {},
  };
  const load = <T extends { filePath: string }>(kind: (typeof KIND_DIRS)[number], keyOf: (meta: T) => string, target: Record<string, T>) => {
    for (const name of entries(join(prebuildDir, kind))) {
      const metaPath = join(prebuildDir, kind, name, "meta.json");
      if (!existsSync(metaPath)) continue;
      const entry = JSON.parse(readFileSync(metaPath, "utf-8")) as { meta: T; sourceFileHash?: string };
      entry.meta.filePath = resolve(projectRoot, entry.meta.filePath);
      target[keyOf(entry.meta)] = entry.meta;
      if (entry.sourceFileHash) registry.fileHashes[entry.meta.filePath] = entry.sourceFileHash;
    }
  };
  load<WidgetMeta>("widgets", (m) => m.type, registry.widgets);
  load("handlers", (m: { exportName: string; filePath: string }) => m.exportName, registry.handlers as never);
  load<ComponentMeta>("components", (m) => m.type, registry.components);
  load<ShellMeta>("html", (m) => m.type, registry.html);
  load<ShellMeta>("head", (m) => m.type, registry.head);
  load<ShellMeta>("body", (m) => m.type, registry.body);
  load<ShellMeta>("rootLayout", (m) => m.type, registry.rootLayout);
  return registry;
}

type RenderEntry = { filePath: string; exportName: string };

/** A `render(entry, props)` that imports the prebuilt bundle of `entry`
 *  (`<prebuildDir>/<kind>/<Type>/<Type>.<hash>.js`) and calls its export. */
export function renderFromPrebuild(
  prebuildDir: string,
  fileHashes: Record<string, string>,
): (entry: RenderEntry, props: Record<string, unknown>) => Promise<unknown> {
  return async (entry, props) => {
    const hash = fileHashes[entry.filePath];
    if (!hash) throw new Error(`no file hash recorded for ${entry.filePath} (stale or mismatched registry?)`);
    const type = basename(entry.filePath, extname(entry.filePath));
    const bundlePath = KIND_DIRS.map((kind) => join(prebuildDir, kind, type, `${type}.${hash}.js`)).find((p) => existsSync(p));
    if (!bundlePath) throw new Error(`no prebuilt bundle for "${type}" in ${prebuildDir}`);
    const mod = (await import(bundlePath)) as Record<string, (props: unknown) => unknown>;
    const fn = mod[entry.exportName];
    if (!fn) throw new Error(`${bundlePath}: no export named "${entry.exportName}"`);
    return fn(props);
  };
}

// ---------------------------------------------------------------------------
// Planning: which renders a build / a page needs
// ---------------------------------------------------------------------------

export type RenderKind = "vnode" | "attrs";

export interface RenderCall {
  entry: RenderEntry;
  props: Record<string, unknown>;
  kind: RenderKind;
}

export type EncodedRender = { kind: "vnode"; value: unknown } | { kind: "attrs"; value: Record<string, unknown> };
export type RenderRecord = Record<string, EncodedRender>;

export function renderKey(entry: RenderEntry, props: Record<string, unknown>): string {
  return `${entry.filePath}#${entry.exportName}:${hashValue(props)}`;
}

function lookup<T>(map: Record<string, T>, type: string, what: string, context: string): T {
  const meta = map[type];
  if (!meta) throw new Error(`${context}: no registered ${what} with type "${type}"`);
  return meta;
}

function resolveRootLayout(registry: Registry, page: SitemapPageEntry): ShellMeta {
  const types = Object.keys(registry.rootLayout);
  const wanted = page.rootLayout ?? (types.length === 1 ? types[0] : undefined);
  if (!wanted) throw new Error(`page "${page.url}": no rootLayout specified and the project has ${types.length} rootLayout() entries`);
  return lookup(registry.rootLayout, wanted, "rootLayout", `page "${page.url}"`);
}

/** Distinct rootLayout values ("" = the project's default) -> shell types. */
export function shellTypesFor(registry: Registry, rootLayouts: string[]): string[] {
  return [...new Set(rootLayouts.map((rootLayout) => resolveRootLayout(registry, { url: "/", widgets: [], ...(rootLayout ? { rootLayout } : {}) }).type))];
}

/** Once per build: shared widgets (+ their components) and the shells of the
 *  rootLayout types in use. */
export function planSetupRenders(registry: Registry, shared: SharedWidgetEntry[], shellTypes: string[]): RenderCall[] {
  const calls: RenderCall[] = [];
  for (const entry of shared) {
    const context = `shared widget "${entry.id}"`;
    calls.push({ entry: lookup(registry.widgets, entry.type, "widget", context), props: entry.props ?? {}, kind: "vnode" });
    for (const c of entry.components ?? []) {
      calls.push({ entry: lookup(registry.components, c.type, "component", `${context}, component "${c.id}"`), props: c.props ?? {}, kind: "vnode" });
    }
  }
  for (const shellType of shellTypes) {
    lookup(registry.rootLayout, shellType, "rootLayout", "setup");
    const { html, head, body, rootLayout } = registry;
    if (html[shellType]) calls.push({ entry: html[shellType], props: {}, kind: "attrs" });
    if (head[shellType]) calls.push({ entry: head[shellType], props: {}, kind: "vnode" });
    if (body[shellType]) calls.push({ entry: body[shellType], props: {}, kind: "attrs" });
    if (rootLayout[shellType]) calls.push({ entry: rootLayout[shellType], props: {}, kind: "vnode" });
  }
  return calls;
}

/** One page: its inline widgets (+ components), its rootLayout, and its own
 *  head when it has metadata. */
export function planPageRenders(registry: Registry, page: SitemapPageEntry): RenderCall[] {
  const calls: RenderCall[] = [];
  for (const w of page.widgets) {
    if ("ref" in w) continue; // shared: rendered by the setup job
    const context = `page "${page.url}", widget "${w.id}"`;
    calls.push({ entry: lookup(registry.widgets, w.type, "widget", context), props: { data: page.metadata ?? {} }, kind: "vnode" });
    for (const c of w.components ?? []) {
      calls.push({ entry: lookup(registry.components, c.type, "component", `${context}, component "${c.id}"`), props: c.props ?? {}, kind: "vnode" });
    }
  }
  const rootLayout = resolveRootLayout(registry, page);
  calls.push({ entry: rootLayout, props: {}, kind: "vnode" });
  const head = registry.head[rootLayout.type];
  if (head && page.metadata) calls.push({ entry: head, props: { data: page.metadata }, kind: "vnode" });
  return calls;
}

// ---------------------------------------------------------------------------
// Recording: run, resolve nested components, encode
// ---------------------------------------------------------------------------

type MarkerName = "dynamic" | "widget-placeholder" | "component-placeholder";

function markerName(type: unknown): MarkerName | null {
  if (isKind(type, Dynamic)) return "dynamic";
  if (isKind(type, WidgetPlaceholder)) return "widget-placeholder";
  if (isKind(type, ComponentPlaceholder)) return "component-placeholder";
  return null;
}

/** Calls every nested function component (not the Dynamic/placeholder
 *  markers), so the tree is JSON-encodable; nested handlers run here. */
export async function resolveVNode(node: VNodeChild): Promise<VNodeChild> {
  if (node === null || node === undefined || typeof node !== "object") return node;
  if (Array.isArray(node)) return Promise.all(node.map(resolveVNode));
  const { type, props } = node;
  if (typeof type === "function" && !markerName(type)) return resolveVNode(await type(props));
  const children = props?.children as VNodeChild;
  if (children === undefined) return node;
  return { type, props: { ...props, children: await resolveVNode(children) } };
}

function encodeType(type: VNode["type"]): string {
  if (typeof type === "string") return type;
  if (type === Fragment) return "#fragment";
  if (type === SCRIPT_BLOCK) return "#script";
  const marker = markerName(type);
  if (marker) return `#${marker}`;
  throw new Error("render-record: unresolved function component in tree (call resolveVNode first)");
}

/** Resolved tree -> JSON value: `{ t, p }` per node, `t` = tag or "#<marker>". */
export function encodeVNodeTree(node: VNodeChild): unknown {
  if (node === undefined) return null;
  if (node === null || typeof node !== "object") return node;
  if (Array.isArray(node)) return node.map(encodeVNodeTree);
  const { children, ...rest } = node.props ?? {};
  const p: Record<string, unknown> = rest;
  if (children !== undefined) p.children = encodeVNodeTree(children as VNodeChild);
  return { t: encodeType(node.type), p };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/** Runs each call once (repeats by key skipped), adding the encoded result
 *  to `into`. */
export async function recordRenders(
  calls: RenderCall[],
  render: (entry: RenderEntry, props: Record<string, unknown>) => Promise<unknown>,
  into: RenderRecord = {},
): Promise<RenderRecord> {
  for (const call of calls) {
    const key = renderKey(call.entry, call.props);
    if (key in into) continue;
    const result = await render(call.entry, call.props);
    if (call.kind === "attrs") {
      if (!isPlainObject(result)) throw new Error(`${call.entry.exportName} (${call.entry.filePath}): html()/body() must return a plain attribute object`);
      into[key] = { kind: "attrs", value: JSON.parse(JSON.stringify(result)) as Record<string, unknown> };
    } else {
      into[key] = { kind: "vnode", value: encodeVNodeTree(await resolveVNode(result as VNodeChild)) };
    }
  }
  return into;
}
