import type { HandlerOptions, RenderConfig, WidgetProps } from "@core/types";
import type { UserStreakConfig } from "./types";
import { folderExists } from "@core/libs/commonUtils";
import path from "path";
import jsxToString from "@core/libs/jsxRender";
import { importModule } from "@core/utils";
import { WIDGET_LOADING_STRATEGIES } from "@core/libs/constants";

const widgetLoadingStrategiesSet = new Set(Object.values(WIDGET_LOADING_STRATEGIES));

const validationConfiguration = {
  widgets: (conf: RenderConfig) => {
    let message = null;
    const isValid = Array.isArray(conf.widgets)
      ? !conf.widgets.some((widget) => {
          if (
            !widget.id ||
            typeof widget.id !== "string" ||
            !widget.type ||
            typeof widget.type !== "string" ||
            (widget.loadingStrategy ? !widgetLoadingStrategiesSet.has(widget.loadingStrategy) : false)
          ) {
            if (!widget.id || typeof widget.id !== "string") {
              message = "Each widget must have a valid id of type string.";
              return true;
            }
            if (!widget.type || typeof widget.type !== "string") {
              message = "Each widget must have a valid type of type string.";
              return true;
            }
            if (widget.loadingStrategy && !widgetLoadingStrategiesSet.has(widget.loadingStrategy)) {
              message = "loadingStrategy must be one of " + Object.values(WIDGET_LOADING_STRATEGIES).join(", ") + ".";
              return true;
            }
          }
          return false;
        })
      : true;

    if (message) {
      return message;
    }

    return isValid;
  },
};

const renderWidgets =
  (options: { widgetsDir: string; srcDir: string; preBuildDir?: string }) => async (widgets: UserStreakConfig["widgets"], previousConfig: UserStreakConfig) => {
    const { widgetsDir, srcDir, preBuildDir } = options;

    const [firstWidget, ...restWidgets] = widgets;

    if (!firstWidget || typeof firstWidget !== "object" || !firstWidget.id || !firstWidget.type) {
      throw new Error("Invalid widget configuration. Each widget must have an id and type.");
    }

    const widgetPath = path.join(widgetsDir, firstWidget.type);

    const widgetModule = await importModule({
      srcDir,
      preBuildDir,
    })(path.resolve(widgetPath));

    if (!widgetModule || typeof widgetModule.default !== "function") {
      throw new Error(`Widget module not found or invalid at path: ${widgetPath}`);
    }

    const widgetProps: WidgetProps = {
      widgetId: firstWidget.id,
      widgetType: firstWidget.type,
      loadingStrategy: firstWidget.loadingStrategy || "lazy",
    };

    if (previousConfig.dataHandlerOut) {
      if (previousConfig.dataHandlerOut.common) {
        widgetProps.common = previousConfig.dataHandlerOut.common;
      }
      if (previousConfig.dataHandlerOut[firstWidget.id]) {
        widgetProps.data = previousConfig.dataHandlerOut[firstWidget.id] || {};
      }
    }

    const widgetHtml = await jsxToString(widgetModule.default)(widgetProps);
    const widgetSkeletonHtml = widgetModule.skeleton ? await jsxToString(widgetModule.skeleton)(widgetProps) : "";

    if (typeof widgetHtml !== "string") {
      throw new Error(`Widget ${firstWidget.id} did not return a valid string.`);
    }
    let renderedWidgets = {
      [firstWidget.id]: {
        html: widgetHtml,
        skeleton: widgetSkeletonHtml,
      },
    };

    if (renderWidgets && Array.isArray(restWidgets) && restWidgets.length > 0) {
      const restRenderedWidgets = await renderWidgets({ widgetsDir, srcDir, preBuildDir })(restWidgets, previousConfig);
      renderedWidgets = { ...renderedWidgets, ...restRenderedWidgets };
    }

    return renderedWidgets;
  };

const handler = (options: HandlerOptions) => async (previousConfig: UserStreakConfig) => {
  const { widgetsDir } = options.srcDir;
  const widgets = previousConfig.widgets;
  if (!(widgets && Array.isArray(widgets) && widgets.length > 0)) {
    return { ...previousConfig } as UserStreakConfig;
  }

  if (!folderExists(widgetsDir)) {
    throw new Error(`Widgets directory does not exist: ${widgetsDir}`);
  }

  const widgetsData = await renderWidgets({ widgetsDir, srcDir: options.srcDir.root, preBuildDir: options.srcDir.preBuildDir })(widgets, previousConfig);

  previousConfig.widgets = previousConfig.widgets.map((widget) => {
    if (widgetsData[widget.id]) {
      return { ...widget, out: widgetsData[widget.id]?.html, sOut: widgetsData[widget.id]?.skeleton };
    }
    return widget;
  });

  return previousConfig;
};

export { validationConfiguration as validation, handler };
