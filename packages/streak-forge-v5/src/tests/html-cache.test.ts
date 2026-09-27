import { describe, expect, test } from "bun:test";
import {
  MemoryCacheStore,
  fragmentCacheKey,
  getOrRenderFragment,
  getOrComposePage,
  invalidatePage,
  invalidateFragment,
} from "../html-cache.js";
import type { WidgetMeta } from "../types.js";

const staticWidget: WidgetMeta = {
  exportName: "StaticBadge",
  filePath: "x",
  type: "StaticBadge",
  kind: "static",
  dynamicClasses: [],
  dynamicClassGroups: [],
  sourceHash: "abc",
};

const handlerWidget: WidgetMeta = {
  exportName: "ProductCard",
  filePath: "x",
  type: "ProductCard",
  kind: "handler",
  handlerName: "ProductHandler",
  dynamicClasses: [],
  dynamicClassGroups: [],
  sourceHash: "def",
};

describe("html-cache cache-key policy", () => {
  test("static widget key ignores instanceId (type+props only)", () => {
    const keyA = fragmentCacheKey(staticWidget, "instance-1", { label: "New" });
    const keyB = fragmentCacheKey(staticWidget, "instance-2", { label: "New" });
    expect(keyA).toBe(keyB); // same type + same props -> same cache entry regardless of instance
  });

  test("handler widget key includes instanceId (two instances never collide)", () => {
    const keyA = fragmentCacheKey(handlerWidget, "product-1", { price: 10 });
    const keyB = fragmentCacheKey(handlerWidget, "product-2", { price: 10 });
    expect(keyA).not.toBe(keyB); // same data, different instance -> different entries
  });

  test("handler widget key changes when data changes", () => {
    const keyA = fragmentCacheKey(handlerWidget, "product-1", { price: 10 });
    const keyB = fragmentCacheKey(handlerWidget, "product-1", { price: 20 });
    expect(keyA).not.toBe(keyB);
  });
});

describe("html-cache.getOrRenderFragment", () => {
  test("second call for identical key hits cache, render() not called again", async () => {
    const store = new MemoryCacheStore();
    let renders = 0;
    const render = async () => {
      renders++;
      return { html: "<div>x</div>", cssFile: null };
    };

    await getOrRenderFragment(store, staticWidget, "i1", { label: "New" }, render);
    await getOrRenderFragment(store, staticWidget, "i1", { label: "New" }, render);

    expect(renders).toBe(1);
  });
});

describe("html-cache two-tier page composition (open doubt #1)", () => {
  test("page is composed once, cached whole; second request never re-joins fragments", async () => {
    const pageStore = new MemoryCacheStore();
    const fragmentStore = new MemoryCacheStore();
    let renderCalls = 0;
    let joinCalls = 0;

    const render = async (widget: WidgetMeta) => {
      renderCalls++;
      return { html: `<w>${widget.type}</w>`, cssFile: `${widget.type}.css` };
    };
    const joinLayout = ({ html, cssFiles }: { html: string; cssFiles: string[] }) => {
      joinCalls++;
      return `<page css="${cssFiles.join(",")}">${html}</page>`;
    };

    const instances = [
      { widget: staticWidget, instanceId: "badge-1", data: { label: "New" } },
      { widget: handlerWidget, instanceId: "product-1", data: { price: 10 } },
    ];

    const first = await getOrComposePage(pageStore, fragmentStore, "/product/1", instances, render, joinLayout);
    const second = await getOrComposePage(pageStore, fragmentStore, "/product/1", instances, render, joinLayout);

    expect(first).toBe(second);
    expect(renderCalls).toBe(2); // rendered once per widget on the FIRST request only
    expect(joinCalls).toBe(1); // joined exactly once — second request served from page cache
  });

  test("invalidating one fragment does not invalidate the page cache automatically", async () => {
    const pageStore = new MemoryCacheStore();
    const fragmentStore = new MemoryCacheStore();
    const render = async (widget: WidgetMeta) => ({ html: `<w>${widget.type}</w>`, cssFile: null });
    const joinLayout = ({ html }: { html: string }) => `<page>${html}</page>`;
    const instances = [{ widget: handlerWidget, instanceId: "product-1", data: { price: 10 } }];

    await getOrComposePage(pageStore, fragmentStore, "/p", instances, render, joinLayout);
    invalidateFragment(fragmentStore, handlerWidget, "product-1", { price: 10 });

    // Page cache still holds the stale composed page — caller must explicitly
    // invalidatePage() too. This is intentional: fragment invalidation and
    // page invalidation are separate decisions (see module doc in html-cache.ts).
    const stillCached = pageStore.get("page:/p");
    expect(stillCached).toBeDefined();

    invalidatePage(pageStore, "/p");
    expect(pageStore.get("page:/p")).toBeUndefined();
  });
});
