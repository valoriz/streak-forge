import { createElement } from "../jsx/element";
import type { VNodeChild } from "../jsx/types";
import { customTags } from "../constants";

export interface WidgetPlaceholderProps {
  id: string;
  type: string;
}

export const WidgetPlaceholder = (props: WidgetPlaceholderProps) => {
  const { id, type } = props;
  if (!id || !type) {
    throw new Error(
      `WidgetPlaceholder requires both "id" and "type". Received id=${id}, type=${type}`,
    );
  }
  return createElement(customTags.WIDGET, { id, type });
};

export interface DynamicProps {
  id: string;
  children?: VNodeChild;
}

export const Dynamic = (props: DynamicProps) => {
  const { id, children } = props;
  if (!id) {
    throw new Error('Dynamic requires an "id" prop.');
  }
  return createElement(customTags.DYNAMIC, { id }, children);
};

export interface ScriptProps {
  id: string;
  nonce?: string;
  // A build-time transform (src/build/scriptTransform.ts) rewrites this from
  // a function into its already-serialized source string before the dev
  // server ever imports the widget file. The function type is kept as a
  // fallback for the (unlikely) case the transform didn't run.
  children: ((gDom: any, options?: any) => void) | string;
  options?: Record<string, any>;
}

// Prevents an `options` value from breaking out of the inline <script> tag
// (e.g. a data-sourced string containing a literal closing script tag).
const SCRIPT_CLOSE_RE = /<\/(script)/gi;

const escapeForInlineScript = (json: string): string =>
  json.replace(SCRIPT_CLOSE_RE, "<\\/$1");

export const Script = (props: ScriptProps) => {
  const { id, nonce, children, options } = props;
  const fnSource =
    typeof children === "string" ? children : children.toString();
  const optionsArg = options
    ? `,${escapeForInlineScript(JSON.stringify(options))}`
    : "";
  const __html = `((${fnSource})(window${optionsArg}));`;
  return createElement(customTags.SCRIPT, {
    id,
    nonce,
    dangerouslySetInnerHTML: { __html },
  });
};

export interface PreloadProps {
  as: string;
  href: string;
  [key: string]: any;
}

export const Preload = (props: PreloadProps) => {
  return createElement(customTags.PRELOAD, { ...props });
};
