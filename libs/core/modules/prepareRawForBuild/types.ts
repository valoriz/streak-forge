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
  criticalCss?: string;
  widgetCss?: string;
  dynamicComponents: DynamicComponentInfo[];
  headContent?: string;
  rootLayoutScripts?: ScriptListItem[];
}
