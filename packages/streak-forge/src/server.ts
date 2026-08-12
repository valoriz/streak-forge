import config from "@config";
import { afterRender, beforeRender, render } from "@src/index";
import { getStreakSitemapConfig } from "@core/libs/commonUtils";
import path from "path";
import fs from "fs";

const pageUrlMap: {
  [key: string]: StreakSitemapItem["renderConfig"];
} = {};

const sseClients = new Set<ReadableStreamDefaultController<Uint8Array>>();

export function broadcastReload() {
  const encoder = new TextEncoder();
  const msg = encoder.encode("event: reload\ndata: \n\n");
  for (const ctrl of sseClients) {
    try {
      ctrl.enqueue(msg);
    } catch {
      sseClients.delete(ctrl);
    }
  }
}

const HMR_SCRIPT = `<script>
(function(){
  function connect(){
    var es=new EventSource('/__streak_hmr');
    es.addEventListener('reload',function(){location.reload();});
    es.onerror=function(){es.close();setTimeout(connect,1000);};
  }
  connect();
})();
</script>`;

function injectHmr(html: string): string {
  if (!config.hmrEnabled) return html;
  return html.includes("</body>") ? html.replace("</body>", HMR_SCRIPT + "</body>") : html + HMR_SCRIPT;
}

const devServerDirectory = config.devServerDirectory;

const doBeforeServerStart = async () => {
  console.info("Preparing Dev Server Directory:", devServerDirectory);
  await beforeRender(devServerDirectory);
  await afterRender(devServerDirectory);
};

export const catchAll = async (req: Request) => {
  const url = new URL(req.url);

  if (config.hmrEnabled && url.pathname === "/__streak_hmr") {
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
        }, 15000);
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
  }

  if (pageUrlMap[url.pathname]) {
    const { content } = await render(pageUrlMap[url.pathname] as unknown as any, {
      isBuild: false,
      onProgress: (metadata: Record<string, any>) => {
        console.info("Progress Metadata:", metadata);
      },
    });

    return new Response(injectHmr(content || ""), {
      status: 200,
      headers: { "Content-Type": "text/html" },
    });
  }

  const publicFileUrl = path.join(devServerDirectory, url.pathname);

  if (fs.existsSync(publicFileUrl)) {
    if (publicFileUrl.endsWith(".html")) {
      const html = await fs.promises.readFile(publicFileUrl, "utf-8");
      return new Response(injectHmr(html), {
        headers: { "Content-Type": "text/html" },
      });
    }
    return new Response(Bun.file(publicFileUrl));
  }

  return new Response("Not Found", { status: 404 });
};

const main = () => {
  try {
    return Bun.serve({
      port: config.devPort,
      fetch: async (req: Request) => {
        try {
          return await catchAll(req);
        } catch (err) {
          console.error(err);
          console.error(`Handler error: ${(err as Error).message}`);
          return new Response("Internal Server Error", { status: 500 });
        }
      },
      error: (err) => {
        console.error(`Server error: ${err.message}`);
        return new Response("Internal Server Error", { status: 500 });
      },
    });
  } catch (err) {
    console.error(`Failed to start server: ${(err as Error).message}`);
    console.error(err);
    process.exit(1);
  }
};

export { doBeforeServerStart };

export default async function startServer() {
  console.info("Setting up Streak Dev Server...");

  const streakSitemapConfiguration = await getStreakSitemapConfig(config.targetSrc);

  if (!Array.isArray(streakSitemapConfiguration)) {
    throw new Error("streak.sitemap.json is not configured properly. Please ensure it contains an 'endpoints' array.");
  }
  streakSitemapConfiguration.forEach((ep) => {
    pageUrlMap[ep.url] = ep.renderConfig;
  });

  console.info("Streak Sitemap Endpoints:", Object.keys(pageUrlMap));

  console.info(`Starting Streak Dev Server on port ${config.devPort}...`);
  const server = main();
  console.info(`Streak Dev Server is running at http://localhost:${config.devPort}`);
  return server;
}
