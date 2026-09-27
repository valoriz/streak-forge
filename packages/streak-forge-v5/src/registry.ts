import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from "node:fs";
import { join, dirname, resolve, relative, sep } from "node:path";
import ts from "typescript";
import type { Registry, WidgetMeta, HandlerMeta, ComponentMeta, ShellMeta } from "./types.js";
import { hashOf } from "./hash.js";
import { parseFile } from "./annotations.js";
import { walkFiles } from "./fs-utils.js";

// Small top-level marker — just version + generatedAt. The actual
// widget/handler/component/html/head/body payload lives one-folder-per-entry
// under WIDGETS_DIR/HANDLERS_DIR/COMPONENTS_DIR/... (see saveRegistry/
// loadRegistry below), not in this file.
// NOT renamed to match this package's own name — this is the on-disk file
// FORMAT contract with the streak-boot package (streakjs repo): this
// package writes it, streak-boot's own registry.ts reads it. Changing the
// filename here without changing it there breaks that contract.
const REGISTRY_MARKER_PATH = "streak-boot.registry.json";
const WIDGETS_DIR = "widgets";
const HANDLERS_DIR = "handlers";
const COMPONENTS_DIR = "components";
const HTML_DIR = "html";
const HEAD_DIR = "head";
const BODY_DIR = "body";
const ROOT_LAYOUT_DIR = "rootLayout";
const META_FILE = "meta.json";

/** On-disk shape of one entry's meta.json — the meta itself plus its source
 *  file's content hash, so `fileHashes` (used by incremental rescans) can
 *  be reconstructed on load without a separate index file. */
interface PersistedEntry<T> {
  meta: T;
  sourceFileHash: string;
}

/**
 * Full scan — used by the static build path (pre-build), matches
 * streak-forge's own build-time classpath-scan idea. Walks every
 * widget/handler/component/html/head/body file once, builds registry.json
 * (the "beans" Spring would register). `componentsDir`/`shellDir` are
 * optional — a project with no shared-components or doc-shell dir yet just
 * doesn't pass them. `shellDir` is scanned for `html()`/`head()`/`body()`
 * — one dir, since a project normally has at most one of each.
 */
export function fullScan(widgetsDir: string, handlersDir: string, componentsDir?: string, shellDir?: string): Registry {
  const widgetFiles = walkFiles(widgetsDir, [".tsx", ".ts"]);
  const handlerFiles = walkFiles(handlersDir, [".ts"]);
  const componentFiles = componentsDir ? walkFiles(componentsDir, [".tsx", ".ts"]) : [];
  const shellFiles = shellDir ? walkFiles(shellDir, [".tsx", ".ts"]) : [];
  const allFiles = [...widgetFiles, ...handlerFiles, ...componentFiles, ...shellFiles];

  const widgets: Record<string, WidgetMeta> = {};
  const handlers: Record<string, HandlerMeta> = {};
  const components: Record<string, ComponentMeta> = {};
  const html: Record<string, ShellMeta> = {};
  const head: Record<string, ShellMeta> = {};
  const body: Record<string, ShellMeta> = {};
  const rootLayout: Record<string, ShellMeta> = {};
  const fileHashes: Record<string, string> = {};

  for (const file of allFiles) {
    const content = readFileSync(file, "utf-8");
    fileHashes[file] = hashOf(content);
    const parsed = parseFile(file);
    for (const w of parsed.widgets) widgets[w.type] = w;
    for (const h of parsed.handlers) handlers[h.exportName] = h;
    for (const c of parsed.components) components[c.type] = c;
    for (const e of parsed.html) html[e.type] = e;
    for (const e of parsed.head) head[e.type] = e;
    for (const e of parsed.body) body[e.type] = e;
    for (const e of parsed.rootLayout) rootLayout[e.type] = e;
  }

  return {
    version: 1,
    generatedAt: new Date().toISOString(),
    widgets,
    handlers,
    components,
    html,
    head,
    body,
    rootLayout,
    fileHashes,
  };
}

/** One (dirName, record, keyFn) triple per registry category — shared by
 *  saveRegistry/loadRegistry so the 7 categories don't hand-duplicate the
 *  same "one folder per entry" read/write loop seven times over. */
