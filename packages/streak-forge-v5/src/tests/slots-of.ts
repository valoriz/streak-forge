import type { SitemapWidgetEntry } from "../types";

/** Test helper: the old one-widget-per-placeholder sitemap shape as dynamic
 *  slots (the layouts in these tests use `<WidgetPlaceholder id />` with no
 *  type), so each listed widget fills the slot with its own id. */
export function slotsOf(
  widgets: SitemapWidgetEntry[],
): Record<string, SitemapWidgetEntry[]> {
  return Object.fromEntries(
    widgets.map((w) => ["ref" in w ? (w.id ?? w.ref) : w.id, [w]]),
  );
}
