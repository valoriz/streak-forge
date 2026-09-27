import { existsSync, readFileSync } from "node:fs";
import { join, extname } from "node:path";
import {
  composePageFromFiles,
  composePageAsJson,
  composeScriptBundle,
  composeLazyWidgetFragment,
  composeDynamicFragment,
  cleanUrlToFolder,
  pageUrlFromJsonPath,
  resolveShortAssetPath,
  LAZY_FRAGMENT_HREF,
  DYNAMIC_FRAGMENT_HREF,
} from "../page-build.js";
import type { PageManifest } from "../types.js";

/**
 * Stands in for a real edge Worker/static host, serving straight out of a
 * built `out/`-shaped directory. That directory has two kinds of content,
 * handled differently:
 *
 *  - Real static files (CSS/JS/images promoted from .prebuild/public/) —
 *    served directly.
 *  - HTML FRAGMENTS (html/<Shell>, head/<Shell>, body/<Shell>, widget
 *    files) and each widget's own tiny script.js fragment — never served
 *    directly, and the combined page HTML/JS they'd produce is never
 *    written to disk anywhere. A page's HTML (composePageFromFiles) and
 *    its `/common.js` script bundle (composeScriptBundle) are both
 *    recomposed fresh, purely in memory, on EVERY request, then
 *    discarded — no caching tier, no "first request builds it, later ones
 *    read the cached copy". Concatenating a handful of small
 *    self-invoking-function strings is cheap enough that this is fine to
 *    redo every time. Manifests/fragments are read fresh off disk per
 *    request too, same as a real server process would read from its own
 *    deploy artifact rather than sharing memory with whatever built it.
 */

const PAGE_SCRIPT_FILENAME = "common.js";

const MIME: Record<string, string> = {
  ".html": "text/html",
  ".css": "text/css",
  ".js": "text/javascript",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".txt": "text/plain",
};

function contentType(path: string): string {
  return MIME[extname(path)] ?? "application/octet-stream";
}

function loadManifest(outDir: string, pageUrl: string): PageManifest | null {
  const manifestPath = join(outDir, "pages", cleanUrlToFolder(pageUrl), "meta.json");
  if (!existsSync(manifestPath)) return null;
  return JSON.parse(readFileSync(manifestPath, "utf-8")) as PageManifest;
}

const LIVE_RELOAD_PATH = "/__dev-reload";
/** Tiny client — one persistent SSE connection, reload on any message.
 *  No HMR here on purpose: these are server-rendered HTML fragments (plus
 *  small <Script> blocks that just re-run on load), not a client-side
 *  component tree with state worth preserving in place — a full reload is
 *  the correct, not merely simplest, equivalent for this architecture. */
const LIVE_RELOAD_SCRIPT = `<script>new EventSource(${JSON.stringify(LIVE_RELOAD_PATH)}).onmessage=function(){location.reload()};</script>`;

export interface MockWorkerServerOptions {
  outDir: string;
  port?: number;
  /** Dev-only: adds a GET /__dev-reload SSE endpoint and injects
   *  LIVE_RELOAD_SCRIPT into every composed page — the CLI's `dev`
   *  command calls the returned server's `notifyReload()` after each
   *  successful rebuild, which pushes a message that reloads any open
   *  tab. Never set for a plain prod-style preview server. */
  liveReload?: boolean;
  /** Dev-only: awaited before a page (or its SPA index.json) is composed,
   *  with that page's url — `dev` re-renders the page here, so every
   *  reload shows fresh handler data. */
  beforePage?: (pageUrl: string) => Promise<void>;
}

