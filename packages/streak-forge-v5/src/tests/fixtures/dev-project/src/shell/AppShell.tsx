// Relative import, not "streak-boot" — this fixture lives INSIDE the
// package's own source tree, and importing the package by its own name
// from within itself is an ambiguous case for TS's export-map resolution.
import { WidgetPlaceholder } from "../../../../../jsx.js";

export const AppHtml = html({})(() => ({ lang: "en" }));
export const AppHead = head({})(() => null);
export const AppBody = body({})(() => ({}));
export const AppRootLayout = rootLayout({})(() => WidgetPlaceholder({ id: "hello-1", type: "Hello" }));
