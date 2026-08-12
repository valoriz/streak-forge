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
  widgets: Array<{
    id: string;
    type: string;
    loadingStrategy?: string;
    out?: string;
    sOut?: string;
    widgetOut: WidgetOut;
  }>;
}

export interface DynamicComponentInfo {
  id: string;
  html: string;
  scripts?: ScriptListItem[];
}

export interface UserStreakConfigOut extends UserStreakConfig {
  rootLayoutOut: string;
  criticalCss?: string;
  widgetCss?: string;
  dynamicComponents: DynamicComponentInfo[];
}
