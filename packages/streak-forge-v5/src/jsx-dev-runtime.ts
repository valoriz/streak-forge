import { jsx, type VNode } from "./jsx";

export { jsxs, Fragment } from "./jsx";
export type { JSX } from "./jsx";

// Picked up instead of jsx-runtime.ts when the compiler transforms in
// development mode. Extra debug args (source location, etc.) are irrelevant
// for server-side rendering, so this just forwards to jsx().
export const jsxDEV = (
  type: VNode["type"],
  props: Record<string, unknown> | null,
): VNode => jsx(type, props);