function categories(registry: Registry) {
  return [
    { dir: WIDGETS_DIR, record: registry.widgets },
    { dir: HANDLERS_DIR, record: registry.handlers },
    { dir: COMPONENTS_DIR, record: registry.components },
    { dir: HTML_DIR, record: registry.html },
    { dir: HEAD_DIR, record: registry.head },
    { dir: BODY_DIR, record: registry.body },
    { dir: ROOT_LAYOUT_DIR, record: registry.rootLayout },
  ] as const;
}

/**
 * Persists one folder per entry (`widgets/<Type>/meta.json`,
 * `handlers/<exportName>/meta.json`, `head/<Type>/meta.json`, ...) instead
 * of one big registry.json — each entry's meta.json lands in the same
 * folder css-purge.ts/js-bundle.ts write that entry's purged CSS/bundled JS
 * into, so "everything about ProductCard" is one directory instead of
 * scattered across a flat outDir. Only a small marker file (version +
 * generatedAt) stays at the top level.
 *
 * `filePath` is written relative to `projectRoot` (forward slashes, e.g.
 * `src/widgets/Hero.tsx`): the output folder stays valid when copied to
 * another machine or directory, and no local absolute path leaks into it.
 * loadRegistry resolves it back against its own `projectRoot`.
 */
export function saveRegistry(registry: Registry, outDir = ".", projectRoot = process.cwd()): void {
  for (const { dir: dirName, record } of categories(registry)) {
    for (const [key, meta] of Object.entries(record)) {
      const dir = join(outDir, dirName, key);
      mkdirSync(dir, { recursive: true });
      const entry: PersistedEntry<typeof meta> = {
        meta: { ...meta, filePath: toPortablePath(meta.filePath, projectRoot) },
        sourceFileHash: registry.fileHashes[meta.filePath] ?? "",
      };
      writeFileSync(join(dir, META_FILE), JSON.stringify(entry, null, 2));
    }
  }

  mkdirSync(outDir, { recursive: true });
  writeFileSync(
    join(outDir, REGISTRY_MARKER_PATH),
    JSON.stringify({ version: registry.version, generatedAt: registry.generatedAt }, null, 2),
  );
}

/** Absolute source path -> project-relative, forward-slash form. */
function toPortablePath(filePath: string, projectRoot: string): string {
  return relative(projectRoot, filePath).split(sep).join("/");
}

/** `filePath` in the returned metas (and `fileHashes` keys) is resolved
 *  against `projectRoot`; an older absolute path passes through as-is. */
export function loadRegistry(outDir = ".", projectRoot = process.cwd()): Registry | null {
  const markerPath = join(outDir, REGISTRY_MARKER_PATH);
  if (!existsSync(markerPath)) return null;
  const marker = JSON.parse(readFileSync(markerPath, "utf-8")) as { version: number; generatedAt: string };
  if (marker.version !== 1) {
    throw new Error(`streak-boot.registry.json has version ${marker.version}, expected 1 — delete it and rerun a full scan.`);
  }

  const widgets: Record<string, WidgetMeta> = {};
  const handlers: Record<string, HandlerMeta> = {};
  const components: Record<string, ComponentMeta> = {};
  const html: Record<string, ShellMeta> = {};
  const head: Record<string, ShellMeta> = {};
  const body: Record<string, ShellMeta> = {};
  const rootLayout: Record<string, ShellMeta> = {};
  const fileHashes: Record<string, string> = {};

  const load = <T extends { filePath: string }>(dirName: string, keyOf: (meta: T) => string, target: Record<string, T>) => {
    const root = join(outDir, dirName);
    for (const key of safeReaddir(root)) {
      const metaPath = join(root, key, META_FILE);
      if (!existsSync(metaPath)) continue;
      const entry = JSON.parse(readFileSync(metaPath, "utf-8")) as PersistedEntry<T>;
      entry.meta.filePath = resolve(projectRoot, entry.meta.filePath);
      target[keyOf(entry.meta)] = entry.meta;
      if (entry.sourceFileHash) fileHashes[entry.meta.filePath] = entry.sourceFileHash;
    }
  };

  load<WidgetMeta>(WIDGETS_DIR, (m) => m.type, widgets);
  load<HandlerMeta>(HANDLERS_DIR, (m) => m.exportName, handlers);
  load<ComponentMeta>(COMPONENTS_DIR, (m) => m.type, components);
  load<ShellMeta>(HTML_DIR, (m) => m.type, html);
  load<ShellMeta>(HEAD_DIR, (m) => m.type, head);
  load<ShellMeta>(BODY_DIR, (m) => m.type, body);
  load<ShellMeta>(ROOT_LAYOUT_DIR, (m) => m.type, rootLayout);

  return {
    version: 1,
    generatedAt: marker.generatedAt,
    widgets,
    handlers,
    components,
    html,
    head,
    body,
    rootLayout,
    fileHashes,
  };
}

