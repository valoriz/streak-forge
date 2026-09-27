import { describe, expect, test, afterEach } from "bun:test";
import { rmSync, existsSync, readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  buildPages,
  composePageFromFiles,
  composePageAsJson,
  composeScriptBundle,
  composeLazyWidgetFragment,
  composeDynamicFragment,
  readSitemap,
  pageScriptHref,
  pageJsonHref,
  pageUrlFromJsonPath,
  resolveShortAssetPath,
  type RenderInstance,
} from "../page-build.js";
import { shortScopePrefix } from "../css-purge.js";
import { handler, resetHandlerCache } from "../hoc.js";
import { WidgetPlaceholder, ComponentPlaceholder, Dynamic, Fragment, Script, type VNode } from "../jsx.js";
import type { Registry, WidgetMeta, ShellMeta, ComponentMeta, StreakBootSitemap } from "../types.js";

const OUT_DIR = join(import.meta.dir, "page-build-scratch");

afterEach(() => {
  rmSync(OUT_DIR, { recursive: true, force: true });
});

function widgetMeta(type: string): WidgetMeta {
  return {
    exportName: type,
    filePath: `/virtual/widgets/${type}.tsx`,
    type,
    kind: "static",
    dynamicClasses: [],
    dynamicClassGroups: [],
    sourceHash: "hash",
  };
}

function componentMeta(type: string): ComponentMeta {
  return {
    exportName: type,
    filePath: `/virtual/components/${type}.tsx`,
    type,
    dynamicClasses: [],
    dynamicClassGroups: [],
    sourceHash: "hash",
  };
}

function shellMeta(type: string): ShellMeta {
  return {
    exportName: type,
    filePath: `/virtual/shell/${type}.tsx`,
    type,
    dynamicClasses: [],
    dynamicClassGroups: [],
    sourceHash: "hash",
  };
}

// Synthetic registry — no real files, no dynamic import. `render` below
// switches on filePath the same way a real one would switch on which
// module got imported, testing buildPages/composePageFromFiles's own logic
// in isolation from the filesystem/JSX-transform side of things (those are
// already covered by the css-purge/annotations/jsx test files).
const registry: Registry = {
  version: 1,
  generatedAt: new Date().toISOString(),
  widgets: { Badge: widgetMeta("Badge"), Card: widgetMeta("Card") },
  handlers: {},
  components: {},
  html: { AppShell: shellMeta("AppShell") },
  head: { AppShell: shellMeta("AppShell") },
  body: { AppShell: shellMeta("AppShell") },
  rootLayout: { AppShell: shellMeta("AppShell") },
  fileHashes: {},
};

// A nested function component (not the widget's own top-level output) that
// carries a Script block — mirrors the real bug found while wiring this up:
// collectScripts has to descend into nested components like this one, not
// just the widget's own immediate JSX (a Button-inside-ProductCard shape).
const ButtonWithScript = (props: { label: string }): VNode => ({
  type: Fragment,
  props: {
    children: [
      { type: "button", props: { children: props.label } },
      Script({
        id: "click",
        options: { label: props.label },
        children: (_gDom, options) => {
          // eslint-disable-next-line no-console
          console.log(options.label);
        },
      }),
    ],
  },
});

const render: RenderInstance = async (meta, props) => {
  if (meta.filePath.endsWith("Badge.tsx")) {
    return { type: "span", props: { children: (props.label as string) ?? "Badge" } };
  }
  if (meta.filePath.endsWith("Card.tsx")) {
    // Inline widgets receive `{ data: page.metadata }` now, not their own
    // literal props — same `props?.data?.field` shape real widget code uses.
    const name = (props.data as { name?: string } | undefined)?.name;
    // ButtonWithScript is left UNINVOKED here (`{ type: fn, props }`, not
    // `fn(props)`) — matching real compiled JSX (`<Button label="Buy"/>`),
    // so collectScripts genuinely has to call into it during its walk,
    // same as renderToString already does.
    return {
      type: "div",
      props: { children: [`Card:${name}`, { type: ButtonWithScript, props: { label: "Buy" } }] },
    };
  }
  if (meta.filePath.endsWith("AppShell.tsx")) {
    if (meta.exportName === "AppHtml") return { lang: "en" };
    if (meta.exportName === "AppHead") return { type: "title", props: { children: "Test" } };
    if (meta.exportName === "AppBody") return { className: "shell-body" };
    // rootLayout
    const layout: VNode = {
      type: Fragment,
      props: { children: [WidgetPlaceholder({ id: "badge-1", type: "Badge" }), WidgetPlaceholder({ id: "card-1", type: "Card" })] },
    };
    return layout;
  }
  throw new Error(`render: no case for ${meta.filePath}`);
};

// registry's html/head/body entries all use exportName "AppShell" by
// default (shellMeta's own default) — override per-role since the render
// stub above switches on exportName to tell html()/head()/body()/
// rootLayout() apart, matching how they'd really differ (AppHtml vs
// AppHead vs AppBody vs AppRootLayout, all sharing type "AppShell" because
// they'd really live in the same file).
registry.html.AppShell = { ...registry.html.AppShell!, exportName: "AppHtml" };
registry.head.AppShell = { ...registry.head.AppShell!, exportName: "AppHead" };
registry.body.AppShell = { ...registry.body.AppShell!, exportName: "AppBody" };

const sitemap: StreakBootSitemap = {
  shared: [{ id: "SaleBadge", type: "Badge", props: { label: "Sale" } }],
  pages: [
    {
      url: "/",
      rootLayout: "AppShell",
      metadata: { name: "A" },
      widgets: [
        { id: "badge-1", ref: "SaleBadge" },
        { id: "card-1", type: "Card" },
      ],
    },
    {
      url: "/page-2",
      rootLayout: "AppShell",
      metadata: { name: "B" },
      widgets: [
        { id: "badge-1", ref: "SaleBadge" },
        { id: "card-1", type: "Card" },
      ],
    },
  ],
};

describe("page-build.readSitemap", () => {
  test("reads a real streak.sitemap.json-shaped file via JSON.parse", () => {
    const path = join(OUT_DIR, "streak.sitemap.json");
    mkdirSync(OUT_DIR, { recursive: true });
    writeFileSync(path, JSON.stringify(sitemap));
    const loaded = readSitemap(path);
    expect(loaded.pages).toHaveLength(2);
    expect(loaded.shared?.[0]?.id).toBe("SaleBadge");
  });

  test("rejects a file without a pages array", () => {
    const path = join(OUT_DIR, "bad.json");
    mkdirSync(OUT_DIR, { recursive: true });
    writeFileSync(path, JSON.stringify({ notPages: [] }));
    expect(() => readSitemap(path)).toThrow(/pages/);
  });
});

