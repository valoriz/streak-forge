import { describe, expect, test, afterEach } from "bun:test";
import { rmSync } from "node:fs";
import { join } from "node:path";
import {
  buildPages,
  composePageFromFiles,
  type RenderInstance,
} from "../page-build";
import { recordPageRenders, renderKey } from "../render-record";
import { resolvePageWidgets } from "../page-widgets";
import { WidgetPlaceholder, Fragment, type VNode } from "../jsx";
import type {
  Registry,
  WidgetMeta,
  ShellMeta,
  StreakBootSitemap,
  SitemapPageEntry,
} from "../types";

/**
 * Widgets come from the rootLayout: typed / shared placeholders are fixed
 * slots (never listed in the sitemap), untyped ones are dynamic slots filled
 * from the page's `slots` (any number, in order, or none).
 */

const OUT_DIR = join(import.meta.dir, "slots-scratch");
afterEach(() => rmSync(OUT_DIR, { recursive: true, force: true }));

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
function shellMeta(exportName: string): ShellMeta {
  return {
    exportName,
    filePath: `/virtual/shell/Main.tsx`,
    type: "Main",
    dynamicClasses: [],
    dynamicClassGroups: [],
    sourceHash: "hash",
  };
}

const registry: Registry = {
  version: 1,
  generatedAt: new Date().toISOString(),
  widgets: {
    Header: widgetMeta("Header"),
    Footer: widgetMeta("Footer"),
    Hero: widgetMeta("Hero"),
    Promo: widgetMeta("Promo"),
    Text: widgetMeta("Text"),
  },
  handlers: {},
  components: {},
  html: { Main: shellMeta("MainHtml") },
  head: {},
  body: { Main: shellMeta("MainBody") },
  rootLayout: { Main: shellMeta("MainLayout") },
  fileHashes: {},
};

const layout: VNode = {
  type: Fragment,
  props: {
    children: [
      WidgetPlaceholder({ id: "header", type: "Header" }),
      { type: "main", props: { children: WidgetPlaceholder({ id: "main" }) } },
      WidgetPlaceholder({ id: "promo", shared: true }),
      WidgetPlaceholder({
        id: "footer",
        type: "Footer",
        loadingStrategy: "lazy",
      }),
    ],
  },
};

const render: RenderInstance = async (meta, props) => {
  const data = (props.data as { title?: string } | undefined) ?? {};
  switch (meta.exportName) {
    case "MainHtml":
      return { lang: "en" };
    case "MainBody":
      return {};
    case "MainLayout":
      return layout;
    case "Header":
      return {
        type: "header",
        props: { children: `Header:${data.title ?? ""}` },
      };
    case "Footer":
      return { type: "footer", props: { children: "Footer" } };
    case "Hero":
      return {
        type: "section",
        props: { children: `Hero:${data.title ?? ""}` },
      };
    case "Text":
      return { type: "p", props: { children: `Text:${data.title ?? ""}` } };
    case "Promo":
      return {
        type: "aside",
        props: { children: `Promo:${(props.label as string) ?? ""}` },
      };
  }
  throw new Error(`render: no case for ${meta.exportName}`);
};

const sitemap: StreakBootSitemap = {
  shared: [{ id: "promo", type: "Promo", props: { label: "Sale" } }],
  pages: [
    {
      url: "/",
      metadata: { title: "Home" },
      slots: {
        main: [
          { id: "hero", type: "Hero" },
          { id: "intro", type: "Text" },
          { id: "more", type: "Text", loadingStrategy: "lazy" },
        ],
      },
      // Old field: ignored.
      widgets: [{ id: "header", type: "Hero" }],
    },
    { url: "/empty", metadata: { title: "Empty" } },
  ],
};

