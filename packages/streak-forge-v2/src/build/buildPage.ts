import path from "path";
import { parse, HTMLElement } from "node-html-parser";
import config from "../config";
import { importFromDir } from "../moduleLoader";
import { renderComponent } from "../jsxRender";
import { collectStyles } from "./styleExtract";
import { HANDLERS_DIR, LAYOUTS_DIR, WIDGETS_DIR, customTags } from "../constants";
import type { RenderConfig, WidgetProps } from "../types";

// <Script> renders to a custom <sf-script> marker tag (same reasoning as
// <widget>/<dynamic>/<preload> staying raw elsewhere in this snapshot: it
// can't get accidentally executed or mangled by HTML tooling before it's
// meant to run) - but unlike those, the real <script> tag it represents is
// meant to actually ship as-is, so it gets swapped in here rather than left
// for a later stage that doesn't exist yet.
const convertSfScriptTags = (html: string): string => {
  if (!html.includes(`<${customTags.SCRIPT}`)) return html;
  const root = parse(html);
  root.querySelectorAll(customTags.SCRIPT).forEach((el) => {
    const script = parse(`<script></script>`).firstChild as HTMLElement;
    Object.entries(el.attributes).forEach(([key, value]) => script.setAttribute(key, value));
    script.innerHTML = el.innerHTML;
    el.replaceWith(script);
  });
  return root.toString();
};

export interface WidgetOut {
  id: string;
  type: string;
  loadingStrategy?: string;
  out: string;
  sOut: string;
}

export interface RawContent {
  renderId: string;
  metadata?: Record<string, any>;
  dataHandler?: string;
  rootLayout: string;
  version: string;
  notFound?: boolean;
  widgets: WidgetOut[];
  dataHandlerOut: Record<string, any>;
  rootLayoutOut: string;
  completeStyle: string;
}

// Build mode resolves modules from the pre-bundled cache (when `pre-build`
// has been run and READ_FROM_PREBUILD=1) instead of raw source, so a build
// never re-parses/re-transpiles TS - it just loads what pre-build already
// bundled. Falls back to source if the cache isn't there.
const resolveDir = (category: string, srcDir: string): string => (config.readFromPrebuild ? path.join(config.preBuildDir, category) : srcDir);

// Handler responses often carry fields with no widget attached (a `status`
// code, scratch data, etc.) - only `common` and per-widget-id keys are part
// of the documented dataHandlerOut contract, so anything else is dropped
// rather than leaking into the build artifact.
const filterHandlerResponse = (response: Record<string, any>, widgetIds: string[]): Record<string, any> => {
  const filtered: Record<string, any> = {};
  if (response?.common !== undefined) filtered.common = response.common;
  for (const id of widgetIds) {
    if (response?.[id] !== undefined) filtered[id] = response[id];
  }
  return filtered;
};

/**
 * Stage-1 build render for one page: renders the layout and every widget to
 * raw HTML (no placeholder substitution, no dynamic/script extraction, no
 * eager/lazy split - that's all deferred to whatever finalizes this later),
 * and collects (without stripping) any <style>/<link rel=stylesheet> content
 * into completeStyle. This "raw content" snapshot is what `build` writes to
 * disk and `dev-build` POSTs to a remote optimizer.
 */
export const buildPageData = async (renderConfig: RenderConfig): Promise<RawContent> => {
  const handlerDir = resolveDir(HANDLERS_DIR, config.srcDir.handlerDir);
  const layoutsDir = resolveDir(LAYOUTS_DIR, config.srcDir.layoutsDir);
  const widgetsDir = resolveDir(WIDGETS_DIR, config.srcDir.widgetsDir);
  const styleDirs = { publicDir: config.srcDir.publicDir, layoutsDir: config.srcDir.layoutsDir };

  const widgetIds = renderConfig.widgets.map((w) => w.id);

  let dataHandlerOut: Record<string, any> = {};
  let notFound: boolean | undefined;
  if (renderConfig.dataHandler) {
    const handlerModule = await importFromDir(handlerDir, renderConfig.dataHandler);
    const response = (await handlerModule.default()) || {};
    if (response.notFound) notFound = true;
    dataHandlerOut = filterHandlerResponse(response, widgetIds);
  }

  const layoutModule = await importFromDir(layoutsDir, renderConfig.rootLayout);
  const rootLayoutOut = convertSfScriptTags(await renderComponent(layoutModule.default, renderConfig.metadata || {}));

  const widgets: WidgetOut[] = await Promise.all(
    renderConfig.widgets.map(async (w) => {
      const widgetModule = await importFromDir(widgetsDir, w.type);
      const props: WidgetProps = { data: dataHandlerOut[w.id] };
      const out = convertSfScriptTags(await renderComponent(widgetModule.default, props));
      const sOut = typeof widgetModule.skeleton === "function" ? convertSfScriptTags(await renderComponent(widgetModule.skeleton, props)) : "";
      return { id: w.id, type: w.type, loadingStrategy: w.loadingStrategy, out, sOut };
    }),
  );

  const styles = [...collectStyles(rootLayoutOut, styleDirs), ...widgets.flatMap((w) => collectStyles(w.out, styleDirs))];

  return {
    renderId: renderConfig.renderId,
    metadata: renderConfig.metadata,
    dataHandler: renderConfig.dataHandler,
    rootLayout: renderConfig.rootLayout,
    version: renderConfig.version,
    notFound,
    widgets,
    dataHandlerOut,
    rootLayoutOut,
    completeStyle: styles.join("\n"),
  };
};
