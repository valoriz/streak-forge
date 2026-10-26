import {
  WidgetPlaceholder,
  isKind,
  type VNodeChild,
  type WidgetPlaceholderProps,
} from "./jsx";
import type { SitemapPageEntry, SitemapWidgetEntry } from "./types";

/**
 * Which widgets a page has, from its rootLayout's placeholders:
 *
 * - `<WidgetPlaceholder id type />`: fixed slot, always this widget type,
 *   rendered for the page (props.data = the page's metadata).
 * - `<WidgetPlaceholder id shared />`: fixed slot, the sitemap's `shared[]`
 *   entry with that id (built once per build).
 * - `<WidgetPlaceholder id />`: dynamic slot, the page's `slots[id]` list in
 *   order (inline entries or `{ ref }`s), or nothing.
 *
 * The sitemap never lists fixed slots, and a page's old `widgets` array is
 * ignored. Stage 1 (render-record.ts planPageRenders) and stage 2
 * (streak-boot, which has its own copy of this file) both call this on the
 * same rendered layout, so they agree on every render a page needs. Keep
 * the two copies identical.
 */

/** A page's widget, with the dynamic slot it sits in (absent = fixed slot,
 *  the widget's own id). */
export type PlacedWidget = SitemapWidgetEntry & { slot?: string };

/** Every WidgetPlaceholder in a rendered rootLayout, in document order.
 *  Same walk as resolvePlaceholders: placeholders sit directly in the
 *  layout's markup, not inside other components. */
export function collectWidgetPlaceholders(
  node: VNodeChild,
  out: WidgetPlaceholderProps[] = [],
): WidgetPlaceholderProps[] {
  if (node === null || node === undefined || typeof node !== "object")
    return out;
  if (Array.isArray(node)) {
    for (const child of node) collectWidgetPlaceholders(child, out);
    return out;
  }
  if (isKind(node.type, WidgetPlaceholder)) {
    out.push(node.props as unknown as WidgetPlaceholderProps);
    return out;
  }
  const children = node.props?.children as VNodeChild;
  if (children !== undefined) collectWidgetPlaceholders(children, out);
  return out;
}

export function isDynamicSlot(placeholder: WidgetPlaceholderProps): boolean {
  return !placeholder.type && !placeholder.shared;
}

/** A widget's instance id on its page. */
export function instanceId(w: SitemapWidgetEntry): string {
  return "ref" in w ? (w.id ?? w.ref) : w.id;
}

export function resolvePageWidgets(
  layoutVNode: VNodeChild,
  page: SitemapPageEntry,
): PlacedWidget[] {
  const widgets: PlacedWidget[] = [];
  const slotIds = new Set<string>();
  for (const p of collectWidgetPlaceholders(layoutVNode)) {
    if (!p.id)
      throw new Error(
        `page "${page.url}": rootLayout has a <WidgetPlaceholder> without an id`,
      );
    if (slotIds.has(p.id))
      throw new Error(
        `page "${page.url}": rootLayout has two <WidgetPlaceholder id="${p.id}"/>`,
      );
    slotIds.add(p.id);
    const lazy =
      p.loadingStrategy === "lazy" ? { loadingStrategy: "lazy" as const } : {};
    if (p.shared) widgets.push({ id: p.id, ref: p.id, ...lazy });
    else if (p.type) widgets.push({ id: p.id, type: p.type, ...lazy });
    else {
      const entries = page.slots?.[p.id] ?? [];
      if (!Array.isArray(entries))
        throw new Error(
          `page "${page.url}": slots["${p.id}"] must be a list of widgets`,
        );
      for (const entry of entries) {
        const valid =
          "ref" in entry
            ? typeof entry.ref === "string"
            : typeof entry.id === "string" && typeof entry.type === "string";
        if (!valid)
          throw new Error(
            `page "${page.url}": slots["${p.id}"] has an entry that is neither { ref } nor { id, type }`,
          );
        widgets.push({ ...entry, slot: p.id });
      }
    }
  }
  const seen = new Set<string>();
  for (const w of widgets) {
    const id = instanceId(w);
    if (seen.has(id))
      throw new Error(
        `page "${page.url}": two widgets with id "${id}" (ids must be unique across the page's slots)`,
      );
    seen.add(id);
  }
  return widgets;
}
