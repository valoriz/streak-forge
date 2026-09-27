import { widget, handler, component, html, head, body, rootLayout } from "./hoc.js";

/**
 * Runtime half of the ambient globals declared in ambient-globals.d.ts.
 * Import this module once, for its side effect, before any
 * widget/handler/component/html/head/body/rootLayout file is
 * imported/executed — wired via `preload` in bunfig.toml so `bun test` /
 * `bun run` pick it up automatically without every entrypoint importing it
 * by hand. Type-checking doesn't need this file (ambient-globals.d.ts
 * covers that); this only matters when such a module actually runs.
 */
type Globals = {
  widget: typeof widget;
  handler: typeof handler;
  component: typeof component;
  html: typeof html;
  head: typeof head;
  body: typeof body;
  rootLayout: typeof rootLayout;
};
const g = globalThis as typeof globalThis & Globals;
g.widget = widget;
g.handler = handler;
g.component = component;
g.html = html;
g.head = head;
g.body = body;
g.rootLayout = rootLayout;
