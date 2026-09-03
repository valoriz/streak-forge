import { importFromDir } from "../moduleLoader";
import { renderComponent } from "../jsxRender";
import { collectStyles, type StyleCollectDirs } from "./styleExtract";
import { withHandlerTimeoutWarning } from "./handlerTimeoutWarning";
import type { Progress } from "./progress";
import type { RenderConfig, WidgetProps } from "../types";

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

// Handler responses often carry fields with no widget attached (a `status`
// code, scratch data, etc.) - only `common` and per-widget-id keys are part
// of the documented dataHandlerOut contract, so anything else is dropped
// rather than leaking into the build artifact.
export const filterHandlerResponse = (response: Record<string, any>, widgetIds: string[]): Record<string, any> => {
  const filtered: Record<string, any> = {};
  if (response?.common !== undefined) filtered.common = response.common;
  for (const id of widgetIds) {
    if (response?.[id] !== undefined) filtered[id] = response[id];
  }
  return filtered;
};

export interface BuildPageDirs {
  handlerDir: string;
  widgetsDir: string;
  layoutsDir: string;
}

/**
 * Stage-1 build render for one page: renders the layout and every widget to
 * raw HTML (no placeholder substitution, no dynamic/script extraction, no
 * eager/lazy split - that's all deferred to whatever finalizes this later),
 * and collects (without stripping) any <style>/<link rel=stylesheet> content
 * into completeStyle (no purge for now - see purgeStyles.ts, currently
 * unwired). This "raw content" snapshot is what `build` writes to disk and
 * `dev-build` POSTs to a remote optimizer. `dirs`/`styleDirs` are resolved by
 * the caller (see render.ts) - this function has no opinion on prebuild
 * caches or cwd, so it works equally for local commands and external callers.
 */
export const buildPageData = async (
  renderConfig: RenderConfig,
  dirs: BuildPageDirs,
  styleDirs: StyleCollectDirs,
  progress?: Progress,
  common?: Record<string, any>,
): Promise<RawContent> => {
  const { handlerDir, widgetsDir, layoutsDir } = dirs;
  const widgetIds = renderConfig.widgets.map((w) => w.id);

  let dataHandlerOut: Record<string, any> = {};
  let notFound: boolean | undefined;
  if (renderConfig.dataHandler) {
    const handlerModule = await importFromDir(handlerDir, renderConfig.dataHandler);
    // Fired the instant the handler call begins (not just on completion) so a
    // consumer watching the progress stream can tell "started N ms ago, still
    // running" apart from "hasn't started yet" - the only stage that can
    // genuinely hang on external I/O, unlike layout/widgets/styles.
    progress?.updateProgress("dataHandlerStart", { stage: "dataHandlerStart" });
    const response = (await withHandlerTimeoutWarning(handlerModule.default(renderConfig.metadata, { common }), renderConfig.dataHandler)) || {};
    if (response.notFound) notFound = true;
    dataHandlerOut = filterHandlerResponse(response, widgetIds);
  }
  progress?.updateProgress("dataHandler", { stage: "dataHandler" });

  const layoutModule = await importFromDir(layoutsDir, renderConfig.rootLayout);
  const rootLayoutOut = await renderComponent(layoutModule.default, renderConfig.metadata || {});
  progress?.updateProgress("layout", { stage: "layout" });

  const commonData = dataHandlerOut.common as Record<string, any> | undefined;
  const widgets: WidgetOut[] = await Promise.all(
    renderConfig.widgets.map(async (w) => {
      const widgetModule = await importFromDir(widgetsDir, w.type);
      const props: WidgetProps = { data: dataHandlerOut[w.id], common: commonData };
      const out = await renderComponent(widgetModule.default, props);
      const sOut = typeof widgetModule.skeleton === "function" ? await renderComponent(widgetModule.skeleton, props) : "";
      return { id: w.id, type: w.type, loadingStrategy: w.loadingStrategy, out, sOut };
    }),
  );
  progress?.updateProgress("widgets", { stage: "widgets" });

  const styles = [...collectStyles(rootLayoutOut, styleDirs), ...widgets.flatMap((w) => collectStyles(w.out, styleDirs))];
  const completeStyle = styles.join("\n");
  progress?.updateProgress("styles", { stage: "styles" });

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
    completeStyle,
  };
};
