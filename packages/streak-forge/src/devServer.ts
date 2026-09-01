import path from "path";
import fs from "fs";
import config from "./config";
import { loadSitemap } from "./sitemap";
import { renderPage } from "./render/renderPage";
import { getContent } from "./render/contentStore";
import { resolveMiddleware } from "./build/middleware";
import { onClosureLeak } from "./build/scriptTransform";
import type { ClosureLeak } from "./build/scriptTransform";
import { CONTENT_ENDPOINT, HMR_ENDPOINT, resourceTypes } from "./constants";
import type { StreakSitemapItem } from "./types";

// Next.js-style dismissible error banner for <Script> closure leaks, pushed
// live over the same SSE stream used for reload - no separate channel.
const HMR_CLIENT_SCRIPT = `<script>
(function(){
  var seen = {};

  function ensureOverlay(){
    var el = document.getElementById("__streak_error_overlay");
    if (el) return el;
    el = document.createElement("div");
    el.id = "__streak_error_overlay";
    el.style.cssText = "position:fixed;bottom:0;left:0;right:0;max-height:40vh;overflow:auto;background:#450a0a;color:#fecaca;font:12px/1.5 ui-monospace,monospace;z-index:2147483647;box-shadow:0 -2px 12px rgba(0,0,0,.4);";
    document.body.appendChild(el);
    return el;
  }

  function showWarning(leak){
    var key = leak.file + ":" + leak.line + ":" + leak.column + ":" + leak.name;
    if (seen[key]) return;
    seen[key] = true;

    var overlay = ensureOverlay();
    var row = document.createElement("div");
    row.style.cssText = "padding:8px 12px;border-top:1px solid rgba(255,255,255,.1);display:flex;justify-content:space-between;gap:12px;align-items:flex-start;";

    var text = document.createElement("div");
    text.textContent = "streak: <Script> closure leak - \\"" + leak.name + "\\" referenced at " + leak.file + ":" + leak.line + ":" + leak.column + ". Pass it via the Script's options prop instead.";

    var closeBtn = document.createElement("button");
    closeBtn.textContent = "Dismiss";
    closeBtn.style.cssText = "background:none;border:1px solid rgba(255,255,255,.3);color:#fecaca;font-size:11px;padding:2px 8px;border-radius:4px;cursor:pointer;flex:0 0 auto;";
    closeBtn.onclick = function(){
      row.remove();
      delete seen[key];
      if (!overlay.children.length) overlay.remove();
    };

    row.appendChild(text);
    row.appendChild(closeBtn);
    overlay.appendChild(row);
  }

  function connect(){
    var es = new EventSource(${JSON.stringify(HMR_ENDPOINT)});
    es.addEventListener("reload", function(){ location.reload(); });
    es.addEventListener("script-warning", function(e){
      try { showWarning(JSON.parse(e.data)); } catch (err) {}
    });
    es.onerror = function(){ es.close(); setTimeout(connect, 1000); };
  }
  connect();
})();
</script>`;

const injectHmr = (html: string): string =>
  config.hmrEnabled
    ? html.includes("</body>")
      ? html.replace("</body>", `${HMR_CLIENT_SCRIPT}</body>`)
      : html + HMR_CLIENT_SCRIPT
    : html;

const sseClients = new Set<ReadableStreamDefaultController<Uint8Array>>();

export const broadcastReload = () => {
  const encoder = new TextEncoder();
  const msg = encoder.encode("event: reload\ndata: \n\n");
  for (const ctrl of sseClients) {
    try {
      ctrl.enqueue(msg);
    } catch {
      sseClients.delete(ctrl);
    }
  }
};

export const broadcastScriptWarning = (leak: ClosureLeak) => {
  const encoder = new TextEncoder();
  const msg = encoder.encode(
    `event: script-warning\ndata: ${JSON.stringify(leak)}\n\n`,
  );
  for (const ctrl of sseClients) {
    try {
      ctrl.enqueue(msg);
    } catch {
      sseClients.delete(ctrl);
    }
  }
};

const isResourceType = (
  value: string | null,
): value is (typeof resourceTypes)[keyof typeof resourceTypes] =>
  value === resourceTypes.WIDGET || value === resourceTypes.DYNAMIC;

