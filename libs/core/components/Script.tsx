import type { FC } from "react";
import { createElement } from "react";

export interface GDom extends Window {
  loadDynamicComponent: (id: string, callback: (component: HTMLElement) => void) => void;
  document: Document;
  loadPackage: (name: string) => Promise<any>;
}

export interface ScriptProps {
  type?: string;
  id: string;
  nonce?: string;
  children: (gDom: GDom, options?: any) => void;
  options?: <T extends Record<string, any>>(options: T) => T;
}

const Script: FC<ScriptProps> = (props) => {
  const { children, options, nonce, ...rest } = props;
  const __html = `((${children.toString()})(window${options ? `,${JSON.stringify(options)}` : ""}));`;
  return createElement("sf-script", { nonce, ...rest, dangerouslySetInnerHTML: { __html } });
};

export default Script;