describe("page-build.buildPages", () => {
  test("shared widget builds once under widgets/<Type>/<id>/ (next to that type's CSS); page-specific widgets build under their own page's pages/<folder>/widgets/<id>/", async () => {
    const { pageManifests, sharedBuilt } = await buildPages({ registry, sitemap, outDir: OUT_DIR, render });

    expect(sharedBuilt).toEqual(["SaleBadge"]);
    expect(existsSync(join(OUT_DIR, "widgets/Badge/SaleBadge/content.json"))).toBe(true);
    expect(existsSync(join(OUT_DIR, "widgets/Badge/SaleBadge/index.html"))).toBe(true);
    expect(existsSync(join(OUT_DIR, "pages/index/widgets/card-1/content.json"))).toBe(true);
    expect(existsSync(join(OUT_DIR, "pages/page-2/widgets/card-1/content.json"))).toBe(true);
    // No duplicate build of the shared widget under either page's own folder.
    expect(existsSync(join(OUT_DIR, "pages/index/widgets/badge-1"))).toBe(false);
    expect(existsSync(join(OUT_DIR, "pages/page-2/widgets/badge-1"))).toBe(false);

    expect(pageManifests).toHaveLength(2);
    const home = pageManifests.find((m) => m.url === "/")!;
    expect(home.widgets).toEqual([
      { id: "badge-1", type: "Badge", shared: true, path: "widgets/Badge/SaleBadge", lazy: false, cssHref: null },
      { id: "card-1", type: "Card", shared: false, path: "pages/index/widgets/card-1", lazy: false, cssHref: null },
    ]);

    // Page-specific content actually differs per page (real per-page props),
    // and the SAME id "card-1" on both pages never collides since each
    // lives under its own page's own folder.
    const cardA = JSON.parse(readFileSync(join(OUT_DIR, "pages/index/widgets/card-1/content.json"), "utf-8"));
    const cardB = JSON.parse(readFileSync(join(OUT_DIR, "pages/page-2/widgets/card-1/content.json"), "utf-8"));
    expect(cardA.html).toContain("Card:A");
    expect(cardB.html).toContain("Card:B");
  });

  test("writes html/head/body shell files once per rootLayout type, shared across pages (dev-style: inlineCss false, per-file <link>s)", async () => {
    await buildPages({ registry, sitemap, outDir: OUT_DIR, render, cssHrefs: ["/common.css"] });

    const htmlFile = readFileSync(join(OUT_DIR, "html/AppShell/index.html"), "utf-8");
    expect(htmlFile).toBe('<html lang="en"><head></head><body></body></html>');

    const headFile = readFileSync(join(OUT_DIR, "head/AppShell/index.html"), "utf-8");
    expect(headFile).toBe('<head><title>Test</title><link rel="stylesheet" href="/common.css"></head>');

    const bodyFile = readFileSync(join(OUT_DIR, "body/AppShell/index.html"), "utf-8");
    // Real placeholder MARKERS, not the resolved widget HTML — body/index.html
    // stays shell-type-scoped (same for every page using this shell), the
    // actual per-page widget content only gets spliced in at compose time.
    expect(bodyFile).toBe(
      '<body class="shell-body"><div data-widget-placeholder="badge-1" data-widget-type="Badge"></div>' +
        '<div data-widget-placeholder="card-1" data-widget-type="Card"></div></body>',
    );
  });

  test("a page with metadata gets its own head.html, rendered with { data: metadata }; composePageFromFiles uses it", async () => {
    const seoRender: RenderInstance = async (meta, props) => {
      if (meta.exportName === "AppHead") {
        const name = (props.data as { name?: string } | undefined)?.name ?? "Default";
        return { type: "title", props: { children: `Title ${name}` } };
      }
      return render(meta, props);
    };
    const seoSitemap: StreakBootSitemap = {
      shared: sitemap.shared,
      pages: [
        sitemap.pages[0]!,
        { url: "/no-meta", rootLayout: "AppShell", widgets: sitemap.pages[0]!.widgets },
      ],
    };
    const { pageManifests } = await buildPages({ registry, sitemap: seoSitemap, outDir: OUT_DIR, render: seoRender });
    const home = pageManifests.find((m) => m.url === "/")!;
    const noMeta = pageManifests.find((m) => m.url === "/no-meta")!;

    expect(home.headPath).toBe("pages/index/head.html");
    expect(readFileSync(join(OUT_DIR, "pages/index/head.html"), "utf-8")).toBe("<head><title>Title A</title></head>");
    expect(composePageFromFiles(home, OUT_DIR)).toContain("<title>Title A</title>");

    // No metadata: shared shell head, rendered with {}.
    expect(noMeta.headPath).toBeUndefined();
    expect(existsSync(join(OUT_DIR, "pages/no-meta/head.html"))).toBe(false);
    expect(composePageFromFiles(noMeta, OUT_DIR)).toContain("<title>Title Default</title>");
  });

  test("handlerCachePerPage: a handler runs once per page render (shared by that page's widgets), not once per whole build", async () => {
    let runs = 0;
    const loadName = handler({})(async (name: string) => {
      runs++;
      return name;
    });
    // The Card widget calls the same handler twice with the same input.
    const cachedRender: RenderInstance = async (meta, props) => {
      if (meta.filePath.endsWith("Card.tsx")) {
        await loadName("same");
        await loadName("same");
      }
      return render(meta, props);
    };

    await buildPages({ registry, sitemap, outDir: OUT_DIR, render: cachedRender, handlerCachePerPage: true });
    expect(runs).toBe(2); // two pages, one run each

    runs = 0;
    resetHandlerCache();
    await buildPages({ registry, sitemap, outDir: OUT_DIR, render: cachedRender });
    expect(runs).toBe(1); // default: one cache for the whole build
  });

  test("throws when a sitemap widget has no matching WidgetPlaceholder in its rootLayout", async () => {
    // Both real placeholders (badge-1, card-1) satisfied, PLUS one extra
    // sitemap widget the layout never references — isolates this
    // direction of the mismatch check from the other.
    const badSitemap: StreakBootSitemap = {
      pages: [
        {
          url: "/",
          rootLayout: "AppShell",
          widgets: [
            { id: "badge-1", ref: "SaleBadge" },
            { id: "card-1", type: "Card" },
            { id: "extra-1", type: "Card" },
          ],
        },
      ],
      shared: sitemap.shared,
    };
    await expect(buildPages({ registry, sitemap: badSitemap, outDir: OUT_DIR, render })).rejects.toThrow(
      /sitemap widget "extra-1" has no matching <WidgetPlaceholder/,
    );
  });

  test("throws when a WidgetPlaceholder has no matching sitemap widget", async () => {
    // Layout has two placeholders (badge-1, card-1); sitemap only supplies one.
    const badSitemap: StreakBootSitemap = {
      pages: [{ url: "/", rootLayout: "AppShell", widgets: [{ id: "card-1", type: "Card" }] }],
    };
    await expect(buildPages({ registry, sitemap: badSitemap, outDir: OUT_DIR, render })).rejects.toThrow(
      /rootLayout has <WidgetPlaceholder id="badge-1"\/> with no matching entry/,
    );
  });

  test("a ref widget's id defaults to the ref value when omitted", async () => {
    const refSitemap: StreakBootSitemap = {
      shared: sitemap.shared,
      pages: [{ url: "/", rootLayout: "AppShell", widgets: [{ ref: "SaleBadge" }, { id: "card-1", type: "Card" }] }],
    };
    const badRender: RenderInstance = async (meta, props) => {
      if (meta.filePath.endsWith("AppShell.tsx") && !["AppHtml", "AppHead", "AppBody"].includes(meta.exportName)) {
        return { type: Fragment, props: { children: [WidgetPlaceholder({ id: "SaleBadge", type: "Badge" }), WidgetPlaceholder({ id: "card-1", type: "Card" })] } };
      }
      return render(meta, props);
    };
    const { pageManifests } = await buildPages({ registry, sitemap: refSitemap, outDir: OUT_DIR, render: badRender });
    const home = pageManifests[0]!;
    expect(home.widgets.find((w) => w.type === "Badge")).toEqual({
      id: "SaleBadge",
      type: "Badge",
      shared: true,
      path: "widgets/Badge/SaleBadge",
      lazy: false,
      cssHref: null,
    });
  });

  test("throws when a shared ref points at an undeclared shared id", async () => {
    const badSitemap: StreakBootSitemap = {
      pages: [{ url: "/", rootLayout: "AppShell", widgets: [{ id: "badge-1", ref: "does-not-exist" }, { id: "card-1", type: "Card" }] }],
    };
    await expect(buildPages({ registry, sitemap: badSitemap, outDir: OUT_DIR, render })).rejects.toThrow(/unknown shared id/);
  });
});

