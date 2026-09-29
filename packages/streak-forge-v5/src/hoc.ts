import type {
  WidgetHocMeta,
  HandlerHocMeta,
  ComponentHocMeta,
  ShellHocMeta,
} from "./types";
import { hashValue } from "./hash";
import { jsonSafetyIssue, type JsonSafe } from "./json-safe";

/**
 * `widget(meta)(fn)` / `handler(meta)(fn)` / `component(meta)(fn)` —
 * decorator-like call sitting directly above the function, real code (not a
 * comment), no `@` sigil, no class conversion required. Real JS/TS
 * `@decorator` syntax only attaches to class declarations/members, not to a
 * bare `export const` function — these HOCs get the same "annotation right
 * above the function" ergonomics through an ordinary function call instead.
 *
 * The call shape is what `annotations.ts` matches structurally via the TS
 * AST at build time (parsed, never executed) to populate the registry —
 * these runtime implementations only matter if a widget/handler/component
 * module is actually imported and invoked (dev server, real render).
 * `widget()`/`component()`/the shell HOCs deliberately just return the
 * wrapped function unchanged; `handler()` adds real memoization (see its
 * own comment below) — a widget calls its handler directly, with a plain
 * `await`, inside its own render body (no separate sitemap-level binding).
 *
 * Exposed as ambient globals (see globals.ts) so widget/handler/component
 * files never need to import them.
 */
// `any`/`any[]` here on purpose, not `unknown`/`never[]`: this is a pure
// identity wrapper (fn in, same fn out), and a `never[]`-rest constraint
// collapses inference to `never` for the wrapped function's parameters when
// the result is used as a JSX tag (<Button/>) — `any` keeps Fn's real
// parameter/return types intact for the caller instead.
//
// `cache` is checked against the wrapped function's props at compile time:
// "type" caches one output per widget type, so the widget must take no
// props at all (nothing could make two renders differ); "props" hashes the
// props into the cache key, so they must be JSON-safe. Fn is generic on the
// inner call so it's inferred from the wrapped function, with `M` (the meta
// literal) already known.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type WidgetCacheCheck<M extends WidgetHocMeta, Fn extends (...args: any[]) => any> = M["cache"] extends "type"
  ? Parameters<Fn> extends []
    ? unknown
    : { 'widget({ cache: "type" }) must take no props: its output is cached once per widget type': never }
  : M["cache"] extends "props"
    ? Parameters<Fn>[0] extends JsonSafe<Parameters<Fn>[0]>
      ? unknown
      : { 'widget({ cache: "props" }) props must be JSON-safe: they are hashed into the cache key': never }
    : unknown;

export function widget<const M extends WidgetHocMeta = WidgetHocMeta>(_meta: M = {} as M) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return <Fn extends (...args: any[]) => any>(fn: Fn & WidgetCacheCheck<M, Fn>): Fn => fn;
}

/** One cache per wrapped handler FUNCTION (not per handler NAME — two
 *  `handler()`-wrapped functions never share entries even if they happen to
 *  have the same name), keyed by a deterministic hash of its call args.
 *  Same handler + same (deep-equal) input, called from any widget, any
 *  number of times in this process, only actually runs the handler once —
 *  later calls (including ones still in flight) get the same Promise back.
 *  Lives until resetHandlerCache() is called: a `build`/`prebuild` run
 *  never resets it (one cache for the whole run); `dev` resets it before
 *  each page it renders (see BuildPagesOptions.handlerCachePerPage), so a
 *  handler runs once per page render and a reload shows fresh data. A widget file imports its handler
 *  with a plain `import`, so within one process the imported function
 *  reference is stable and this Map is genuinely shared across every widget
 *  instance/page that calls it — see cli/render.ts's importAndCall doc
 *  comment for why an `async` widget body can `await` this directly with
 *  no other pipeline change.
 *
 *  Not solved here (pre-existing, not introduced by this cache): editing a
 *  HANDLER file during `dev` doesn't bust this cache, because the widget
 *  file that statically imports it only gets version-busted itself
 *  (importAndCall's `?v=`) — its nested `import` of the handler still
 *  resolves to the already-loaded module. Restart `dev` to pick up a
 *  handler edit. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type HandlerCaches = WeakMap<(...args: any[]) => any, Map<string, unknown>>;

// Kept on globalThis under a Symbol.for key, not in a module variable: a
// project's widgets get `handler` from the preloaded streak-forge/globals,
// which may be a different module instance than the CLI's own copy (a
// symlinked or duplicated install) — resetHandlerCache must clear the one
// the widgets actually use.
const CACHE_KEY = Symbol.for("streak-forge.handler-cache");

function handlerCaches(): HandlerCaches {
  const g = globalThis as unknown as Record<symbol, HandlerCaches | undefined>;
  return (g[CACHE_KEY] ??= new WeakMap());
}

/** Drops every memoized handler result — the next call of any handler
 *  runs it for real again. */
export function resetHandlerCache(): void {
  (globalThis as unknown as Record<symbol, HandlerCaches>)[CACHE_KEY] =
    new WeakMap();
}

