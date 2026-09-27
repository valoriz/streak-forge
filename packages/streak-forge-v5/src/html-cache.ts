import type { RenderedFragment, WidgetMeta } from "./types.js";
import { hashValue } from "./hash.js";

/**
 * Two-tier cache (answers open doubt #1 — composed page cached whole, not
 * reassembled from fragments every request):
 *
 *   Tier 1 (fragment cache): one entry per widget instance. Used to avoid
 *     re-rendering a widget when only ITS data/props changed, and to avoid
 *     re-running a handler unnecessarily. NOT what serves normal traffic.
 *
 *   Tier 2 (page cache): one entry per fully-composed URL. THIS is the
 *     primary read path on every request — join fragments once, cache the
 *     joined HTML, serve that cache on every subsequent hit. Fragment cache
 *     only gets consulted again when a page rebuild is triggered (one
 *     widget's data changed) so the OTHER widgets on that page don't need
 *     to re-render — just re-read from tier 1 and re-join.
 *
 * Cache key policy (answers open doubt #2):
 *   - static widget  -> key = widgetType + hash(props)
 *   - handler widget -> key = widgetType + widgetInstanceId + hash(handlerOutput)
 *   (id is included for handler widgets because two instances of the same
 *   widget type on one page, e.g. two ProductCard widgets, must not collide
 *   even if their data happens to hash the same at some point in time.)
 */

export interface CacheStore {
  get(key: string): RenderedFragment | undefined;
  set(key: string, value: RenderedFragment): void;
  delete(key: string): void;
}

/** In-memory reference implementation. Swap for KV/R2/Redis in production —
 *  same interface, this is here so the test-app and unit tests don't need
 *  a real edge store to exercise the caching logic. */
export class MemoryCacheStore implements CacheStore {
  private map = new Map<string, RenderedFragment>();
  get(key: string) {
    return this.map.get(key);
  }
  set(key: string, value: RenderedFragment) {
    this.map.set(key, value);
  }
  delete(key: string) {
    this.map.delete(key);
  }
}

export function fragmentCacheKey(
  widget: WidgetMeta,
  instanceId: string,
  data: unknown,
): string {
  if (widget.kind === "static") {
    return `frag:static:${widget.type}:${hashValue(data)}`;
  }
  return `frag:handler:${widget.type}:${instanceId}:${hashValue(data)}`;
}

export function pageCacheKey(url: string): string {
  return `page:${url}`;
}

export interface FragmentRenderer {
  (widget: WidgetMeta, instanceId: string, data: unknown): Promise<{ html: string; cssFile: string | null }>;
}

export async function getOrRenderFragment(
  store: CacheStore,
  widget: WidgetMeta,
  instanceId: string,
  data: unknown,
  render: FragmentRenderer,
): Promise<RenderedFragment> {
  const key = fragmentCacheKey(widget, instanceId, data);
  const cached = store.get(key);
  if (cached) return cached;

  const { html, cssFile } = await render(widget, instanceId, data);
  const fragment: RenderedFragment = { html, cssFile, cachedAt: Date.now() };
  store.set(key, fragment);
  return fragment;
}

export interface PageWidgetInstance {
  widget: WidgetMeta;
  instanceId: string;
  data: unknown;
}

/**
 * Composes a page from its widget instances, using the fragment cache per
 * widget, then caches the JOINED result under the page's own URL — this is
 * the tier-2 cache that actually serves traffic (see module doc above).
 */
export async function getOrComposePage(
  pageStore: CacheStore,
  fragmentStore: CacheStore,
  url: string,
  instances: PageWidgetInstance[],
  render: FragmentRenderer,
  joinLayout: (fragments: { html: string; cssFiles: string[] }) => string,
): Promise<string> {
  const pageKey = pageCacheKey(url);
  const cachedPage = pageStore.get(pageKey);
  if (cachedPage) return cachedPage.html;

  const cssFiles: string[] = [];
  const htmlParts: string[] = [];

  for (const { widget, instanceId, data } of instances) {
    const fragment = await getOrRenderFragment(fragmentStore, widget, instanceId, data, render);
    htmlParts.push(fragment.html);
    if (fragment.cssFile) cssFiles.push(fragment.cssFile);
  }

  const composed = joinLayout({ html: htmlParts.join("\n"), cssFiles: [...new Set(cssFiles)] });
  pageStore.set(pageKey, { html: composed, cssFile: null, cachedAt: Date.now() });
  return composed;
}

/** Invalidate one page (e.g. content updated) without touching the fragment
 *  cache — other pages sharing the same widget fragments keep their cache. */
export function invalidatePage(pageStore: CacheStore, url: string): void {
  pageStore.delete(pageCacheKey(url));
}

/** Invalidate one widget instance's fragment — forces re-render + re-join
 *  next time ANY page containing it is requested (those pages' own page-cache
 *  entries must also be invalidated by the caller, since this function only
 *  knows about the fragment layer, not which pages reference it). */
export function invalidateFragment(
  fragmentStore: CacheStore,
  widget: WidgetMeta,
  instanceId: string,
  data: unknown,
): void {
  fragmentStore.delete(fragmentCacheKey(widget, instanceId, data));
}
