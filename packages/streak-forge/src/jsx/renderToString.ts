import { Fragment } from "./types";
import type { VNode, VNodeChild } from "./types";

const VOID_TAGS = new Set([
  "area",
  "base",
  "br",
  "col",
  "embed",
  "hr",
  "img",
  "input",
  "link",
  "meta",
  "param",
  "source",
  "track",
  "wbr",
]);

const SKIP_PROPS = new Set([
  "children",
  "dangerouslySetInnerHTML",
  "key",
  "ref",
]);

const escapeText = (value: string) =>
  value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const escapeAttr = (value: string) =>
  value.replace(/&/g, "&amp;").replace(/"/g, "&quot;");

const kebabCase = (key: string) =>
  key.replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase();

const styleToCss = (
  style: Record<string, string | number | boolean | null | undefined>,
) =>
  Object.entries(style)
    .filter(([, v]) => v !== null && v !== undefined && v !== false)
    .map(([k, v]) => `${k.startsWith("--") ? k : kebabCase(k)}:${v}`)
    .join(";");

// Compact, safe-for-logging description of whatever reached the renderer -
// component functions become `[function Name]`, circular refs (e.g. a React
// element's _owner) don't throw, and the whole thing is length-capped.
const describeNode = (node: unknown): string => {
  try {
    const json = JSON.stringify(node, (_key, value) =>
      typeof value === "function"
        ? `[function ${value.name || "anonymous"}]`
        : value,
    );
    if (!json) return String(node);
    return json.length > 300 ? `${json.slice(0, 300)}…` : json;
  } catch {
    return Object.prototype.toString.call(node);
  }
};

const renderAttrs = (props: Record<string, any>): string => {
  let out = "";
  for (const key in props) {
    if (SKIP_PROPS.has(key)) continue;
    if (/^on[A-Z]/.test(key)) continue; // SSR only, no vdom event wiring

    const value = props[key];
    if (value === null || value === undefined || value === false) continue;

    const attrName =
      key === "className" ? "class" : key === "htmlFor" ? "for" : key;

    if (value === true) {
      out += ` ${attrName}`;
      continue;
    }
    if (attrName === "style" && typeof value === "object") {
      out += ` style="${escapeAttr(styleToCss(value))}"`;
      continue;
    }
    out += ` ${attrName}="${escapeAttr(String(value))}"`;
  }
  return out;
};

export const renderToString = async (node: VNodeChild): Promise<string> => {
  if (node === null || node === undefined || typeof node === "boolean")
    return "";
  if (typeof node === "string") return escapeText(node);
  if (typeof node === "number") return String(node);

  if (Array.isArray(node)) {
    const parts = await Promise.all(node.map(renderToString));
    return parts.join("");
  }

  // Reaching here means `node` is a non-null object that isn't an array. A
  // real VNode is `{ type, props }`. Anything else (a bare object literal
  // used instead of JSX, a Promise passed as a child, an element compiled
  // against a different JSX runtime) can't be rendered - fail with something
  // the app author can act on, not a TypeError deep inside this function.
  if (!("type" in node)) {
    throw new Error(
      `streak-forge: cannot render value as JSX - expected a { type, props } ` +
        `element, got ${describeNode(node)}. Common causes: a component ` +
        `returning a plain object instead of JSX, a raw Promise used as a ` +
        `child, or a component built against a different JSX runtime.`,
    );
  }

  const vnode = node as VNode;
  const { type } = vnode;

  if (type === undefined || type === null) {
    throw new Error(
      `streak-forge: JSX element has no "type" (${describeNode(node)}) - a ` +
        `component likely returned undefined, or a tag/component name ` +
        `resolved to nothing.`,
    );
  }

  // jsx() / createElement() always attach a props object; a missing one means
  // the node was hand-built (e.g. `{ type, children }`). Recover by treating
  // it as an empty element, but say so - it's almost always a bug and hard
  // to find otherwise.
  let props = vnode.props as Record<string, any> | undefined;
  if (props === undefined || props === null) {
    console.warn(
      `streak-forge: a <${typeof type === "string" ? type : "component"}> ` +
        `element reached the renderer with no props object - it was probably ` +
        `built by hand instead of with JSX/createElement. Rendering it with ` +
        `no attributes. Node: ${describeNode(node)}`,
    );
    props = {};
  }

  if (type === Fragment) {
    return renderToString(props.children);
  }

  if (typeof type === "function") {
    const result = await type(props);
    return renderToString(result);
  }

  if (typeof type !== "string") {
    throw new Error(
      `streak-forge: JSX element "type" must be a string tag, a component ` +
        `function, or Fragment - got ${typeof type} (${describeNode(node)}).`,
    );
  }

  // host element (string tag, including our custom marker tags)
  const attrs = renderAttrs(props);

  if (VOID_TAGS.has(type)) {
    return `<${type}${attrs}/>`;
  }

  const inner =
    props.dangerouslySetInnerHTML?.__html ??
    (await renderToString(props.children));

  return `<${type}${attrs}>${inner}</${type}>`;
};
