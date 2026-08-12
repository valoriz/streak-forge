import type { RenderConfig, Widget } from "@core/types";

export interface ScriptListItem {
  id: string;
  content?: string;
  dependWidgetId?: string;
}

export interface WidgetOut extends Widget {
  out: string;
  scriptsOut?: ScriptListItem[];
}

export interface UserStreakConfig extends RenderConfig {
  rootLayoutOut: string;
  widgets: WidgetOut[];
}

export interface DynamicComponentInfo {
  html: string;
  scripts?: ScriptListItem[];
  id: string;
}

export interface UserStreakConfigOut extends UserStreakConfig {
  rootLayoutOut: string;
  css?: string;
  dynamicComponents: DynamicComponentInfo[];
  headContent?: string;
  rootLayoutScripts?: ScriptListItem[];
}

export type AddScriptOptions = {
  async?: boolean;
  defer?: boolean;
};

export type LoadedScriptsMap = {
  [src: string]: Promise<void>;
};

export interface CustomWindow extends Window {
  addResourceToBody: (src: string, options?: AddScriptOptions, callback?: Function) => void;
  addWidgetToBody: (src: string, callback?: Function, type?: string) => void;
  loadedScripts?: LoadedScriptsMap;
  loadedComponents?: string[];
  [key: string]: any;
}

export type LoadedResourcesMap = {
  [src: string]: Promise<void>;
};

export interface AddResourceOptions {
  async?: boolean;
  defer?: boolean;
  attributes?: Record<string, string>; // for custom attributes
}

export type WidgetScript = {
  id: string;
  dependWidgetId?: string;
  content: string;
};

export type WidgetResponse = {
  id: string;
  html?: string;
  scripts?: WidgetScript[];
};

export type WidgetMetadataItem = {
  id: string;
  v: string;
  ls?: string;
  ty?: string;
};