describe("resolvePageWidgets", () => {
  test("fixed slots from the layout, dynamic slots from the page's slots, in document order", () => {
    expect(resolvePageWidgets(layout, sitemap.pages[0]!)).toEqual([
      { id: "header", type: "Header" },
      { id: "hero", type: "Hero", slot: "main" },
      { id: "intro", type: "Text", slot: "main" },
      { id: "more", type: "Text", loadingStrategy: "lazy", slot: "main" },
      { id: "promo", ref: "promo" },
      { id: "footer", type: "Footer", loadingStrategy: "lazy" },
    ]);
    expect(
      resolvePageWidgets(layout, sitemap.pages[1]!).map((w) =>
        "ref" in w ? w.ref : w.id,
      ),
    ).toEqual(["header", "promo", "footer"]);
  });

  test("ids must be unique across the page; dynamic entries must be { ref } or { id, type }", () => {
    const clash: SitemapPageEntry = {
      url: "/x",
      slots: { main: [{ id: "header", type: "Hero" }] },
    };
    expect(() => resolvePageWidgets(layout, clash)).toThrow(
      /two widgets with id "header"/,
    );
    const bad = {
      url: "/x",
      slots: { main: [{ id: "a" }] },
    } as unknown as SitemapPageEntry;
    expect(() => resolvePageWidgets(layout, bad)).toThrow(
      /neither \{ ref \} nor \{ id, type \}/,
    );
    const twice: VNode = {
      type: Fragment,
      props: {
        children: [
          WidgetPlaceholder({ id: "a", type: "Hero" }),
          WidgetPlaceholder({ id: "a" }),
        ],
      },
    };
    expect(() => resolvePageWidgets(twice, { url: "/x" })).toThrow(
      /two <WidgetPlaceholder id="a"\/>/,
    );
  });
});

describe("buildPages with slots", () => {
  test("composes fixed widgets on every page and the page's dynamic list in its slot", async () => {
    const { pageManifests } = await buildPages({
      registry,
      sitemap,
      outDir: OUT_DIR,
      render,
    });
    const home = pageManifests.find((m) => m.url === "/")!;
    const empty = pageManifests.find((m) => m.url === "/empty")!;

    expect(
      home.widgets.map((w) => [w.id, w.slot ?? null, w.shared, w.lazy]),
    ).toEqual([
      ["header", null, false, false],
      ["hero", "main", false, false],
      ["intro", "main", false, false],
      ["more", "main", false, true],
      ["promo", null, true, false],
      ["footer", null, false, true],
    ]);

    const homeHtml = composePageFromFiles(home, OUT_DIR);
    expect(homeHtml).toContain(
      "<header>Header:Home</header><main><section>Hero:Home</section><p>Text:Home</p>" +
        '<div data-widget-placeholder="more" data-widget-type="Text"></div></main>' +
        "<aside>Promo:Sale</aside>" +
        '<div data-widget-placeholder="footer" data-widget-type="Footer"></div>',
    );
    expect(homeHtml).not.toContain("data-widget-slot");

    // Same layout, nothing listed: the dynamic slot is empty, fixed slots are there.
    const emptyHtml = composePageFromFiles(empty, OUT_DIR);
    expect(emptyHtml).toContain(
      "<header>Header:Empty</header><main></main><aside>Promo:Sale</aside>",
    );
  });

  test("a fixed `shared` slot without a shared[] entry fails clearly", async () => {
    await expect(
      buildPages({
        registry,
        sitemap: { pages: [{ url: "/" }] },
        outDir: OUT_DIR,
        render,
      }),
    ).rejects.toThrow(/refs unknown shared id "promo"/);
  });

  test("stage 1 records the layout, the fixed and dynamic inline widgets, never the shared one", async () => {
    const record = await recordPageRenders(registry, sitemap.pages[0]!, render);
    const data = { data: sitemap.pages[0]!.metadata };
    const expected = [
      renderKey(registry.rootLayout.Main!, {}),
      renderKey(registry.widgets.Header!, data),
      renderKey(registry.widgets.Hero!, data),
      renderKey(registry.widgets.Text!, data),
      renderKey(registry.widgets.Footer!, data),
    ];
    expect(Object.keys(record).sort()).toEqual(expected.sort());
  });
});