describe("page-build.composePageFromFiles — pure fs + string splicing, no render() needed", () => {
  test("splices html skeleton + head + body + widget files together, unescaped (dev-style: direct <script src> tags, the old way)", async () => {
    const { pageManifests } = await buildPages({ registry, sitemap, outDir: OUT_DIR, render });
    const home = pageManifests.find((m) => m.url === "/")!;
    const page2 = pageManifests.find((m) => m.url === "/page-2")!;

    const homeHtml = composePageFromFiles(home, OUT_DIR);
    const page2Html = composePageFromFiles(page2, OUT_DIR);

    expect(homeHtml).toBe(
      '<html lang="en"><head><title>Test</title></head>' +
        '<body class="shell-body"><span>Sale</span><div>Card:A<button>Buy</button></div>' +
        '<script id="streak-common-script" src="/common.js"></script></body></html>',
    );
    expect(page2Html).toBe(
      '<html lang="en"><head><title>Test</title></head>' +
        '<body class="shell-body"><span>Sale</span><div>Card:B<button>Buy</button></div>' +
        '<script id="streak-common-script" src="/page-2/common.js"></script></body></html>',
    );

    // The shared widget's HTML is byte-identical across pages — true reuse,
    // not two independently-rendered copies that happen to look the same.
    expect(homeHtml).toContain("<span>Sale</span>");
    expect(page2Html).toContain("<span>Sale</span>");
  });

  test("inlineCss: true (build/serve) — links a single deferred root.js instead; app.js loads common.js itself, programmatically", async () => {
    const { pageManifests } = await buildPages({ registry, sitemap, outDir: OUT_DIR, render, inlineCss: true });
    const home = pageManifests.find((m) => m.url === "/")!;
    const html = composePageFromFiles(home, OUT_DIR);
    expect(html).toContain(`<script src="/__streak/root.js?v=${home.version}" defer></script>`);
    expect(html).not.toContain("/common.js");
  });

  test("a lazy widget keeps its placeholder marker instead of being resolved", async () => {
    const lazySitemap: StreakBootSitemap = {
      shared: sitemap.shared,
      pages: [
        {
          url: "/",
          rootLayout: "AppShell",
          metadata: { name: "A" },
          widgets: [
            { id: "badge-1", ref: "SaleBadge" },
            { id: "card-1", type: "Card", loadingStrategy: "lazy" },
          ],
        },
      ],
    };
    const { pageManifests } = await buildPages({ registry, sitemap: lazySitemap, outDir: OUT_DIR, render });
    const home = pageManifests[0]!;
    expect(home.widgets.find((w) => w.id === "card-1")!.lazy).toBe(true);

    const html = composePageFromFiles(home, OUT_DIR);
    // Eager badge resolved for real...
    expect(html).toContain("<span>Sale</span>");
    // ...lazy card left as its marker, not resolved, and NOT rendered at
    // build time either (Card.tsx's render was still called once, during
    // buildPages, to persist its own content.html file — but that file is
    // never spliced in here).
    expect(html).toContain('<div data-widget-placeholder="card-1" data-widget-type="Card"></div>');
    expect(html).not.toContain("Card:A");
  });

  test("never writes a combined page HTML file anywhere — composing is read-only", async () => {
    const { pageManifests } = await buildPages({ registry, sitemap, outDir: OUT_DIR, render });
    const home = pageManifests.find((m) => m.url === "/")!;

    composePageFromFiles(home, OUT_DIR);
    composePageFromFiles(home, OUT_DIR);

    expect(existsSync(join(OUT_DIR, "index.html"))).toBe(false);
    expect(existsSync(join(OUT_DIR, "pages/index/index.html"))).toBe(false);
    expect(existsSync(join(OUT_DIR, "public"))).toBe(false);
  });

  test("hasScript: false means no <script> tag", async () => {
    const scriptlessRender: RenderInstance = async (meta, props) => {
      if (meta.filePath.endsWith("Badge.tsx")) return { type: "span", props: { children: props.label as string } };
      if (meta.filePath.endsWith("AppShell.tsx")) {
        if (meta.exportName === "AppHtml") return {};
        if (meta.exportName === "AppHead") return null;
        if (meta.exportName === "AppBody") return {};
        return { type: Fragment, props: { children: [WidgetPlaceholder({ id: "badge-1", type: "Badge" })] } };
      }
      throw new Error(`no case for ${meta.filePath}`);
    };
    const scriptlessSitemap: StreakBootSitemap = {
      shared: [{ id: "PlainBadge", type: "Badge", props: { label: "Plain" } }],
      pages: [{ url: "/", rootLayout: "AppShell", widgets: [{ id: "badge-1", ref: "PlainBadge" }] }],
    };

    const { pageManifests } = await buildPages({ registry, sitemap: scriptlessSitemap, outDir: OUT_DIR, render: scriptlessRender });
    const home = pageManifests[0]!;
    expect(home.hasScript).toBe(false);

    const html = composePageFromFiles(home, OUT_DIR);
    expect(html).not.toContain("<script");
  });
});

describe("page-build.pageJsonHref / pageUrlFromJsonPath", () => {
  test("round-trips a page url through its index.json href", () => {
    expect(pageJsonHref("/")).toBe("/index.json");
    expect(pageJsonHref("/docs")).toBe("/docs/index.json");
    expect(pageUrlFromJsonPath("/index.json")).toBe("/");
    expect(pageUrlFromJsonPath("/docs/index.json")).toBe("/docs");
  });

  test("returns null for a path that isn't an index.json request", () => {
    expect(pageUrlFromJsonPath("/docs")).toBeNull();
    expect(pageUrlFromJsonPath("/common.js")).toBeNull();
  });
});

describe("page-build buildPages({ spa: true }) — index.json + spa-router.js, opt-in", () => {
  test("writes __streak/spa-router.js only when spa: true", async () => {
    await buildPages({ registry, sitemap, outDir: OUT_DIR, render });
    expect(existsSync(join(OUT_DIR, "__streak/spa-router.js"))).toBe(false);

    await buildPages({ registry, sitemap, outDir: OUT_DIR, render, spa: true });
    expect(existsSync(join(OUT_DIR, "__streak/spa-router.js"))).toBe(true);
    const content = readFileSync(join(OUT_DIR, "__streak/spa-router.js"), "utf-8");
    expect(content).toContain("jsonUrlFor");
  });

  test("composePageFromFiles links spa-router.js (+ root/app) only when spa: true, even with zero lazy widgets", async () => {
    const { pageManifests: spaManifests } = await buildPages({ registry, sitemap, outDir: OUT_DIR, render, spa: true, inlineCss: true });
    const spaHome = spaManifests.find((m) => m.url === "/")!;
    expect(spaHome.spa).toBe(true);
    const spaHtml = composePageFromFiles(spaHome, OUT_DIR);
    expect(spaHtml).toContain(`<script src="/__streak/root.js?v=${spaHome.version}" defer></script>`);
    expect(spaHtml).toContain(`<script src="/__streak/spa-router.js?v=${spaHome.version}" defer></script>`);

    const { pageManifests: plainManifests } = await buildPages({ registry, sitemap, outDir: OUT_DIR, render });
    const plainHome = plainManifests.find((m) => m.url === "/")!;
    expect(plainHome.spa).toBe(false);
    expect(composePageFromFiles(plainHome, OUT_DIR)).not.toContain("/__streak/spa-router.js");
  });

  test("composePageAsJson returns inner head/body content + attrs, matching composePageFromFiles' own pieces", async () => {
    const { pageManifests } = await buildPages({ registry, sitemap, outDir: OUT_DIR, render, inlineCss: true });
    const home = pageManifests.find((m) => m.url === "/")!;

    const json = composePageAsJson(home, OUT_DIR);
    expect(json.htmlAttributes).toEqual({ lang: "en" });
    expect(json.bodyAttributes).toEqual({ class: "shell-body" });
    // Inner content only — no wrapping <head>/<body> tag.
    expect(json.headHtml).not.toContain("<head");
    expect(json.headHtml).toContain("<title>Test</title>");
    expect(json.bodyHtml).not.toContain("<body");
    expect(json.bodyHtml).toContain("<span>Sale</span>"); // the eager badge, resolved
    // Never a literal <script> tag for the page's own bundle (would never
    // execute via innerHTML) — the router loads it explicitly instead.
    expect(json.bodyHtml).not.toContain("<script");
    // Same page version as every other build/serve asset URL.
    expect(json.scriptHref).toBe(`/common.js?v=${home.version}`);

    const composedHtml = composePageFromFiles(home, OUT_DIR);
    expect(composedHtml).toContain(json.headHtml);
    expect(composedHtml).toContain(json.bodyHtml);
  });

  test("composePageAsJson's scriptHref is null when the page has no script bundle", async () => {
    const scriptlessSitemap: StreakBootSitemap = {
      shared: [{ id: "PlainBadge", type: "Badge", props: { label: "Plain" } }],
      pages: [{ url: "/", rootLayout: "AppShell", widgets: [{ id: "badge-1", ref: "PlainBadge" }] }],
    };
    const scriptlessRender: RenderInstance = async (meta, props) => {
      if (meta.filePath.endsWith("Badge.tsx")) return { type: "span", props: { children: props.label as string } };
      if (meta.filePath.endsWith("AppShell.tsx")) {
        if (meta.exportName === "AppHtml") return {};
        if (meta.exportName === "AppHead") return null;
        if (meta.exportName === "AppBody") return {};
        return { type: Fragment, props: { children: [WidgetPlaceholder({ id: "badge-1", type: "Badge" })] } };
      }
      throw new Error(`no case for ${meta.filePath}`);
    };
    const { pageManifests } = await buildPages({ registry, sitemap: scriptlessSitemap, outDir: OUT_DIR, render: scriptlessRender });
    const home = pageManifests[0]!;
    expect(composePageAsJson(home, OUT_DIR).scriptHref).toBeNull();
  });
});

