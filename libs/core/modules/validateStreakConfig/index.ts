import type { HandlerOptions, RenderConfig } from "@core/types";
import type { UserStreakConfig } from "./types";
import { WIDGET_LOADING_STRATEGIES } from "@core/libs/constants";

const widgetLoadingStrategiesSet = new Set(Object.values(WIDGET_LOADING_STRATEGIES));

const validationConfiguration = {
  self: (conf: RenderConfig) => (conf && typeof conf === "object" ? true : "Configuration must be an object."),
  renderId: (conf: RenderConfig) => (conf.renderId && typeof conf.renderId === "string" ? true : "renderId must be a non-empty string."),
  metadata: (conf: RenderConfig) => (conf.metadata ? (typeof conf.metadata === "object" ? true : "metadata must be an object.") : true),
  dataHandler: (conf: RenderConfig) => (conf.dataHandler ? (typeof conf.dataHandler === "string" ? true : "dataHandler must be a string.") : true),
  rootLayout: (conf: RenderConfig) => (conf.rootLayout && typeof conf.rootLayout === "string" ? true : "rootLayout must be a non-empty string."),
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

const handler = (options: HandlerOptions) => async (previousConfig: RenderConfig) => ({ ...previousConfig }) as UserStreakConfig;

export { validationConfiguration as validation, handler };