const handleContentRequest = (url: URL): Response => {
  const page = url.searchParams.get("page");
  const type = url.searchParams.get("type");
  const id = url.searchParams.get("id");

  if (!page || !id || !isResourceType(type)) {
    return new Response("Bad content request", { status: 400 });
  }

  const stored = getContent(page, type, id);
  if (!stored) {
    return new Response(JSON.stringify({ error: "not found" }), {
      status: 404,
      headers: { "Content-Type": "application/json" },
    });
  }

  return new Response(JSON.stringify(stored), {
    headers: { "Content-Type": "application/json" },
  });
};

const handleHmrStream = (): Response => {
  const encoder = new TextEncoder();
  let ctrl: ReadableStreamDefaultController<Uint8Array>;
  let heartbeat: ReturnType<typeof setInterval>;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      ctrl = controller;
      sseClients.add(controller);
      controller.enqueue(encoder.encode(": connected\n\n"));
      heartbeat = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(": ping\n\n"));
        } catch {
          clearInterval(heartbeat);
          sseClients.delete(ctrl);
        }
      }, 8000);
    },
    cancel() {
      clearInterval(heartbeat);
      sseClients.delete(ctrl);
    },
  });
  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
};

const servePublicFile = async (pathname: string): Promise<Response | null> => {
  const filePath = path.join(config.srcDir.publicDir, pathname);
  if (!filePath.startsWith(config.srcDir.publicDir)) return null; // no path traversal
  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory())
    return null;
  return new Response(Bun.file(filePath));
};

// Module-scoped (not local to startDevServer) so `reloadSitemap` can swap it
// out from under the running server - loadSitemap() itself always re-reads
// the file fresh, but the request handler was closing over a `const` that
// was only ever assigned once, at server boot. That meant edits to
// streak.sitemap.json (adding/removing a widget, a page, a dataHandler, ...)
// were invisible until the whole dev server was restarted, even though the
// file watcher fired a browser reload for them - the browser dutifully
// refetched the page and got the exact same stale render from the server.
let pages: Map<string, StreakSitemapItem> = new Map();

export const reloadSitemap = async () => {
  pages = await loadSitemap(config.targetSrc);
  console.info(
    `streak-forge: reloaded ${pages.size} page(s) from streak.sitemap.json`,
  );
};

export const startDevServer = async () => {
  await reloadSitemap();

  onClosureLeak(broadcastScriptWarning);

  const server = Bun.serve({
    port: config.devPort,
    // Bun's default idle-connection timeout (10s) is shorter than the SSE
    // heartbeat interval below would need without this, which kills the HMR
    // stream and sends the browser into a reconnect loop. Max Bun allows.
    idleTimeout: 255,
    fetch: async (req) => {
      const url = new URL(req.url);

      try {
        if (url.pathname === HMR_ENDPOINT) return handleHmrStream();
        if (url.pathname === CONTENT_ENDPOINT) return handleContentRequest(url);

        const page: StreakSitemapItem | undefined = pages.get(url.pathname);
        // Middleware.ts (if present) runs on every request first - undefined
        // means "skip, use the sitemap's own config" (or 404 if there isn't
        // one either); returning a RenderConfig overrides it, enabling pages
        // for URLs that aren't statically listed at all.
        const middlewareConfig = await resolveMiddleware(
          config.srcDir.handlerDir,
          url.pathname,
          req,
        );
        const renderConfig = middlewareConfig ?? page?.renderConfig;
        if (renderConfig) {
          const html = await renderPage(url.pathname, renderConfig);
          return new Response(injectHmr(html), {
            headers: { "Content-Type": "text/html" },
          });
        }

        const publicFile = await servePublicFile(url.pathname);
        if (publicFile) return publicFile;

        return new Response("Not Found", { status: 404 });
      } catch (err) {
        console.error("streak-forge: request handler error", err);
        return new Response(
          `Internal Server Error: ${(err as Error).message}`,
          { status: 500 },
        );
      }
    },
    error: (err) => {
      console.error("streak-forge: server error", err);
      return new Response("Internal Server Error", { status: 500 });
    },
  });

  console.info(
    `streak-forge dev server running at http://localhost:${server.port}`,
  );
  return server;
};