describe("page-build buildPages({ inlineCss: true }) — build/serve's combined <style>, computed per request", () => {
  test("combines common + shell + eager-widget CSS into one inline <style>; excludes lazy widgets' CSS", async () => {
    // Real CSS files, written directly at the paths findOwnCssFile/
    // findCommonCssFile expect — collectInlineCss reads real files off
    // disk, so this needs real files there, not just a synthetic
    // registry/render (which the top-of-file fixture never writes any for).
    mkdirSync(join(OUT_DIR, "head/AppShell"), { recursive: true });
    writeFileSync(join(OUT_DIR, "head/AppShell/AppShell.common.abc123.css"), "/* common */ body{margin:0}");
    mkdirSync(join(OUT_DIR, "widgets/Badge"), { recursive: true });
    writeFileSync(join(OUT_DIR, "widgets/Badge/Badge.def456.css"), ".badge{color:red}");
    mkdirSync(join(OUT_DIR, "widgets/Card"), { recursive: true });
    writeFileSync(join(OUT_DIR, "widgets/Card/Card.ghi789.css"), ".card{color:blue}");

    const lazySitemap: StreakBootSitemap = {
      shared: sitemap.shared,
      pages: [
        {
          url: "/",
          rootLayout: "AppShell",
          metadata: { name: "A" },
          widgets: [
            { id: "badge-1", ref: "SaleBadge" }, // eager
            { id: "card-1", type: "Card", loadingStrategy: "lazy" }, // lazy
          ],
        },
      ],
    };
    const { pageManifests } = await buildPages({ registry, sitemap: lazySitemap, outDir: OUT_DIR, render, inlineCss: true });
    const home = pageManifests[0]!;
    expect(home.inlineCss).toBe(true);

    // head/AppShell/index.html itself stays CSS-free — nothing baked in at build time.
    const headFile = readFileSync(join(OUT_DIR, "head/AppShell/index.html"), "utf-8");
    expect(headFile).not.toContain("<style");
    expect(headFile).not.toContain("<link");

    const composed = composePageFromFiles(home, OUT_DIR);
    expect(composed).toContain('<style id="streak-inline-css">');
    expect(composed).toContain("/* common */ body{margin:0}");
    expect(composed).toContain(".badge{color:red}"); // eager (ref) widget
    expect(composed).not.toContain(".card{color:blue}"); // lazy widget excluded
  });

  test("inlineCss: false (default) — composePageFromFiles adds no <style>, dev's baked <link>s (if any) pass through untouched", async () => {
    const { pageManifests } = await buildPages({ registry, sitemap, outDir: OUT_DIR, render, cssHrefs: ["/common.css"] });
    const home = pageManifests.find((m) => m.url === "/")!;
    expect(home.inlineCss).toBe(false);
    const composed = composePageFromFiles(home, OUT_DIR);
    expect(composed).not.toContain("<style");
    expect(composed).toContain('<link rel="stylesheet" href="/common.css">');
  });

  test("inlineCss: true minifies head() content (collapsing real whitespace) while CRITICAL_CSS_PLACEHOLDER — concatenated in AFTER, never minified itself — still round-trips correctly", async () => {
    const whitespaceRender: RenderInstance = async (meta, props) => {
      if (meta.exportName === "AppHead") {
        return {
          type: Fragment,
          props: {
            children: [{ type: "title", props: { children: "Test" } }, "   extra   whitespace   ", { type: "meta", props: { charSet: "utf-8" } }],
          },
        };
      }
      return render(meta, props);
    };
    const { pageManifests } = await buildPages({ registry, sitemap, outDir: OUT_DIR, render: whitespaceRender, inlineCss: true });
    const home = pageManifests.find((m) => m.url === "/")!;

    const CRITICAL_CSS_PLACEHOLDER = "<!--streak-critical-css-->";
    const headFile = readFileSync(join(OUT_DIR, "head/AppShell/index.html"), "utf-8");
    expect(headFile).toContain(CRITICAL_CSS_PLACEHOLDER);
    // Minification genuinely ran — the raw multi-space text node got
    // collapsed to single spaces, proving this isn't a no-op.
    expect(headFile).not.toContain("   extra   whitespace   ");
    expect(headFile).toContain(" extra whitespace ");

    // No real CSS files seeded for this fixture, so there's nothing to
    // inline — the point here is just that the placeholder round-trips
    // through minification and still gets found/replaced by
    // resolvePageParts' own exact-string match (empty combinedCss ->
    // replaced with "", not left as a dangling, un-replaced comment).
    const composed = composePageFromFiles(home, OUT_DIR);
    expect(composed).not.toContain(CRITICAL_CSS_PLACEHOLDER);
  });
});

