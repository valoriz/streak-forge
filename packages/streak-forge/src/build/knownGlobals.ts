import globals from "globals";

// Identifiers considered available inside a browser <script> context. Used by
// scriptTransform.ts to flag free variables in <Script> bodies that would
// otherwise silently become a ReferenceError once shipped to the browser -
// server-side closures never survive serialization, only `options` does.
//
// Sourced from the `globals` package - the same authoritative, actively
// maintained lists ESLint's own `env` presets use, so gaps (Image, Audio,
// Notification, WeakRef, ...) are a dependency bump, not one PR per missing
// name.
//   globals.browser  - every DOM/BOM constructor and function
//   globals.es2025   - every standard ECMAScript builtin (Math, JSON, Promise,
//                      parseInt, structuredClone, undefined, NaN, Infinity, ...)
export const KNOWN_GLOBALS = new Set<string>([
  ...Object.keys(globals.browser),
  ...Object.keys(globals.es2025),
  // the two values the Script API actually threads server -> browser
  "gDom",
  "options",
]);
