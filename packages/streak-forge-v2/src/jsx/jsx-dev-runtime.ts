import { jsx } from "./element";
import type { VNode } from "./types";

// Dev-mode automatic runtime entry (Bun/TS use this instead of jsx-runtime
// when transforming in development). Extra debug args are irrelevant for SSR.
export const jsxDEV = (
  type: VNode["type"],
  props: Record<string, any>,
): VNode => jsx(type, props);

export { jsxs, createElement } from "./element";
export { Fragment } from "./types";
export type { JSX } from "./types";
