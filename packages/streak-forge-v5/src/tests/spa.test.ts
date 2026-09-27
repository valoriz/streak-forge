import { describe, test, expect, afterEach } from "bun:test";
import { rmSync } from "node:fs";
import { join } from "node:path";
import { buildPages, type RenderInstance } from "../page-build.js";
import { createMockWorkerServer } from "../cli/mock-worker-server.js";
import { WidgetPlaceholder, Fragment } from "../jsx.js";
import type { Registry, WidgetMeta, ShellMeta, StreakBootSitemap } from "../types.js";

// Real end-to-end check of the /index.json HTTP contract the SPA router
// (cli/spa-router.ts) depends on — same shape as lazy-loading.test.ts's
// own HTTP round trip, for the opt-in spa: true path specifically.

const OUT_DIR = join(import.meta.dir, "spa-scratch");

function widgetMeta(type: string): WidgetMeta {
  return { exportName: type, filePath: `/virtual/widgets/${type}.tsx`, type, kind: "static", dynamicClasses: [], dynamicClassGroups: [], sourceHash: "hash" };
}
function shellMeta(type: string): ShellMeta {
  return { exportName: type, filePath: `/virtual/shell/${type}.tsx`, type, dynamicClasses: [], dynamicClassGroups: [], sourceHash: "hash" };
}

const registry: Registry = {
  version: 1,
  generatedAt: new Date().toISOString(),
  widgets: { Hello: widgetMeta("Hello") },
  handlers: {},
  components: {},
  html: { AppShell: { ...shellMeta("AppShell"), exportName: "AppHtml" } },
  head: { AppShell: { ...shellMeta("AppShell"), exportName: "AppHead" } },
  body: { AppShell: { ...shellMeta("AppShell"), exportName: "AppBody" } },
  rootLayout: { AppShell: shellMeta("AppShell") },
  fileHashes: {},
};

const render: RenderInstance = async (meta) => {
  if (meta.filePath.endsWith("Hello.tsx")) return { type: "p", props: { children: "hi" } };
  if (meta.filePath.endsWith("AppShell.tsx")) {
    if (meta.exportName === "AppHtml") return { lang: "en" };
    if (meta.exportName === "AppHead") return { type: "title", props: { children: "Test" } };
    if (meta.exportName === "AppBody") return {};
    return { type: Fragment, props: { children: [WidgetPlaceholder({ id: "hello-1", type: "Hello" })] } };
  }
  throw new Error(`render: no case for ${meta.filePath}`);
};

const sitemap: StreakBootSitemap = {
  pages: [
    { url: "/", rootLayout: "AppShell", widgets: [{ id: "hello-1", type: "Hello" }] },
    { url: "/page-2", rootLayout: "AppShell", widgets: [{ id: "hello-1", type: "Hello" }] },
  ],
};

afterEach(() => {
  rmSync(OUT_DIR, { recursive: true, force: true });
});

describe("SPA — /index.json real HTTP round trip through createMockWorkerServer", () => {
  test("spa: true links spa-router.js and serves /index.json with the documented shape; 404s a page with no manifest", async () => {
    // spa:true is realistically paired with inlineCss:true (a build/serve
    // concern, like spa itself) — also exercises the deferred root.js
    // chain alongside the router's own separate deferred tag.
    const { pageManifests } = await buildPages({ registry, sitemap, outDir: OUT_DIR, render, spa: true, inlineCss: true });
    const home = pageManifests.find((m) => m.url === "/")!;

    const server = createMockWorkerServer({ outDir: OUT_DIR, port: 0, liveReload: false });
    try {
      const base = `http://localhost:${server.port}`;

      const pageRes = await fetch(base + "/");
      const pageHtml = await pageRes.text();
      expect(pageHtml).toContain(`<script src="/__streak/spa-router.js?v=${home.version}" defer></script>`);

      const spaRouterRes = await fetch(base + "/__streak/spa-router.js");
      expect(spaRouterRes.status).toBe(200);
      // inlineCss: true also minifies JS (Bun.build) — function/local
      // names like jsonUrlFor get renamed by real minification, but string
      // literals never do; "/index.json" is jsonUrlFor's own return value.
      expect(await spaRouterRes.text()).toContain("/index.json");

      const jsonRes = await fetch(base + "/index.json");
      expect(jsonRes.status).toBe(200);
      expect(jsonRes.headers.get("content-type")).toContain("application/json");
      const json = (await jsonRes.json()) as { headHtml: string; bodyHtml: string; htmlAttributes: Record<string, string> };
      expect(json.htmlAttributes).toEqual({ lang: "en" });
      expect(json.headHtml).toContain("<title>Test</title>");
      expect(json.bodyHtml).toContain("<p>hi</p>");
      expect(json.bodyHtml).not.toContain("<body");

      const page2JsonRes = await fetch(base + "/page-2/index.json");
      expect(page2JsonRes.status).toBe(200);

      const missingRes = await fetch(base + "/does-not-exist/index.json");
      expect(missingRes.status).toBe(404);
    } finally {
      server.stop(true);
    }
  });

  test("spa: false (default) — /index.json is still reachable (same as real streak-forge's own always-on index.json twin), just no spa-router.js file/link", async () => {
    await buildPages({ registry, sitemap, outDir: OUT_DIR, render });

    const server = createMockWorkerServer({ outDir: OUT_DIR, port: 0, liveReload: false });
    try {
      const base = `http://localhost:${server.port}`;
      const jsonRes = await fetch(base + "/index.json");
      expect(jsonRes.status).toBe(200);
      const routerRes = await fetch(base + "/__streak/spa-router.js");
      expect(routerRes.status).toBe(404);
      const pageRes = await fetch(base + "/");
      expect(await pageRes.text()).not.toContain("spa-router.js");
    } finally {
      server.stop(true);
    }
  });
});
