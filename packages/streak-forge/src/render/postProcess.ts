import { parse, HTMLElement } from "node-html-parser";
import {
  customTags,
  placeholderAttrs,
  resourceTypes,
  WIDGET_LOADING_STRATEGIES,
  SCRIPT_OPTS_ATTR,
  OPTS_PLACEHOLDER,
} from "../constants";
import { escapeRawTextElementContent } from "../jsx/renderToString";
import { putContent } from "./contentStore";
import type { ScriptItem } from "../types";

const extractScripts = (
  root: HTMLElement,
  seenIds: Set<string>,
): ScriptItem[] => {
  const scripts: ScriptItem[] = [];
  root.querySelectorAll(customTags.SCRIPT).forEach((el) => {
    const id = el.getAttribute("id");
    let content = el.innerHTML;
    if (id && content && !seenIds.has(id)) {
      // <Script>'s minified template is shared/cached across every instance
      // of the same widget script (see MINIFY_TEMPLATE_CACHE in
      // components/index.tsx) and only carries the literal OPTS_PLACEHOLDER
      // - the real per-render options JSON travels alongside it on
      // SCRIPT_OPTS_ATTR instead. Nothing downstream of this function (the
      // dev server's live-serving path) ever sees that attribute again, so
      // it has to be resolved into real JS right here, before content is
      // handed off - otherwise the browser executes a bare, undefined
      // identifier and throws.
      const opts = el.getAttribute(SCRIPT_OPTS_ATTR);
      if (opts && content.includes(OPTS_PLACEHOLDER)) {
        // Replacer function, not a string: string replacement runs "$&" /
        // "$`" / "$'" / "$$" substitution, which would corrupt option values
        // that contain a literal "$" (a price, a template hint, ...).
        content = content.replaceAll(OPTS_PLACEHOLDER, () => opts);
      }
      // The options JSON just spliced in (and, defensively, anything the
      // parser handed back) must not carry a live "</script" - a widget
      // passing an HTML snippet / embed code through `options` is common.
      scripts.push({ id, content: escapeRawTextElementContent(content) });
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

export interface DynamicComponentInfo {
  id: string;
  html: string;
  scripts: ScriptItem[];
}

interface ProcessedFragment {
  html: string;
  scripts: ScriptItem[];
  headLinks: string[];
  dynamicComponents: DynamicComponentInfo[];
}

// Strips <dynamic>/<script>/<preload> markers out of one widget's SSR
// output. <dynamic> blocks always get pulled out and replaced with a
// fetchable placeholder, regardless of whether the parent widget itself
// ends up inline or lazy - this is what lets `<Dynamic id>` work correctly
// even inside a `loadingStrategy: "lazy"` widget: once the lazy widget's own
// HTML is inserted client-side, the placeholder anchor for its nested
// Dynamic block comes along with it and remains fetchable. What happens to
// the extracted dynamic content (dev's live contentStore vs build's
// dynamicComponents array) is the caller's decision, not this function's.
const processWidgetFragment = (
  html: string,
  scriptIds: Set<string>,
): ProcessedFragment => {
  const root = parse(html);
  const dynamicComponents: DynamicComponentInfo[] = [];

  root.querySelectorAll(customTags.DYNAMIC).forEach((el) => {
    const id = el.getAttribute("id");
    if (!id) {
      console.warn("<Dynamic> without an id found - removing.");
      el.remove();
      return;
    }
    const innerScripts = extractScripts(el, new Set());
    dynamicComponents.push({ id, html: el.innerHTML, scripts: innerScripts });
    el.replaceWith(skeletonPlaceholder(resourceTypes.DYNAMIC, id));
  });

  const headLinks = extractPreloads(root);
  const scripts = extractScripts(root, scriptIds);

  return { html: root.toString(), scripts, headLinks, dynamicComponents };
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

    const fragment = processWidgetFragment(widget.html, scriptIds);
    headLinks.push(...fragment.headLinks);
    fragment.dynamicComponents.forEach((dc) =>
      putContent(pageUrl, resourceTypes.DYNAMIC, dc),
    );

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
