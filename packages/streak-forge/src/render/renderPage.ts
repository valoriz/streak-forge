import config from "../config";
import { importFromDir } from "../moduleLoader";
import { renderComponent } from "../jsxRender";
import { assemblePage } from "./postProcess";
import type { WidgetForAssembly } from "./postProcess";
import { buildClientScript } from "./clientRuntime";
import { withHandlerTimeoutWarning } from "../build/handlerTimeoutWarning";
import { getCommonHandlerData } from "../build/commonHandler";
import type { RenderConfig, WidgetProps } from "../types";

export const renderPage = async (
  pageUrl: string,
  renderConfig: RenderConfig,
): Promise<string> => {
  const { srcDir } = config;

  let dataMap: Record<string, any> = {};
  if (renderConfig.dataHandler) {
    // Fetched fresh on every render (no caching, unlike the once-per-build
    // behavior in buildPage.ts) - dev is a live server, so this should never
    // serve stale common data.
    const common = await getCommonHandlerData(srcDir.handlerDir);
    const handlerModule = await importFromDir(
      srcDir.handlerDir,
      renderConfig.dataHandler,
    );
    dataMap =
      (await withHandlerTimeoutWarning(
        handlerModule.default(renderConfig.metadata, { common }),
        renderConfig.dataHandler,
      )) || {};
  }

  const layoutModule = await importFromDir(
    srcDir.layoutsDir,
    renderConfig.rootLayout,
  );
  const layoutHtml = await renderComponent(
    layoutModule.default,
    renderConfig.metadata || {},
  );

  const widgets: WidgetForAssembly[] = await Promise.all(
    renderConfig.widgets.map(async (w) => {
      const widgetModule = await importFromDir(srcDir.widgetsDir, w.type);
      const props: WidgetProps = { data: dataMap[w.id] };
      const html = await renderComponent(widgetModule.default, props);
      const skeletonHtml =
        typeof widgetModule.skeleton === "function"
          ? await renderComponent(widgetModule.skeleton, props)
          : undefined;
      return {
        id: w.id,
        type: w.type,
        loadingStrategy: w.loadingStrategy,
        html,
        skeletonHtml,
      };
    }),
  );

  const assembled = assemblePage(layoutHtml, widgets, pageUrl);

  let doc = assembled.html;

  if (assembled.headLinks.length) {
    const headExtra = assembled.headLinks.join("");
    // Replacer *function*, not a string: a string replacement runs "$&", "$`",
    // "$'" etc. substitution, which corrupts injected <script> content that
    // legitimately contains "$&" (a minifier's `x&&y` short-circuit).
    doc = doc.includes("</head>")
      ? doc.replace("</head>", () => `${headExtra}</head>`)
      : doc + headExtra;
  }

  const trailingScripts = assembled.trailingScripts
    .map((s) => `<script id="${s.id}">${s.content}</script>`)
    .join("");
  // Core runtime FIRST — it defines the window-level helpers (geById,
  // loadDynamicComponent, addWidgetToBody, debounce, onVisible, ...) that a
  // widget's own trailing script may call synchronously at its top level.
  // Plain inline <script> tags execute in document order, so if a widget
  // script ran first it would call an undefined function - this ordering is
  // what guarantees the runtime is always ready before any widget script runs.
  const bodyExtra =
    buildClientScript(assembled.lazyWidgetIds) + trailingScripts;
  doc = doc.includes("</body>")
    ? doc.replace("</body>", () => `${bodyExtra}</body>`)
    : doc + bodyExtra;

  return `<!DOCTYPE html>${doc}`;
};