describe("page-build.composeLazyWidgetFragment / lazy-runtime wiring", () => {
  const lazySitemap: StreakBootSitemap = {
    shared: sitemap.shared,
    pages: [
      {
        url: "/",
        rootLayout: "AppShell",
        metadata: { name: "A" },
        widgets: [
          { id: "badge-1", ref: "SaleBadge" },
          { id: "card-1", type: "Card", loadingStrategy: "lazy" },
        ],
      },
    ],
  };

  test("returns a real executable script embedding the lazy widget's own resolved HTML + script, not spliced into the page", async () => {
    const { pageManifests } = await buildPages({ registry, sitemap: lazySitemap, outDir: OUT_DIR, render });
    const home = pageManifests[0]!;

    const fragment = composeLazyWidgetFragment(home, "card-1", OUT_DIR);
    expect(fragment).not.toBeNull();
    expect(fragment).toContain('querySelector("[data-widget-placeholder=\\"card-1\\"]")');
    expect(fragment).toContain("Card:A");
    expect(fragment).toContain("<button>Buy</button>");
    expect(fragment).toContain("console.log(options.label)");
  });

  test("replaces the placeholder with EVERY top-level node of the widget, not only the first", async () => {
    // A widget with two root elements (backdrop + drawer) must keep both.
    const twoRootRender: RenderInstance = async (meta, props) =>
      meta.filePath.endsWith("Card.tsx")
        ? { type: Fragment, props: { children: [{ type: "div", props: { id: "backdrop" } }, { type: "aside", props: { id: "drawer" } }] } }
        : render(meta, props);
    const { pageManifests } = await buildPages({ registry, sitemap: lazySitemap, outDir: OUT_DIR, render: twoRootRender });
    const fragment = composeLazyWidgetFragment(pageManifests[0]!, "card-1", OUT_DIR)!;

    // Run the fragment against a minimal fake DOM and record what replaced the placeholder.
    let replacedWith: string[] = [];
    const placeholder = { replaceWith: (...nodes: { id: string }[]) => { replacedWith = nodes.map((n) => n.id); } };
    const fakeDocument = {
      querySelector: () => placeholder,
      createElement: () => ({
        set innerHTML(html: string) {
          this.childNodes = [...html.matchAll(/id="([^"]+)"/g)].map((m) => ({ id: m[1]! }));
        },
        childNodes: [] as { id: string }[],
      }),
    };
    new Function("document", fragment)(fakeDocument);
    expect(replacedWith).toEqual(["backdrop", "drawer"]);
  });

  test("returns null for an unknown id and for a non-lazy widget's id", async () => {
    const { pageManifests } = await buildPages({ registry, sitemap: lazySitemap, outDir: OUT_DIR, render });
    const home = pageManifests[0]!;
    expect(composeLazyWidgetFragment(home, "does-not-exist", OUT_DIR)).toBeNull();
    // badge-1 is eager, not lazy — the client runtime never needs it.
    expect(composeLazyWidgetFragment(home, "badge-1", OUT_DIR)).toBeNull();
  });

  test("content.json is self-sufficient for a direct client fetch — resolved html, cssHref, scriptHref", async () => {
    // Real CSS file at the path findOwnCssFile expects (see the
    // inlineCss:true describe block below for the same pattern).
    mkdirSync(join(OUT_DIR, "widgets/Card"), { recursive: true });
    writeFileSync(join(OUT_DIR, "widgets/Card/Card.ghi789.css"), ".card{color:blue}");

    const { pageManifests } = await buildPages({ registry, sitemap: lazySitemap, outDir: OUT_DIR, render, inlineCss: true });
    const home = pageManifests[0]!;
    const card = home.widgets.find((w) => w.id === "card-1")!;
    expect(card.cssHref).toBe("widgets/Card/Card.ghi789.css");

    const content = JSON.parse(readFileSync(join(OUT_DIR, card.path, "content.json"), "utf-8"));
    expect(content.cssHref).toBe("widgets/Card/Card.ghi789.css");
    expect(content.html).toContain("Card:A");
    expect(content.html).toContain("<button>Buy</button>");
    expect(content.scriptHref).toBe(`${card.path}/bundle.js`);
    // inlineCss: true also minifies JS (Bun.build) — the "options" local
    // gets renamed by real minification, but console.log(...) and the
    // ".label" PROPERTY access (never renamed by plain minify: true, only
    // local identifiers are) both survive, confirming the real logic is
    // still there, just smaller.
    const bundleSrc = readFileSync(join(OUT_DIR, content.scriptHref), "utf-8");
    expect(bundleSrc).toContain("console.log(");
    expect(bundleSrc).toContain(".label)");
  });

  test("composePageFromFiles stamps a lazy widget's marker with its own content.json path — build/serve only, not dev", async () => {
    const { pageManifests: devManifests } = await buildPages({ registry, sitemap: lazySitemap, outDir: OUT_DIR, render });
    const devHtml = composePageFromFiles(devManifests[0]!, OUT_DIR);
    expect(devHtml).not.toContain("data-widget-src");
    expect(devHtml).toContain('data-widget-placeholder="card-1"');

    const { pageManifests: builtManifests } = await buildPages({ registry, sitemap: lazySitemap, outDir: OUT_DIR, render, inlineCss: true });
    const builtHome = builtManifests[0]!;
    const card = builtHome.widgets.find((w) => w.id === "card-1")!;
    const builtHtml = composePageFromFiles(builtHome, OUT_DIR);
    expect(builtHtml).toContain(`data-widget-src="/${card.path}/content.json?v=${builtHome.version}"`);
  });

  test("dev mode links dev-runtime.js BEFORE the direct common.js tag — an eager widget's Script may call a gDom global synchronously, so it must already be defined", async () => {
    const orderSitemap: StreakBootSitemap = {
      shared: sitemap.shared,
      pages: [
        {
          url: "/",
          rootLayout: "AppShell",
          metadata: { name: "A" },
          widgets: [
            { id: "badge-1", ref: "SaleBadge", loadingStrategy: "lazy" }, // triggers needsRuntime
            { id: "card-1", type: "Card" }, // eager, HAS a script — ends up in common.js
          ],
        },
      ],
    };
    const { pageManifests } = await buildPages({ registry, sitemap: orderSitemap, outDir: OUT_DIR, render });
    const home = pageManifests[0]!;
    expect(home.hasScript).toBe(true); // Card's Script, eager

    const html = composePageFromFiles(home, OUT_DIR);
    const runtimeIdx = html.indexOf("/__streak/dev-runtime.js");
    const commonIdx = html.indexOf('id="streak-common-script"');
    expect(runtimeIdx).toBeGreaterThan(-1);
    expect(commonIdx).toBeGreaterThan(-1);
    expect(runtimeIdx).toBeLessThan(commonIdx);
  });

  test("PageManifest.version is a deterministic fingerprint of this page's own content — same content -> same version, different content -> different version", async () => {
    const { pageManifests: first } = await buildPages({ registry, sitemap: lazySitemap, outDir: OUT_DIR, render, inlineCss: true });
    const v1 = first[0]!.version;
    expect(v1).toBeTruthy();

    // Rebuilding with identical sitemap/render output is deterministic.
    const { pageManifests: rebuilt } = await buildPages({ registry, sitemap: lazySitemap, outDir: OUT_DIR, render, inlineCss: true });
    expect(rebuilt[0]!.version).toBe(v1);

    // A page-specific widget's content changing (different metadata ->
    // different rendered Card html) changes the version, even though
    // nothing about the URL/path structure changed.
    const changedSitemap: StreakBootSitemap = { ...lazySitemap, pages: [{ ...lazySitemap.pages[0]!, metadata: { name: "CHANGED" } }] };
    const { pageManifests: changed } = await buildPages({ registry, sitemap: changedSitemap, outDir: OUT_DIR, render, inlineCss: true });
    expect(changed[0]!.version).not.toBe(v1);
  });

  test("a SHARED lazy widget's marker gets the short /w/<id>/... URL (build only) — resolveShortAssetPath + w-index.json round-trip to the real path", async () => {
    const sharedLazySitemap: StreakBootSitemap = {
      shared: sitemap.shared,
      pages: [{ url: "/", rootLayout: "AppShell", metadata: { name: "A" }, widgets: [{ id: "badge-1", ref: "SaleBadge", loadingStrategy: "lazy" }, { id: "card-1", type: "Card" }] }],
    };

    // dev: no short prefix, no w-index.json at all.
    const { pageManifests: devManifests } = await buildPages({ registry, sitemap: sharedLazySitemap, outDir: OUT_DIR, render });
    expect(composePageFromFiles(devManifests[0]!, OUT_DIR)).not.toContain("data-widget-src");
    expect(existsSync(join(OUT_DIR, "w-index.json"))).toBe(false);

    // build: short /w/SaleBadge/content.json, resolvable back to the real path.
    const { pageManifests: builtManifests } = await buildPages({ registry, sitemap: sharedLazySitemap, outDir: OUT_DIR, render, inlineCss: true });
    const builtHome = builtManifests[0]!;
    const builtHtml = composePageFromFiles(builtHome, OUT_DIR);
    expect(builtHtml).toContain(`data-widget-src="/w/SaleBadge/content.json?v=${builtHome.version}"`);

    const wIndex = JSON.parse(readFileSync(join(OUT_DIR, "w-index.json"), "utf-8"));
    expect(wIndex.SaleBadge).toBe("widgets/Badge/SaleBadge");

    expect(resolveShortAssetPath(OUT_DIR, "/w/SaleBadge/content.json")).toBe("widgets/Badge/SaleBadge/content.json");
    expect(resolveShortAssetPath(OUT_DIR, "/w/does-not-exist/content.json")).toBeNull();
    expect(resolveShortAssetPath(OUT_DIR, "/c/banner-panel/content.json")).toBe("dynamic/banner-panel/content.json");
    expect(resolveShortAssetPath(OUT_DIR, "/pages/index/index.html")).toBeNull();
  });

  test("composePageFromFiles links the runtime when the page has a lazy widget — dev-style single dev-runtime.js tag by default, a single deferred root.js tag under inlineCss: true", async () => {
    const { pageManifests: lazyManifests } = await buildPages({ registry, sitemap: lazySitemap, outDir: OUT_DIR, render });
    const lazyHome = lazyManifests[0]!;
    expect(composePageFromFiles(lazyHome, OUT_DIR)).toContain('<script src="/__streak/dev-runtime.js"></script>');

    const { pageManifests: builtLazyManifests } = await buildPages({ registry, sitemap: lazySitemap, outDir: OUT_DIR, render, inlineCss: true });
    const builtLazyHome = builtLazyManifests[0]!;
    expect(composePageFromFiles(builtLazyHome, OUT_DIR)).toContain(`<script src="/__streak/root.js?v=${builtLazyHome.version}" defer></script>`);
  });

  test("composePageFromFiles links nothing at all for a page with no script, no lazy widget, no Dynamic slot, no spa", async () => {
    const scriptlessSitemap: StreakBootSitemap = {
      shared: [{ id: "PlainBadge", type: "Badge", props: { label: "Plain" } }],
      pages: [{ url: "/", rootLayout: "AppShell", widgets: [{ id: "badge-1", ref: "PlainBadge" }] }],
    };
    const scriptlessRender: RenderInstance = async (meta, props) => {
      if (meta.filePath.endsWith("Badge.tsx")) return { type: "span", props: { children: props.label as string } };
      if (meta.filePath.endsWith("AppShell.tsx")) {
        if (meta.exportName === "AppHtml") return {};
        if (meta.exportName === "AppHead") return null;
        if (meta.exportName === "AppBody") return {};
        return { type: Fragment, props: { children: [WidgetPlaceholder({ id: "badge-1", type: "Badge" })] } };
      }
      throw new Error(`no case for ${meta.filePath}`);
    };
    const { pageManifests } = await buildPages({ registry, sitemap: scriptlessSitemap, outDir: OUT_DIR, render: scriptlessRender });
    const home = pageManifests[0]!;
    const html = composePageFromFiles(home, OUT_DIR);
    expect(html).not.toContain("/__streak/root.js");
    expect(html).not.toContain("<script");
  });

  test("buildPages always writes real __streak/root.js, app.js, and asset-worker.js static files", async () => {
    await buildPages({ registry, sitemap, outDir: OUT_DIR, render });
    expect(existsSync(join(OUT_DIR, "__streak/root.js"))).toBe(true);
    expect(existsSync(join(OUT_DIR, "__streak/app.js"))).toBe(true);
    expect(existsSync(join(OUT_DIR, "__streak/asset-worker.js"))).toBe(true);
    const rootContent = readFileSync(join(OUT_DIR, "__streak/root.js"), "utf-8");
    expect(rootContent).toContain("addResourceToBody");
    const appContent = readFileSync(join(OUT_DIR, "__streak/app.js"), "utf-8");
    expect(appContent).toContain("data-widget-placeholder");
    const workerContent = readFileSync(join(OUT_DIR, "__streak/asset-worker.js"), "utf-8");
    expect(workerContent).toContain("LOAD_ASSET");
  });
});

