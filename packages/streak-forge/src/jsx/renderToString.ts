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

  const vnode = node as VNode;
  const { type, props } = vnode;

  if (type === Fragment) {
    return renderToString(props.children);
  }

  if (typeof type === "function") {
    const result = await type(props);
    return renderToString(result);
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
