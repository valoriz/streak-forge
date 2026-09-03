export interface Widget {
  id: string;
  type: string;
  loadingStrategy?: string;
}

export interface RenderConfig {
  renderId: string;
  metadata?: Record<string, any>;
  dataHandler?: string;
  rootLayout: string;
  widgets: Widget[];
  version: string;
  notFound?: boolean;
}

export interface StreakSitemapItem {
  url: string;
  renderConfig: RenderConfig;
}

export interface WidgetProps {
  data?: Record<string, any>;
  common?: Record<string, any>;
}

export interface ScriptItem {
  id: string;
  content: string;
}

// One widget's SSR output plus whatever <script id> tags it contained.
export interface WidgetRenderResult {
  id: string;
  type: string;
  loadingStrategy?: string;
  html: string;
  scripts: ScriptItem[];
}

// One <Dynamic id> block's SSR output, extracted out of its parent widget.
export interface DynamicRenderResult {
  id: string;
  html: string;
  scripts: ScriptItem[];
}

export interface RenderedPage {
  html: string;
  notFound?: boolean;
}
