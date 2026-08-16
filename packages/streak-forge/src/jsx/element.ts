import type { VNode, VNodeChild } from "./types";

// Automatic JSX runtime entry points (what the TS/Bun compiler calls for
// `<Foo a={1}>{children}</Foo>` when jsxImportSource points here).
export const jsx = (
  type: VNode["type"],
  props: Record<string, any>,
): VNode => ({ type, props: props || {} });
export const jsxs = jsx;

// Classic-style helper for the few places (streak/components) that build
// elements by hand instead of writing JSX.
export const createElement = (
  type: VNode["type"],
  config: Record<string, any> | null,
  ...children: VNodeChild[]
): VNode => {
  const props: Record<string, any> = { ...(config || {}) };
  if (children.length === 1) {
    props.children = children[0];
  } else if (children.length > 1) {
    props.children = children;
  }
  return { type, props };
};