function safeReaddir(dir: string): string[] {
  try {
    return readdirSync(dir);
  } catch {
    return [];
  }
}

/**
 * Incremental rescan — used by dev mode. Re-parses only the changed file,
 * PLUS any file that imports it (a shallow one-hop dependency check —
 * good enough for "CommonHandler.ts changed, rescan widgets that import
 * it", without hand-rolling a full module graph; if the project outgrows
 * this, swap in Bun's own bundler graph instead of extending this by hand).
 */
export function incrementalRescan(
  registry: Registry,
  changedFile: string,
  allWatchedFiles: string[],
): Registry {
  const dependents = findDirectImporters(changedFile, allWatchedFiles);
  const filesToRescan = [changedFile, ...dependents];

  const nextWidgets = { ...registry.widgets };
  const nextHandlers = { ...registry.handlers };
  const nextComponents = { ...registry.components };
  const nextHtml = { ...registry.html };
  const nextHead = { ...registry.head };
  const nextBody = { ...registry.body };
  const nextRootLayout = { ...registry.rootLayout };
  const nextHashes = { ...registry.fileHashes };

  // Drop stale entries that came from files being rescanned.
  for (const file of filesToRescan) {
    for (const [type, w] of Object.entries(nextWidgets)) {
      if (w.filePath === file) delete nextWidgets[type];
    }
    for (const [name, h] of Object.entries(nextHandlers)) {
      if (h.filePath === file) delete nextHandlers[name];
    }
    for (const [type, c] of Object.entries(nextComponents)) {
      if (c.filePath === file) delete nextComponents[type];
    }
    for (const [type, e] of Object.entries(nextHtml)) {
      if (e.filePath === file) delete nextHtml[type];
    }
    for (const [type, e] of Object.entries(nextHead)) {
      if (e.filePath === file) delete nextHead[type];
    }
    for (const [type, e] of Object.entries(nextBody)) {
      if (e.filePath === file) delete nextBody[type];
    }
    for (const [type, e] of Object.entries(nextRootLayout)) {
      if (e.filePath === file) delete nextRootLayout[type];
    }
  }

  for (const file of filesToRescan) {
    if (!existsSync(file)) continue; // file was deleted
    const content = readFileSync(file, "utf-8");
    nextHashes[file] = hashOf(content);
    const parsed = parseFile(file);
    for (const w of parsed.widgets) nextWidgets[w.type] = w;
    for (const h of parsed.handlers) nextHandlers[h.exportName] = h;
    for (const c of parsed.components) nextComponents[c.type] = c;
    for (const e of parsed.html) nextHtml[e.type] = e;
    for (const e of parsed.head) nextHead[e.type] = e;
    for (const e of parsed.body) nextBody[e.type] = e;
    for (const e of parsed.rootLayout) nextRootLayout[e.type] = e;
  }

  return {
    ...registry,
    generatedAt: new Date().toISOString(),
    widgets: nextWidgets,
    handlers: nextHandlers,
    components: nextComponents,
    html: nextHtml,
    head: nextHead,
    body: nextBody,
    rootLayout: nextRootLayout,
    fileHashes: nextHashes,
  };
}

function findDirectImporters(targetFile: string, candidateFiles: string[]): string[] {
  const targetBase = targetFile.replace(/\.(tsx|ts)$/, "");
  const importers: string[] = [];

  for (const file of candidateFiles) {
    if (file === targetFile || !existsSync(file)) continue;
    const content = readFileSync(file, "utf-8");
    const sourceFile = ts.createSourceFile(file, content, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    let imports = false;

    sourceFile.forEachChild((node) => {
      if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
        const spec = node.moduleSpecifier.text;
        const resolved = resolve(dirname(file), spec).replace(/\.(tsx|ts)$/, "");
        if (resolved === targetBase) imports = true;
      }
    });

    if (imports) importers.push(file);
  }

  return importers;
}
