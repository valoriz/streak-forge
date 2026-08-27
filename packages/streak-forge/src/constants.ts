export const HANDLERS_DIR = "src/handlers";
export const WIDGETS_DIR = "src/widgets";
export const LAYOUTS_DIR = "src/layouts";
export const PUBLIC_DIR = "public";

// Custom tag names our SSR'd markup uses as markers; post-processed into real
// HTML/anchors before the response goes out. Must match streak/components exactly.
export const customTags = {
  WIDGET: "widget",
  DYNAMIC: "dynamic",
  SCRIPT: "script",
  PRELOAD: "preload",
} as const;

// Attributes used on the placeholder <div> left in place of a lazy widget or
// a <Dynamic> block, read by the client runtime to know what/where to fetch.
export const placeholderAttrs = {
  MARKER: "component-placeholder",
  TYPE: "component-type",
  ID: "component-id",
} as const;

export const resourceTypes = {
  WIDGET: "w",
  DYNAMIC: "c",
} as const;

export const WIDGET_LOADING_STRATEGIES = {
  DEFAULT: "__static__",
  LAZY: "lazy",
} as const;

// <Script>'s options bridge. The minified template embeds OPTS_PLACEHOLDER
// verbatim (shared/cached across every instance of the same widget script -
// see MINIFY_TEMPLATE_CACHE in components/index.tsx); the actual per-render
// JSON lives alongside it on SCRIPT_OPTS_ATTR. Something has to substitute
// one for the other before a browser ever executes the script - postProcess
// (dev/live-serving path) does it here; streak-distiller does the same
// substitution for the build path, working from the untouched raw output.
export const SCRIPT_OPTS_ATTR = "data-sf-opts";
export const OPTS_PLACEHOLDER = "__SF_OPTS__";

export const WIDGET_META_ID = "w-m";
export const HMR_ENDPOINT = "/__streak_hmr";
export const CONTENT_ENDPOINT = "/__streak/content";

// Data handler timing thresholds (ms): a warning once it's been pending this
// long, then escalating errors repeating from this point on - same idea as
// the legacy pageDataHandler module's DATA_HANDLER_THRESHOLD.
export const DATA_HANDLER_WARNING_THRESHOLD = 1000;
export const DATA_HANDLER_ERROR_THRESHOLD = 2000;

// Reserved, auto-discovered handler filename: called once per build (shared
// across every page) and on every dev render (uncached), its output is
// passed into every other data handler as { common }.
export const COMMON_HANDLER_NAME = "CommonHandler";

// Reserved, auto-discovered handler filename: runs before every page
// resolution (dev requests and each build/dev-build page) and may return a
// RenderConfig to render instead of the normal one - undefined means "skip".
export const MIDDLEWARE_NAME = "Middleware";