describe("page-build Script collection — no combined file is ever persisted, joined fresh per request", () => {
  test("each widget instance persists its OWN script.js fragment; buildPages writes no combined per-page file", async () => {
    const { pageManifests } = await buildPages({ registry, sitemap, outDir: OUT_DIR, render });
    const home = pageManifests.find((m) => m.url === "/")!;

    expect(home.hasScript).toBe(true);
    // Card's own fragment — real, exact source text of the Script's
    // function, wrapped + called with (window, optionsJson).
    const cardScript = readFileSync(join(OUT_DIR, "pages/index/widgets/card-1/script.js"), "utf-8");
    expect(cardScript).toContain("console.log(options.label)");
    expect(cardScript).toContain('{"label":"Buy"}');
    expect(cardScript).toContain("__fn(window,");
    // No combined bundle written anywhere at build time.
    expect(existsSync(join(OUT_DIR, "common.js"))).toBe(false);
    expect(existsSync(join(OUT_DIR, "pages/index/common.js"))).toBe(false);
  });

  test("composeScriptBundle joins non-lazy widgets' fragments fresh, in memory; composePageFromFiles points <script src> at its virtual href (dev-style) — or links the deferred root.js chain instead under inlineCss: true", async () => {
    const { pageManifests } = await buildPages({ registry, sitemap, outDir: OUT_DIR, render });
    const home = pageManifests.find((m) => m.url === "/")!;
    const page2 = pageManifests.find((m) => m.url === "/page-2")!;

    const bundle = composeScriptBundle(home, OUT_DIR);
    expect(bundle).toContain("console.log(options.label)");
    // Never written to disk by composeScriptBundle either.
    expect(existsSync(join(OUT_DIR, "common.js"))).toBe(false);

    // Different pages get their own bundle (different Buy-button instance,
    // but same script text here — the point is the href differs, not the
    // content, since both pages' Card renders the same Script source).
    expect(composeScriptBundle(page2, OUT_DIR)).toBe(bundle);

    expect(pageScriptHref(home.url)).toBe("/common.js");
    expect(pageScriptHref(page2.url)).toBe("/page-2/common.js");

    const html = composePageFromFiles(home, OUT_DIR);
    expect(html).toContain('<script id="streak-common-script" src="/common.js"></script>');
    const html2 = composePageFromFiles(page2, OUT_DIR);
    expect(html2).toContain('<script id="streak-common-script" src="/page-2/common.js"></script>');

    // Under inlineCss: true, app.js computes the same href itself, at
    // runtime, from location.pathname — never a literal <script src> in
    // the composed HTML (see cli/app-script.ts).
    const { pageManifests: builtManifests } = await buildPages({ registry, sitemap, outDir: OUT_DIR, render, inlineCss: true });
    const builtHome = builtManifests.find((m) => m.url === "/")!;
    const builtHtml = composePageFromFiles(builtHome, OUT_DIR);
    expect(builtHtml).toContain(`<script src="/__streak/root.js?v=${builtHome.version}" defer></script>`);
    expect(builtHtml).not.toContain("/common.js");
  });

  test("a lazy widget's Script is excluded from both hasScript and composeScriptBundle's output", async () => {
    const lazySitemap: StreakBootSitemap = {
      shared: sitemap.shared,
      pages: [
        {
          url: "/",
          rootLayout: "AppShell",
          metadata: { name: "A" },
          widgets: [
            { id: "badge-1", ref: "SaleBadge" },
            { id: "card-1", type: "Card", loadingStrategy: "lazy" },
          ],
        },
      ],
    };
    const { pageManifests } = await buildPages({ registry, sitemap: lazySitemap, outDir: OUT_DIR, render });
    const home = pageManifests[0]!;
    // Card is the only Script source here, and it's lazy.
    expect(home.hasScript).toBe(false);
    expect(composeScriptBundle(home, OUT_DIR)).toBe("");
  });
});

