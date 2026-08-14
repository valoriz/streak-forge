export const HANDLERS_DIR = "src/handlers";
export const WIDGETS_DIR = "src/widgets";
export const LAYOUTS_DIR = "src/layouts";
export const PUBLIC_DIR = "public";

// Custom tag names our SSR'd markup uses as markers; post-processed into real
// HTML/anchors before the response goes out. Must match streak/components exactly.
export const customTags = {
  WIDGET: "widget",
  DYNAMIC: "dynamic",
  SCRIPT: "sf-script",
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

export const WIDGET_META_ID = "w-m";
export const HMR_ENDPOINT = "/__streak_hmr";
export const CONTENT_ENDPOINT = "/__streak/content";