export function createMockWorkerServer(options: MockWorkerServerOptions) {
  const { outDir, port = 3690, liveReload = false, beforePage } = options;
  const reloadClients = new Set<ReadableStreamDefaultController<Uint8Array>>();

  const server = Bun.serve({
    port,
    async fetch(req) {
      const url = new URL(req.url);
      const pathname = url.pathname;

      if (liveReload && pathname === LIVE_RELOAD_PATH) {
        let thisController: ReadableStreamDefaultController<Uint8Array>;
        const stream = new ReadableStream<Uint8Array>({
          start(controller) {
            thisController = controller;
            reloadClients.add(controller);
          },
          cancel() {
            reloadClients.delete(thisController);
          },
        });
        return new Response(stream, {
          headers: { "content-type": "text/event-stream", "cache-control": "no-cache" },
        });
      }

      // One lazy widget's fragment — fetched by cli/app-script.ts's
      // hydrate loop after the page is interactive, as a real `<script
      // src>` (see buildFragmentScript's own doc comment for why: a real
      // script always executes, unlike innerHTML-inserted markup).
      // Checked before the page-route branch below since this path (no
      // extname) would otherwise fall into it and 404 as "no such page".
      if (pathname === LAZY_FRAGMENT_HREF) {
        const pageUrl = url.searchParams.get("page") ?? "/";
        const id = url.searchParams.get("id");
        const manifest = id ? loadManifest(outDir, pageUrl) : null;
        const fragment = manifest && id ? composeLazyWidgetFragment(manifest, id, outDir) : null;
        if (!fragment) return new Response("Not found", { status: 404 });
        return new Response(fragment, { headers: { "content-type": "text/javascript" } });
      }

      // One <Dynamic> block's fragment — fetched (as a real script, same
      // reasoning) by cli/root-script.ts's window.loadDynamicComponent on
      // explicit client demand. Flat by id, no page context needed (see
      // composeDynamicFragment).
      if (pathname === DYNAMIC_FRAGMENT_HREF) {
        const id = url.searchParams.get("id");
        const fragment = id ? composeDynamicFragment(id, outDir) : null;
        if (!fragment) return new Response("Not found", { status: 404 });
        return new Response(fragment, { headers: { "content-type": "text/javascript" } });
      }

      // The SPA router's own fetch target (cli/spa-router.ts) — same
      // composition as the normal page route (composePageFromFiles), just
      // shaped as JSON instead of one HTML string. Has a real ".json"
      // extension but no file on disk (never persisted — composed fresh,
      // same as everything else here), so it's checked before the static-
      // asset branch below, which would otherwise 404 it as a missing file.
      const jsonPageUrl = pageUrlFromJsonPath(pathname);
      if (jsonPageUrl !== null) {
        if (beforePage) await beforePage(jsonPageUrl);
        const manifest = loadManifest(outDir, jsonPageUrl);
        if (!manifest) return new Response("Not found", { status: 404 });
        return Response.json(composePageAsJson(manifest, outDir));
      }

      // A page's combined script bundle — "/common.js", "/page-2/common.js"
      // — has no file on disk at all; recompose it in memory from every
      // non-lazy widget's own already-persisted script.js fragment.
      if (pathname === `/${PAGE_SCRIPT_FILENAME}` || pathname.endsWith(`/${PAGE_SCRIPT_FILENAME}`)) {
        const pageUrl = pathname.slice(0, -PAGE_SCRIPT_FILENAME.length - 1) || "/";
        const manifest = loadManifest(outDir, pageUrl);
        if (!manifest) return new Response("Not found", { status: 404 });
        const js = composeScriptBundle(manifest, outDir);
        return new Response(js, { headers: { "content-type": "text/javascript" } });
      }

      const isPageRoute = extname(pathname) === "";

      // A real static asset (CSS/JS/image/...) — served as-is. A build/
      // serve-only short `/w/<id>/...` or `/c/<id>/...` URL (see
      // resolveShortAssetPath's own doc comment) resolves to its real
      // outDir-relative path first — everything past that point is
      // identical to any other static file. A `?v=` query string (see
      // PageManifest.version's own doc comment) means this exact URL is
      // safe to cache forever — a content change always shows up as a
      // DIFFERENT `?v=`, never the same URL serving stale bytes.
      if (!isPageRoute) {
        const shortPath = resolveShortAssetPath(outDir, pathname);
        const assetPath = join(outDir, shortPath ?? pathname.replace(/^\/+/, ""));
        if (!existsSync(assetPath)) return new Response("Not found", { status: 404 });
        const headers: Record<string, string> = { "content-type": contentType(assetPath) };
        if (url.searchParams.has("v")) headers["cache-control"] = "public, max-age=31536000, immutable";
        return new Response(readFileSync(assetPath), { headers });
      }

      // A page route — no manifest, no such page.
      if (beforePage) await beforePage(pathname);
      const manifest = loadManifest(outDir, pathname);
      if (!manifest) return new Response("Not found", { status: 404 });

      // Composed fresh from html/head/body/widget fragments on every
      // request — fs reads + string splicing only, no render()/dynamic
      // import, and the result is never written back to disk.
      let html = composePageFromFiles(manifest, outDir);
      if (liveReload) html = html.replace("</body>", `${LIVE_RELOAD_SCRIPT}</body>`);
      return new Response(html, { headers: { "content-type": "text/html" } });
    },
  });

  const notifyReload = (): void => {
    const chunk = new TextEncoder().encode("data: reload\n\n");
    for (const controller of reloadClients) {
      try {
        controller.enqueue(chunk);
      } catch {
        reloadClients.delete(controller); // client already gone
      }
    }
  };

  return Object.assign(server, { notifyReload });
}