/** `Fn` when its (awaited) result is JSON-safe (see json-safe.ts), else
 *  `Fn` plus a required property named after the rule — so a handler
 *  returning e.g. a `Date` fails to compile with that name in the error. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type JsonReturning<Fn extends (...args: any[]) => any> =
  Awaited<ReturnType<Fn>> extends JsonSafe<Awaited<ReturnType<Fn>>>
    ? Fn
    : Fn & {
        "handler() must return JSON-safe data: plain objects, arrays, strings, finite numbers, booleans, null (no Date, Map, Set, class instances, functions)": never;
      };

// Handlers already warned about (once each) by warnIfNotJsonSafe.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const warnedHandlers = new WeakSet<(...args: any[]) => any>();

/** Runtime half of the JSON-safety rule, for results the types can't see
 *  (`any` from `res.json()`, casts). Warns instead of throwing: the
 *  in-process memo works with any value, only a shared/persisted cache
 *  can't store it. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function warnIfNotJsonSafe(fn: (...args: any[]) => any, value: unknown): void {
  if (warnedHandlers.has(fn)) return;
  const issue = jsonSafetyIssue(value);
  if (!issue) return;
  warnedHandlers.add(fn);
  console.warn(`handler ${fn.name || "(anonymous)"}: result is not JSON-safe (${issue}); it can only be memoized in-process.`);
}

// The generic sits on the inner call (not on handler() itself) so Fn is
// inferred from the wrapped function, not fixed at `handler(meta)`.
export function handler(_meta: HandlerHocMeta = {}) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return <Fn extends (...args: any[]) => any>(fn: Fn & JsonReturning<Fn>): Fn => {
    const memoized = ((...args: Parameters<Fn>) => {
      const caches = handlerCaches();
      let cache = caches.get(fn);
      if (!cache) {
        cache = new Map();
        caches.set(fn, cache);
      }
      const key = hashValue(args);
      if (cache.has(key)) return cache.get(key);
      const result = fn(...args);
      cache.set(key, result);
      // Rejections are the caller's to handle; this branch only inspects values.
      Promise.resolve(result).then(
        (value) => warnIfNotJsonSafe(fn, value),
        () => {},
      );
      return result;
    }) as Fn;
    return memoized;
  };
}

/**
 * `component()` — for a smaller piece a widget renders internally (a
 * Button, a Card, ...), not a page-composable widget in its own right: no
 * `handler` binding (components are props-only; data comes from whichever
 * widget renders them). Exists purely so the component gets the same
 * build-time registry + CSS-purge treatment a widget gets (see
 * registry.ts/css-purge.ts) — composing a component inside a widget's JSX
 * already works without this, since the JSX runtime recurses into nested
 * function components regardless.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function component<Fn extends (...args: any[]) => any>(
  _meta: ComponentHocMeta = {},
) {
  return (fn: Fn): Fn => fn;
}

/**
 * `html()` / `head()` / `body()` — doc-shell entries, one rung above
 * widgets: `html()` sets `<html>` attrs (lang, ...), `head()` sets `<head>`
 * content (title/meta/link — real JSX, same as a widget/component), `body()`
 * sets `<body>` classes/attrs. Same registry + CSS-purge + JS-bundle
 * treatment as widget/component (own folder, own meta.json), plus one thing
 * only `head()` triggers: `runPreBuild` always generates a shared "common"
 * CSS bundle (Tailwind's base/preflight + root vars — the part identical
 * across every widget, previously duplicated into each widget's own CSS
 * file) and writes it into the `head()` entry's folder — or, if no `head()`
 * exists in the project at all, streak-forge still generates that bundle
 * into an auto-created `head/Common/` folder, so there's always one shared
 * file every page can load once instead of every widget repeating it.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function html<Fn extends (...args: any[]) => any>(
  _meta: ShellHocMeta = {},
) {
  return (fn: Fn): Fn => fn;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function head<Fn extends (...args: any[]) => any>(
  _meta: ShellHocMeta = {},
) {
  return (fn: Fn): Fn => fn;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function body<Fn extends (...args: any[]) => any>(
  _meta: ShellHocMeta = {},
) {
  return (fn: Fn): Fn => fn;
}

/**
 * `rootLayout()` — the page body's CONTENT, as opposed to `body()`'s attrs:
 * real JSX containing `<WidgetPlaceholder id type/>` markers showing where
 * each page's widgets go, same idea as streak-forge's own rootLayout +
 * WidgetPlaceholder. A project picks which `rootLayout()` entry a given
 * page uses via that page's `streak.sitemap.json` entry (`rootLayout: "Type"`).
 * page-build.ts is what actually resolves the placeholders — this HOC just
 * gets the entry into the registry (own folder, own CSS-purge, own bundle,
 * same as html/head/body).
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function rootLayout<Fn extends (...args: any[]) => any>(
  _meta: ShellHocMeta = {},
) {
  return (fn: Fn): Fn => fn;
}
