import { parse, HTMLElement } from "node-html-parser";
import {
  customTags,
  placeholderAttrs,
  resourceTypes,
  WIDGET_LOADING_STRATEGIES,
} from "../constants";
import { putContent } from "./contentStore";
import type { ScriptItem } from "../types";

const extractScripts = (
  root: HTMLElement,
  seenIds: Set<string>,
): ScriptItem[] => {
  const scripts: ScriptItem[] = [];
  root.querySelectorAll(customTags.SCRIPT).forEach((el) => {
    const id = el.getAttribute("id");
    const content = el.innerHTML;
    if (id && content && !seenIds.has(id)) {
      scripts.push({ id, content });
      seenIds.add(id);
    }
    el.remove();
  });
  return scripts;
};

const extractPreloads = (root: HTMLElement): string[] => {
  const links: string[] = [];
  root.querySelectorAll(customTags.PRELOAD).forEach((el) => {
    const attrs = Object.entries(el.attributes)
      .map(([k, v]) => `${k}="${v}"`)
      .join(" ");
    links.push(`<link rel="preload" ${attrs}/>`);
    el.remove();
  });
  return links;
};

const skeletonPlaceholder = (type: string, id: string, skeletonHtml?: string) =>
  `<div ${placeholderAttrs.MARKER} ${placeholderAttrs.TYPE}="${type}" ${placeholderAttrs.ID}="${id}">${
    skeletonHtml || `<span style="display:none"></span>`
  }</div>`;

interface ProcessedFragment {
  html: string;
  scripts: ScriptItem[];
  headLinks: string[];
}

// Strips <dynamic>/<sf-script>/<preload> markers out of one widget's SSR
// output. <dynamic> blocks always get pulled into the content store and
// replaced with a fetchable placeholder, regardless of whether the parent
// widget itself ends up inline or lazy - this is what lets `<Dynamic id>`
// work correctly even inside a `loadingStrategy: "lazy"` widget: once the
// lazy widget's own HTML is inserted client-side, the placeholder anchor for
// its nested Dynamic block comes along with it and remains fetchable.
const processWidgetFragment = (
  html: string,
  pageUrl: string,
  scriptIds: Set<string>,
): ProcessedFragment => {
  const root = parse(html);

  root.querySelectorAll(customTags.DYNAMIC).forEach((el) => {
    const id = el.getAttribute("id");
    if (!id) {
      console.warn("<Dynamic> without an id found - removing.");
      el.remove();
      return;
    }
    const innerScripts = extractScripts(el, new Set());
    putContent(pageUrl, resourceTypes.DYNAMIC, {
      id,
      html: el.innerHTML,
      scripts: innerScripts,
    });
    el.replaceWith(skeletonPlaceholder(resourceTypes.DYNAMIC, id));
  });

  const headLinks = extractPreloads(root);
  const scripts = extractScripts(root, scriptIds);

  return { html: root.toString(), scripts, headLinks };
};

export interface WidgetForAssembly {
  id: string;
  type: string;
  loadingStrategy?: string;
  html: string;
  skeletonHtml?: string;
}

export interface AssembledPage {
  html: string;
  headLinks: string[];
  trailingScripts: ScriptItem[];
  lazyWidgetIds: string[];
}

export const assemblePage = (
  layoutHtml: string,
  widgets: WidgetForAssembly[],
  pageUrl: string,
): AssembledPage => {
  const root = parse(layoutHtml);
  const headLinks: string[] = [];
  const trailingScripts: ScriptItem[] = [];
  const scriptIds = new Set<string>();
  const lazyWidgetIds: string[] = [];

  root.querySelectorAll(customTags.WIDGET).forEach((el) => {
    const id = el.getAttribute("id");
    const type = el.getAttribute("type");
    if (!id || !type) {
      console.warn("<WidgetPlaceholder> missing id/type - removing.");
      el.remove();
      return;
    }
    const widget = widgets.find((w) => w.id === id);
    if (!widget) {
      console.warn(
        `No render output for widget "${id}" - removing from layout.`,
      );
      el.remove();
      return;
    }

    const fragment = processWidgetFragment(widget.html, pageUrl, scriptIds);
    headLinks.push(...fragment.headLinks);

    const isLazy = widget.loadingStrategy === WIDGET_LOADING_STRATEGIES.LAZY;
    if (isLazy) {
      putContent(pageUrl, resourceTypes.WIDGET, {
        id,
        html: fragment.html,
        scripts: fragment.scripts,
      });
      lazyWidgetIds.push(id);
      el.replaceWith(
        skeletonPlaceholder(resourceTypes.WIDGET, id, widget.skeletonHtml),
      );
    } else {
      el.replaceWith(fragment.html);
      trailingScripts.push(...fragment.scripts);
    }
  });

  return { html: root.toString(), headLinks, trailingScripts, lazyWidgetIds };
};
