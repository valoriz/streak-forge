import { minify_sync } from "terser";
import { createElement } from "../jsx/element";
import type { VNodeChild } from "../jsx/types";
import { customTags } from "../constants";

export interface WidgetPlaceholderProps {
  id: string;
  type: string;
}

export const WidgetPlaceholder = (props: WidgetPlaceholderProps) => {
  const { id, type } = props;
  if (!id || !type) {
    throw new Error(
      `WidgetPlaceholder requires both "id" and "type". Received id=${id}, type=${type}`,
    );
  }
  return createElement(customTags.WIDGET, { id, type });
};

export interface DynamicProps {
  id: string;
  children?: VNodeChild;
}

export const Dynamic = (props: DynamicProps) => {
  const { id, children } = props;
  if (!id) {
    throw new Error('Dynamic requires an "id" prop.');
  }
  return createElement(customTags.DYNAMIC, { id }, children);
};

export interface ScriptProps {
  id: string;
  nonce?: string;
  // A build-time transform (src/build/scriptTransform.ts) rewrites this from
  // a function into its already-serialized source string before the dev
  // server ever imports the widget file. The function type is kept as a
  // fallback for the (unlikely) case the transform didn't run.
  children: ((gDom: any, options?: any) => void) | string;
  options?: Record<string, any>;
}

// Marks where the per-render options data goes in the minified template
// below — a bare (undeclared) identifier reference, not a string literal, so
// terser's minifier leaves it completely untouched (it only renames variables
// it can prove are locally declared) regardless of how it mangles everything
// else around it. The optimization stage (streak-distiller-v2) substitutes
// this for the real, page-specific options JSON with a plain string replace —
// no minification needed there at all. See MINIFY_TEMPLATE_CACHE below for why
// this split exists.
const OPTS_PLACEHOLDER = "__SF_OPTS__";

// `fnSource` (the widget's authored Script logic) is a compile-time constant
// per widget component — scriptTransform.ts bakes it in once, before any
// page ever renders, so it's byte-identical across every page that uses this
// widget. Minifying it is the expensive part of building a script (confirmed
// by profiling streak-distiller-v2: this dominated its per-page build time).
// Since streak-forge always renders every page of a site in one process (see
// build/build.ts), a module-level cache keyed by fnSource means each unique
// widget script gets minified once per site build, no matter how many pages
// use it — not once per page.
const MINIFY_TEMPLATE_CACHE = new Map<string, string>();

const getMinifiedTemplate = (fnSource: string): string => {
  const cached = MINIFY_TEMPLATE_CACHE.get(fnSource);
  if (cached !== undefined) return cached;

  const wrapped = `((${fnSource})(window,${OPTS_PLACEHOLDER}));`;
  let template: string;
  try {
    const result = minify_sync(wrapped);
    if (!result.code) throw new Error("terser produced no output");
    template = result.code;
  } catch (error) {
    // A minify failure shouldn't break the whole build over what's ultimately
    // a size optimization — fall back to the unminified wrapper (still
    // correct, just larger) and surface the problem instead of silently
    // eating it.
    console.warn(`<Script>: failed to minify script content, shipping unminified. ${error instanceof Error ? error.message : error}`);
    template = wrapped;
  }

  MINIFY_TEMPLATE_CACHE.set(fnSource, template);
  return template;
};

export const Script = (props: ScriptProps) => {
  const { id, nonce, children, options } = props;
  const fnSource =
    typeof children === "string" ? children : children.toString();

  // JSON.stringify returns undefined (not a string) for values it can't
  // represent - a function, a symbol, or an object whose toJSON() returns
  // undefined - anywhere inside options. Left unguarded this surfaces as a
  // confusing internal crash ("undefined is not an object") deep inside
  // this framework file instead of pointing back at the actual widget.
  const optionsJson = JSON.stringify(options ?? {});
  if (optionsJson === undefined) {
    throw new Error(
      `<Script id="${id}">'s "options" prop must be JSON-serializable - it contains a value (e.g. a function or symbol) that JSON.stringify can't represent.`,
    );
  }

  const __html = getMinifiedTemplate(fnSource);
  return createElement(customTags.SCRIPT, {
    id,
    nonce,
    // Read by the optimization stage to substitute OPTS_PLACEHOLDER for this
    // page's actual data — a plain HTML attribute (not inlined into the
    // script content), so it goes through the framework's normal, already-
    // correct attribute escaping (renderToString.ts's escapeAttr) rather than
    // needing its own bespoke escaping here.
    "data-sf-opts": optionsJson,
    dangerouslySetInnerHTML: { __html },
  });
};

export interface PreloadProps {
  as: string;
  href: string;
  [key: string]: any;
}

export const Preload = (props: PreloadProps) => {
  return createElement(customTags.PRELOAD, { ...props });
};