describe("page-build common components — one level deep, declared in the sitemap, built separately per widget usage", () => {
  // Fresh, self-contained fixture (not the shared top-of-file one): a
  // "Panel" widget that uses <ComponentPlaceholder id="btn-1" type="Button"/>
  // instead of rendering a component inline, matching how a real widget
  // author opts a component into this separate-build/request-time-resolve
  // treatment instead of the plain nested-function-component path (still
  // covered separately by the "Card"/ButtonWithScript fixture above).
  const componentRegistry: Registry = {
    version: 1,
    generatedAt: new Date().toISOString(),
    widgets: { Panel: widgetMeta("Panel") },
    handlers: {},
    components: { Button: componentMeta("Button") },
    html: { AppShell: { ...shellMeta("AppShell"), exportName: "AppHtml" } },
    head: { AppShell: { ...shellMeta("AppShell"), exportName: "AppHead" } },
    body: { AppShell: { ...shellMeta("AppShell"), exportName: "AppBody" } },
    rootLayout: { AppShell: shellMeta("AppShell") },
    fileHashes: {},
  };

  const componentRender: RenderInstance = async (meta, props) => {
    if (meta.filePath.endsWith("Panel.tsx")) {
      const label = (props.data as { label?: string } | undefined)?.label ?? "";
      return {
        type: "div",
        props: { children: [`Panel:${label}`, ComponentPlaceholder({ id: "btn-1", type: "Button" })] },
      };
    }
    if (meta.filePath.endsWith("Button.tsx")) {
      return {
        type: Fragment,
        props: {
          children: [
            { type: "button", props: { children: (props.label as string) ?? "" } },
            Script({
              id: "btn-click",
              options: { label: props.label },
              // eslint-disable-next-line no-console
              children: (_gDom, options) => console.log(options.label),
            }),
          ],
        },
      };
    }
    if (meta.filePath.endsWith("AppShell.tsx")) {
      if (meta.exportName === "AppHtml") return {};
      if (meta.exportName === "AppHead") return null;
      if (meta.exportName === "AppBody") return {};
      return { type: Fragment, props: { children: [WidgetPlaceholder({ id: "panel-1", type: "Panel" })] } };
    }
    throw new Error(`render: no case for ${meta.filePath}`);
  };

  function sitemapWithComponents(
    components: { id: string; type: string; props?: Record<string, unknown>; loadingStrategy?: "lazy" }[],
    panelMetadata: Record<string, unknown> = { label: "Hi" },
  ): StreakBootSitemap {
    return {
      pages: [{ url: "/", rootLayout: "AppShell", metadata: panelMetadata, widgets: [{ id: "panel-1", type: "Panel", components }] }],
    };
  }

  test("component builds under the widget's own instance folder, keeps an unresolved marker in the widget's own persisted HTML", async () => {
    const sitemap = sitemapWithComponents([{ id: "btn-1", type: "Button", props: { label: "Click A" } }]);
    const { pageManifests } = await buildPages({ registry: componentRegistry, sitemap, outDir: OUT_DIR, render: componentRender });
    const home = pageManifests[0]!;
    const panel = home.widgets.find((w) => w.id === "panel-1")!;

    expect(panel.path).toBe("pages/index/widgets/panel-1");
    expect(existsSync(join(OUT_DIR, "pages/index/widgets/panel-1/components/btn-1/index.html"))).toBe(true);
    expect(existsSync(join(OUT_DIR, "pages/index/widgets/panel-1/components/btn-1/script.js"))).toBe(true);

    // The WIDGET's own persisted HTML keeps the marker, unresolved, at build time.
    const widgetHtml = readFileSync(join(OUT_DIR, "pages/index/widgets/panel-1/index.html"), "utf-8");
    expect(widgetHtml).toContain('data-component-placeholder="btn-1"');
    expect(widgetHtml).toContain('data-component-type="Button"');
    expect(widgetHtml).not.toContain("Click A");

    // The widget's own meta.json maps that marker to the component's real path.
    const widgetMetaJson = JSON.parse(readFileSync(join(OUT_DIR, "pages/index/widgets/panel-1/meta.json"), "utf-8"));
    expect(widgetMetaJson.components).toEqual([
      { id: "btn-1", type: "Button", path: "pages/index/widgets/panel-1/components/btn-1", lazy: false },
    ]);
  });

  test("composePageFromFiles resolves the component marker at request time; composeScriptBundle includes its script", async () => {
    const sitemap = sitemapWithComponents([{ id: "btn-1", type: "Button", props: { label: "Click A" } }]);
    const { pageManifests } = await buildPages({ registry: componentRegistry, sitemap, outDir: OUT_DIR, render: componentRender });
    const home = pageManifests[0]!;

    const html = composePageFromFiles(home, OUT_DIR);
    expect(html).toContain("Panel:Hi");
    expect(html).toContain("Click A");
    expect(html).not.toContain("data-component-placeholder");

    expect(home.hasScript).toBe(true);
    const bundle = composeScriptBundle(home, OUT_DIR);
    expect(bundle).toContain("console.log(options.label)");
    expect(bundle).toContain('{"label":"Click A"}');
  });

  test("two widgets using the same component type each get their own separately-built instance — no dedup", async () => {
    const sitemap = sitemapWithComponents([{ id: "btn-1", type: "Button", props: { label: "Click A" } }]);
    sitemap.pages.push({
      url: "/page-2",
      rootLayout: "AppShell",
      metadata: { label: "Bye" },
      widgets: [{ id: "panel-1", type: "Panel", components: [{ id: "btn-1", type: "Button", props: { label: "Click B" } }] }],
    });

    const { pageManifests } = await buildPages({ registry: componentRegistry, sitemap, outDir: OUT_DIR, render: componentRender });
    const home = pageManifests.find((m) => m.url === "/")!;
    const page2 = pageManifests.find((m) => m.url === "/page-2")!;

    expect(composePageFromFiles(home, OUT_DIR)).toContain("Click A");
    expect(composePageFromFiles(page2, OUT_DIR)).toContain("Click B");

    // Genuinely separate files, not a shared/deduped one.
    expect(existsSync(join(OUT_DIR, "pages/index/widgets/panel-1/components/btn-1/index.html"))).toBe(true);
    expect(existsSync(join(OUT_DIR, "pages/page-2/widgets/panel-1/components/btn-1/index.html"))).toBe(true);
  });

  test("a lazy component keeps its marker unresolved and is excluded from the script bundle", async () => {
    const sitemap = sitemapWithComponents([{ id: "btn-1", type: "Button", props: { label: "Click A" }, loadingStrategy: "lazy" }]);
    const { pageManifests } = await buildPages({ registry: componentRegistry, sitemap, outDir: OUT_DIR, render: componentRender });
    const home = pageManifests[0]!;

    const html = composePageFromFiles(home, OUT_DIR);
    expect(html).toContain('data-component-placeholder="btn-1"');
    expect(html).not.toContain("Click A");
    expect(composeScriptBundle(home, OUT_DIR)).toBe("");
  });

  test("throws when a widget's <ComponentPlaceholder> has no matching sitemap components[] entry", async () => {
    const sitemap = sitemapWithComponents([]);
    await expect(buildPages({ registry: componentRegistry, sitemap, outDir: OUT_DIR, render: componentRender })).rejects.toThrow(
      /has <ComponentPlaceholder id="btn-1"\/> with no matching entry/,
    );
  });

  test("throws when a sitemap component has no matching <ComponentPlaceholder> in the widget's render output", async () => {
    const sitemap = sitemapWithComponents([
      { id: "btn-1", type: "Button", props: { label: "Click A" } },
      { id: "extra-1", type: "Button", props: { label: "Extra" } },
    ]);
    await expect(buildPages({ registry: componentRegistry, sitemap, outDir: OUT_DIR, render: componentRender })).rejects.toThrow(
      /sitemap component "extra-1" has no matching <ComponentPlaceholder/,
    );
  });

  test("throws when a component's own render output contains another <ComponentPlaceholder> — one level only", async () => {
    const sitemap = sitemapWithComponents([{ id: "btn-1", type: "Button", props: { label: "Click A" } }]);
    const nestedRender: RenderInstance = async (meta, props) => {
      if (meta.filePath.endsWith("Button.tsx")) return ComponentPlaceholder({ id: "nested-1", type: "Button" });
      return componentRender(meta, props);
    };
    await expect(buildPages({ registry: componentRegistry, sitemap, outDir: OUT_DIR, render: nestedRender })).rejects.toThrow(
      /components are one level deep only/,
    );
  });

  test("throws when a rootLayout directly contains a <ComponentPlaceholder> instead of a widget using one", async () => {
    const sitemap = sitemapWithComponents([{ id: "btn-1", type: "Button", props: { label: "Click A" } }]);
    const badRender: RenderInstance = async (meta, props) => {
      if (meta.filePath.endsWith("AppShell.tsx") && !["AppHtml", "AppHead", "AppBody"].includes(meta.exportName)) {
        // Keeps the real WidgetPlaceholder (so the earlier widgets[]-vs-
        // placeholder cross-check still passes) but ALSO stray-adds a
        // ComponentPlaceholder directly in the rootLayout, which is what
        // this test means to catch.
        return {
          type: Fragment,
          props: { children: [WidgetPlaceholder({ id: "panel-1", type: "Panel" }), ComponentPlaceholder({ id: "stray-1", type: "Button" })] },
        };
      }
      return componentRender(meta, props);
    };
    await expect(buildPages({ registry: componentRegistry, sitemap, outDir: OUT_DIR, render: badRender })).rejects.toThrow(
      /<ComponentPlaceholder> can only be used inside a widget, not directly in a rootLayout/,
    );
  });
});

describe("page-build buildPages({ scopeClasses }) — CSS-Modules-style class prefixing, kept in sync with css-purge.ts's prefixCssClasses", () => {
  // Its own fixture: unlike the fixtures above, this one actually uses
  // className on the shell body, the widget's own root, and the
  // component's own root — the top-of-file fixtures never do, so they
  // can't exercise class rewriting at all.
  const scopedRegistry: Registry = {
    version: 1,
    generatedAt: new Date().toISOString(),
    widgets: { Panel: widgetMeta("Panel") },
    handlers: {},
    components: { Button: componentMeta("Button") },
    html: { AppShell: { ...shellMeta("AppShell"), exportName: "AppHtml" } },
    head: { AppShell: { ...shellMeta("AppShell"), exportName: "AppHead" } },
    body: { AppShell: { ...shellMeta("AppShell"), exportName: "AppBody" } },
    rootLayout: { AppShell: shellMeta("AppShell") },
    fileHashes: {},
  };

  const scopedRender: RenderInstance = async (meta) => {
    if (meta.filePath.endsWith("Panel.tsx")) {
      return { type: "div", props: { className: "card", children: [ComponentPlaceholder({ id: "btn-1", type: "Button" })] } };
    }
    if (meta.filePath.endsWith("Button.tsx")) {
      return { type: "button", props: { className: "btn", children: "Buy" } };
    }
    if (meta.filePath.endsWith("AppShell.tsx")) {
      if (meta.exportName === "AppHtml") return {};
      if (meta.exportName === "AppHead") return null;
      if (meta.exportName === "AppBody") return { className: "shell-body" };
      return { type: "div", props: { className: "layout", children: [WidgetPlaceholder({ id: "panel-1", type: "Panel" })] } };
    }
    throw new Error(`no case for ${meta.filePath}`);
  };

  const scopedSitemap: StreakBootSitemap = {
    pages: [{ url: "/", rootLayout: "AppShell", widgets: [{ id: "panel-1", type: "Panel", components: [{ id: "btn-1", type: "Button" }] }] }],
  };

  test("true: every class gets prefixed with a short deterministic code for its owner's own type — shell, widget, and component alike", async () => {
    const { pageManifests } = await buildPages({ registry: scopedRegistry, sitemap: scopedSitemap, outDir: OUT_DIR, render: scopedRender, scopeClasses: true });
    const home = pageManifests[0]!;

    const panelPrefix = shortScopePrefix("Panel");
    const buttonPrefix = shortScopePrefix("Button");
    const shellPrefix = shortScopePrefix("AppShell");

    const widgetHtml = readFileSync(join(OUT_DIR, "pages/index/widgets/panel-1/index.html"), "utf-8");
    expect(widgetHtml).toContain(`class="${panelPrefix}__card"`);

    const componentHtml = readFileSync(join(OUT_DIR, "pages/index/widgets/panel-1/components/btn-1/index.html"), "utf-8");
    expect(componentHtml).toContain(`class="${buttonPrefix}__btn"`);

    const bodyFragment = readFileSync(join(OUT_DIR, "body/AppShell/index.html"), "utf-8");
    expect(bodyFragment).toContain(`class="${shellPrefix}__shell-body"`); // <body>'s own class
    expect(bodyFragment).toContain(`class="${shellPrefix}__layout"`); // rootLayout's own wrapper class

    // The fully composed page has every layer's classes prefixed and
    // correctly spliced together — request-time composition never needs
    // to know scopeClasses was even used, since it's baked into the
    // persisted fragments already.
    const composed = composePageFromFiles(home, OUT_DIR);
    expect(composed).toContain(`class="${shellPrefix}__shell-body"`);
    expect(composed).toContain(`class="${shellPrefix}__layout"`);
    expect(composed).toContain(`class="${panelPrefix}__card"`);
    expect(composed).toContain(`class="${buttonPrefix}__btn"`);
  });

  test("true: a class declared in ANY entry's dynamicClasses stays unprefixed in every entry", async () => {
    // "card" declared by the Panel widget only — the Button component's
    // "card" stays global too, since the rule lives once in the common bundle.
    const globalRegistry: Registry = {
      ...scopedRegistry,
      widgets: { Panel: { ...widgetMeta("Panel"), dynamicClasses: ["card"], dynamicClassGroups: [["card"]] } },
    };
    const globalRender: RenderInstance = async (meta, props) => {
      if (meta.filePath.endsWith("Button.tsx")) return { type: "button", props: { className: "btn card", children: "Buy" } };
      return scopedRender(meta, props);
    };
    const { pageManifests } = await buildPages({ registry: globalRegistry, sitemap: scopedSitemap, outDir: OUT_DIR, render: globalRender, scopeClasses: true });
    const composed = composePageFromFiles(pageManifests[0]!, OUT_DIR);
    expect(composed).toContain('class="card"');
    expect(composed).toContain(`class="${shortScopePrefix("Button")}__btn card"`);
  });

  test("false (default): classes are left exactly as rendered, no prefix", async () => {
    const { pageManifests } = await buildPages({ registry: scopedRegistry, sitemap: scopedSitemap, outDir: OUT_DIR, render: scopedRender });
    const home = pageManifests[0]!;
    const composed = composePageFromFiles(home, OUT_DIR);
    expect(composed).toContain('class="shell-body"');
    expect(composed).toContain('class="layout"');
    expect(composed).toContain('class="card"');
    expect(composed).toContain('class="btn"');
  });
});

