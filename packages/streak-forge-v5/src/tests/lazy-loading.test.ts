import { describe, test, expect, afterEach } from "bun:test";
import { rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { buildPages, type RenderInstance } from "../page-build.js";
import { createMockWorkerServer } from "../cli/mock-worker-server.js";
import { WidgetPlaceholder, Dynamic, Fragment, Script, type VNode } from "../jsx.js";
import type { Registry, WidgetMeta, ShellMeta, StreakBootSitemap } from "../types.js";

// Real end-to-end check of the lazy-widget HTTP contract (server side):
// buildPages() writes real fragment files to a scratch outDir, then a real
// Bun.serve instance (createMockWorkerServer — same server both `dev` and
// `serve` use) is hit with real fetch() calls, same as a browser running
// cli/lazy-runtime.ts would. What the runtime JS itself does in a DOM is
// out of scope here (no browser in this test env) — this covers the
// contract it depends on: composed page keeps the marker + links the
// runtime script, and GET /__streak/lazy resolves it.

const OUT_DIR = join(import.meta.dir, "lazy-loading-scratch");

function widgetMeta(type: string): WidgetMeta {
  return { exportName: type, filePath: `/virtual/widgets/${type}.tsx`, type, kind: "static", dynamicClasses: [], dynamicClassGroups: [], sourceHash: "hash" };
}
function shellMeta(type: string): ShellMeta {
  return { exportName: type, filePath: `/virtual/shell/${type}.tsx`, type, dynamicClasses: [], dynamicClassGroups: [], sourceHash: "hash" };
}

const registry: Registry = {
  version: 1,
  generatedAt: new Date().toISOString(),
  widgets: { Hello: widgetMeta("Hello"), Bonus: widgetMeta("Bonus") },
  handlers: {},
  components: {},
  html: { AppShell: { ...shellMeta("AppShell"), exportName: "AppHtml" } },
  head: { AppShell: { ...shellMeta("AppShell"), exportName: "AppHead" } },
  body: { AppShell: { ...shellMeta("AppShell"), exportName: "AppBody" } },
  rootLayout: { AppShell: shellMeta("AppShell") },
  fileHashes: {},
};

const render: RenderInstance = async (meta, props) => {
  if (meta.filePath.endsWith("Hello.tsx")) {
    return {
      type: Fragment,
      props: {
        children: [
          { type: "p", props: { children: "hi" } },
          Dynamic({ id: "hello-panel", children: { type: "p", props: { children: "Dynamic panel content" } } }),
        ],
      },
    };
  }
  if (meta.filePath.endsWith("Bonus.tsx")) {
    const fact = (props.data as { fact?: string } | undefined)?.fact ?? "default";
    const node: VNode = {
      type: Fragment,
      props: {
        children: [
          { type: "p", props: { children: `Bonus:${fact}` } },
          Script({ id: "bonus-script", options: { fact }, children: (_gDom, options) => console.log(options.fact) }),
        ],
      },
    };
    return node;
  }
  if (meta.filePath.endsWith("AppShell.tsx")) {
    if (meta.exportName === "AppHtml") return {};
    if (meta.exportName === "AppHead") return null;
    if (meta.exportName === "AppBody") return {};
    return {
      type: Fragment,
      props: { children: [WidgetPlaceholder({ id: "hello-1", type: "Hello" }), WidgetPlaceholder({ id: "bonus-1", type: "Bonus" })] },
    };
  }
  throw new Error(`render: no case for ${meta.filePath}`);
};

const sitemap: StreakBootSitemap = {
  pages: [
    {
      url: "/",
      rootLayout: "AppShell",
      metadata: { fact: "real" },
      widgets: [
        { id: "hello-1", type: "Hello" },
        { id: "bonus-1", type: "Bonus", loadingStrategy: "lazy" },
      ],
    },
  ],
};

afterEach(() => {
  rmSync(OUT_DIR, { recursive: true, force: true });
});

describe("lazy widget loading — real HTTP round trip through createMockWorkerServer", () => {
  test("composed page keeps the placeholder + links the runtime; /__streak/lazy resolves the real content; unknown/eager ids 404", async () => {
    await buildPages({ registry, sitemap, outDir: OUT_DIR, render });
    expect(existsSync(join(OUT_DIR, "__streak/root.js"))).toBe(true);
    expect(existsSync(join(OUT_DIR, "__streak/app.js"))).toBe(true);
    expect(existsSync(join(OUT_DIR, "__streak/asset-worker.js"))).toBe(true);
    expect(existsSync(join(OUT_DIR, "__streak/dev-runtime.js"))).toBe(true);

    const server = createMockWorkerServer({ outDir: OUT_DIR, port: 0, liveReload: false });
    try {
      const base = `http://localhost:${server.port}`;

      const pageRes = await fetch(base + "/");
      const pageHtml = await pageRes.text();
      expect(pageHtml).toContain("<p>hi</p>");
      expect(pageHtml).toContain('<div data-widget-placeholder="bonus-1" data-widget-type="Bonus"></div>');
      expect(pageHtml).not.toContain("Bonus:real");
      expect(pageHtml).toContain('<script src="/__streak/dev-runtime.js"></script>');

      const runtimeRes = await fetch(base + "/__streak/dev-runtime.js");
      expect(runtimeRes.status).toBe(200);
      const runtimeSrc = await runtimeRes.text();
      expect(runtimeSrc).toContain("addResourceToBody");
      expect(runtimeSrc).toContain("data-widget-placeholder");

      // A real executable script now, not JSON — content-type text/javascript,
      // body is a self-executing snippet (see page-build.ts's
      // buildFragmentScript). Can't run it here (no DOM in this test env),
      // so this checks its source text directly, same as a browser would
      // receive verbatim via a real <script src>.
      const fragmentRes = await fetch(base + "/__streak/lazy?page=%2F&id=bonus-1");
      expect(fragmentRes.status).toBe(200);
      expect(fragmentRes.headers.get("content-type")).toBe("text/javascript");
      const fragmentSrc = await fragmentRes.text();
      expect(fragmentSrc).toContain('querySelector("[data-widget-placeholder=\\"bonus-1\\"]")');
      expect(fragmentSrc).toContain("Bonus:real");
      expect(fragmentSrc).toContain("console.log(options.fact)");

      const missingRes = await fetch(base + "/__streak/lazy?page=%2F&id=does-not-exist");
      expect(missingRes.status).toBe(404);

      // hello-1 is eager, not lazy — the runtime has no reason to fetch it,
      // and the endpoint correctly refuses to serve it.
      const eagerRes = await fetch(base + "/__streak/lazy?page=%2F&id=hello-1");
      expect(eagerRes.status).toBe(404);

      // hello-1 also contains a <Dynamic id="hello-panel"> block — absent
      // from the initial page (even though hello-1 itself is eager), its
      // own slot marker present instead, and fetchable via the Dynamic
      // endpoint (a completely separate mechanism from loadingStrategy).
      expect(pageHtml).toContain('data-dynamic-slot="hello-panel"');
      expect(pageHtml).not.toContain("Dynamic panel content");

      const dynamicRes = await fetch(base + "/__streak/dynamic?id=hello-panel");
      expect(dynamicRes.status).toBe(200);
      expect(dynamicRes.headers.get("content-type")).toBe("text/javascript");
      const dynamicSrc = await dynamicRes.text();
      expect(dynamicSrc).toContain('querySelector("[data-dynamic-slot=\\"hello-panel\\"]")');
      expect(dynamicSrc).toContain("Dynamic panel content");

      const dynamicMissingRes = await fetch(base + "/__streak/dynamic?id=does-not-exist");
      expect(dynamicMissingRes.status).toBe(404);
    } finally {
      server.stop(true);
    }
  });

  test("build/serve: a versioned (?v=) asset URL comes back Cache-Control: immutable; the same URL without ?v= doesn't", async () => {
    const { pageManifests } = await buildPages({ registry, sitemap, outDir: OUT_DIR, render, inlineCss: true });
    const home = pageManifests.find((m) => m.url === "/")!;

    const server = createMockWorkerServer({ outDir: OUT_DIR, port: 0, liveReload: false });
    try {
      const base = `http://localhost:${server.port}`;

      const versionedRes = await fetch(`${base}/__streak/root.js?v=${home.version}`);
      expect(versionedRes.status).toBe(200);
      expect(versionedRes.headers.get("cache-control")).toBe("public, max-age=31536000, immutable");

      const unversionedRes = await fetch(`${base}/__streak/root.js`);
      expect(unversionedRes.status).toBe(200);
      expect(unversionedRes.headers.get("cache-control")).toBeNull();
    } finally {
      server.stop(true);
    }
  });
});
