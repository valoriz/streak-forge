export const Fragment = Symbol.for("streak.fragment");

export type ComponentFn = (props: any) => VNodeChild | Promise<VNodeChild>;

export interface VNode {
  type: string | ComponentFn | typeof Fragment;
  props: Record<string, any>;
}

export type VNodeChild =
  VNode | string | number | boolean | null | undefined | VNodeChild[];

// Picked up automatically by TS via jsxImportSource resolution (looks for a
// `JSX` namespace exported from "<jsxImportSource>/jsx-runtime"). Kept
// intentionally loose - widgets in this codebase don't need prop-level
// HTML attribute typing, just permissive JSX authoring. TS looks this up via
// a literal `namespace JSX` export - there's no ES module equivalent.
// eslint-disable-next-line @typescript-eslint/no-namespace
export namespace JSX {
  export type Element = VNode;
  export interface IntrinsicElements {
    [elemName: string]: any;
  }
  export interface ElementChildrenAttribute {
    children: unknown;
  }
}