describe("page-build Dynamic components — build-time extraction, on-demand fetch fragment", () => {
  // Fresh, self-contained fixture: "Banner" widget whose own JSX contains
  // one <Dynamic id="banner-panel"> block with real inline content (a <p>)
  // plus its own <Script> — the exact shape all 3 real hello-streak-app
  // usages this session ported follow (inline children, not a separate
  // widget file).
  const dynRegistry: Registry = {
    version: 1,
    generatedAt: new Date().toISOString(),
    widgets: { Banner: widgetMeta("Banner") },
    handlers: {},
    components: {},
    html: { AppShell: { ...shellMeta("AppShell"), exportName: "AppHtml" } },
    head: { AppShell: { ...shellMeta("AppShell"), exportName: "AppHead" } },
    body: { AppShell: { ...shellMeta("AppShell"), exportName: "AppBody" } },
    rootLayout: { AppShell: shellMeta("AppShell") },
    fileHashes: {},
  };

  const dynRender: RenderInstance = async (meta) => {
    if (meta.filePath.endsWith("Banner.tsx")) {
      return {
        type: Fragment,
        props: {
          children: [
            { type: "h1", props: { children: "Banner" } },
            Dynamic({
              id: "banner-panel",
              children: {
                type: Fragment,
                props: {
                  children: [
                    { type: "p", props: { children: "Secret panel content" } },
                    // eslint-disable-next-line no-console
                    Script({ id: "panel-script", options: {}, children: () => console.log("panel script ran") }),
                  ],
                },
              },
            }),
          ],
        },
      };
    }
    if (meta.filePath.endsWith("AppShell.tsx")) {
      if (meta.exportName === "AppHtml") return {};
      if (meta.exportName === "AppHead") return null;
      if (meta.exportName === "AppBody") return {};
      return { type: Fragment, props: { children: [WidgetPlaceholder({ id: "banner-1", type: "Banner" })] } };
    }
    throw new Error(`no case for ${meta.filePath}`);
  };

  const dynSitemap: StreakBootSitemap = {
    pages: [{ url: "/", rootLayout: "AppShell", widgets: [{ id: "banner-1", type: "Banner" }] }],
  };

  test("extracts the Dynamic block out of the owning widget's own persisted HTML, replacing it with an empty marker", async () => {
    const { pageManifests } = await buildPages({ registry: dynRegistry, sitemap: dynSitemap, outDir: OUT_DIR, render: dynRender });

    const bannerHtml = readFileSync(join(OUT_DIR, "pages/index/widgets/banner-1/index.html"), "utf-8");
    expect(bannerHtml).toContain("<h1>Banner</h1>");
    expect(bannerHtml).toContain('data-dynamic-slot="banner-panel"');
    expect(bannerHtml).not.toContain("Secret panel content");

    // The Dynamic block's own Script is excluded from the owning widget's
    // own script.js (deferred right along with its markup) — Banner has
    // no OTHER Script, so it writes none at all.
    expect(existsSync(join(OUT_DIR, "pages/index/widgets/banner-1/script.js"))).toBe(false);
    const home = pageManifests[0]!;
    expect(home.hasScript).toBe(false);
  });

  test("persists the Dynamic block's own html+script flat, by id, independent of any page/widget", async () => {
    await buildPages({ registry: dynRegistry, sitemap: dynSitemap, outDir: OUT_DIR, render: dynRender });

    const dynHtml = readFileSync(join(OUT_DIR, "dynamic/banner-panel/index.html"), "utf-8");
    expect(dynHtml).toContain("Secret panel content");
    const dynScript = readFileSync(join(OUT_DIR, "dynamic/banner-panel/script.js"), "utf-8");
    expect(dynScript).toContain('console.log("panel script ran")');
  });

  test("content.json is self-sufficient for a direct client fetch too — no cssHref of its own (shares its owner's)", async () => {
    await buildPages({ registry: dynRegistry, sitemap: dynSitemap, outDir: OUT_DIR, render: dynRender, inlineCss: true });

    const content = JSON.parse(readFileSync(join(OUT_DIR, "dynamic/banner-panel/content.json"), "utf-8"));
    expect(content.html).toContain("Secret panel content");
    expect(content.cssHref).toBeNull();
    expect(content.scriptHref).toBe("dynamic/banner-panel/script.js");
    expect(readFileSync(join(OUT_DIR, content.scriptHref), "utf-8")).toContain('console.log("panel script ran")');
  });

  test("a Dynamic slot's marker gets stamped with its own content.json path — build/serve only, not dev", async () => {
    const { pageManifests: devManifests } = await buildPages({ registry: dynRegistry, sitemap: dynSitemap, outDir: OUT_DIR, render: dynRender });
    const devHtml = composePageFromFiles(devManifests[0]!, OUT_DIR);
    expect(devHtml).not.toContain("data-dynamic-src");
    expect(devHtml).toContain('data-dynamic-slot="banner-panel"');

    const { pageManifests: builtManifests } = await buildPages({ registry: dynRegistry, sitemap: dynSitemap, outDir: OUT_DIR, render: dynRender, inlineCss: true });
    const builtHtml = composePageFromFiles(builtManifests[0]!, OUT_DIR);
    expect(builtHtml).toContain('data-dynamic-src="/c/banner-panel/content.json"');
  });

  test("composeDynamicFragment reads it back by id as a real executable script; null for an unknown id", async () => {
    await buildPages({ registry: dynRegistry, sitemap: dynSitemap, outDir: OUT_DIR, render: dynRender });

    const fragment = composeDynamicFragment("banner-panel", OUT_DIR);
    expect(fragment).toContain('querySelector("[data-dynamic-slot=\\"banner-panel\\"]")');
    expect(fragment).toContain("Secret panel content");
    expect(fragment).toContain("panel script ran");
    expect(composeDynamicFragment("does-not-exist", OUT_DIR)).toBeNull();
  });

  test("composePageFromFiles links the client runtime for a Dynamic slot even with zero lazy widgets", async () => {
    const { pageManifests } = await buildPages({ registry: dynRegistry, sitemap: dynSitemap, outDir: OUT_DIR, render: dynRender });
    const home = pageManifests[0]!;
    expect(home.widgets.every((w) => !w.lazy)).toBe(true);

    const html = composePageFromFiles(home, OUT_DIR);
    expect(html).toContain('<script src="/__streak/dev-runtime.js"></script>');
    expect(html).toContain('data-dynamic-slot="banner-panel"');
  });
});
