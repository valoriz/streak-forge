import path from "path";
import fs from "fs";
import config from "./config";
import { loadSitemap } from "./sitemap";
import { renderPage } from "./render/renderPage";
import { getContent } from "./render/contentStore";
import { CONTENT_ENDPOINT, HMR_ENDPOINT, resourceTypes } from "./constants";
import type { StreakSitemapItem } from "./types";

const HMR_CLIENT_SCRIPT = `<script>
(function(){
  function connect(){
    var es = new EventSource(${JSON.stringify(HMR_ENDPOINT)});
    es.addEventListener("reload", function(){ location.reload(); });
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

export const startDevServer = async () => {
  const pages = await loadSitemap(config.targetSrc);
  console.info(
    `streak v2: loaded ${pages.size} page(s) from streak.sitemap.json`,
  );

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
        if (page) {
          const html = await renderPage(page.url, page.renderConfig);
          return new Response(injectHmr(html), {
            headers: { "Content-Type": "text/html" },
          });
        }

        const publicFile = await servePublicFile(url.pathname);
        if (publicFile) return publicFile;

        return new Response("Not Found", { status: 404 });
      } catch (err) {
        console.error("streak v2: request handler error", err);
        return new Response(
          `Internal Server Error: ${(err as Error).message}`,
          { status: 500 },
        );
      }
    },
    error: (err) => {
      console.error("streak v2: server error", err);
      return new Response("Internal Server Error", { status: 500 });
    },
  });

  console.info(
    `streak v2 dev server running at http://localhost:${server.port}`,
  );
  return server;
};
