import path from "path";
import type { HandlerOptions, HandlerResponse, RenderConfig } from "@core/types";
import type { UserStreakConfig } from "./types";
import { folderExists } from "@core/libs/commonUtils";
import { DATA_HANDLER_THRESHOLD } from "@core/libs/constants";
import { importModule } from "@core/utils";

const validationConfiguration = {
  metadata: (conf: RenderConfig) => (conf.metadata ? (typeof conf.metadata === "object" ? true : "metadata must be an object.") : true),
  dataHandler: (conf: RenderConfig) => (conf.dataHandler ? (typeof conf.dataHandler === "string" ? true : "dataHandler must be a string.") : true),
};

const handler = (options: HandlerOptions) => async (previousConfig: RenderConfig) => {
  const { handlerDir, root: srcDir, preBuildDir } = options.srcDir;
  const dataHandler = previousConfig.dataHandler;
  if (!dataHandler) {
    return { ...previousConfig } as UserStreakConfig;
  }

  if (!folderExists(handlerDir)) {
    throw new Error(`Handler directory does not exist: ${handlerDir}`);
  }

  const currentHandlerPath = path.join(handlerDir, dataHandler);

  const handler = await importModule({
    srcDir,
    preBuildDir,
  })(currentHandlerPath);

  if (!handler || typeof handler !== "object") {
    throw new Error(`Handler not found or invalid at path: ${currentHandlerPath}`);
  }

  if (!handler.default || typeof handler.default !== "function") {
    throw new Error(`Handler does not export a default function at path: ${currentHandlerPath}`);
  }

  let timeoutCount = 1;

  const thresholdTimeout = setInterval(() => {
    console.info(
      `\x1b[${[33, "1m\x1b[33", 31, 91][timeoutCount - 1] || "1m\x1b[31"}m Data handler "${dataHandler}" took too long to respond, exceeding ${timeoutCount * DATA_HANDLER_THRESHOLD}ms.\x1b[0m`
    );
    timeoutCount++;
  }, DATA_HANDLER_THRESHOLD);

  let handlerResponse = null;

  try {
    handlerResponse = await handler.default(previousConfig.metadata, { widgets: previousConfig.widgets, renderId: previousConfig.renderId });
  } catch (error) {
    throw new Error(`Error executing data handler "${dataHandler}": ${(error as Error).message}`);
  } finally {
    clearInterval(thresholdTimeout);
  }

  const filteredResponse: HandlerResponse = {};

  if (handlerResponse.notFound) {
    console.warn(`Data handler "${dataHandler}" returned notFound: true. This indicates that the requested data was not found.`);
    return { ...previousConfig, dataHandlerOut: filteredResponse, notFound: true } as unknown as UserStreakConfig;
  }

  if (handlerResponse?.common) {
    filteredResponse.common = handlerResponse.common;
  }

  if (Array.isArray(previousConfig.widgets)) {
    previousConfig.widgets.forEach((widget) => {
      if (handlerResponse[widget.id]) {
        filteredResponse[widget.id] = handlerResponse[widget.id];
      }
    });
  }

  if (!Object.keys(filteredResponse).length) {
    if (Object.keys(handlerResponse).length) {
      throw new Error(`No specific response found for widgets, none of the values matched the widget IDs: ${Object.keys(handlerResponse).join(", ")}`);
    }
    console.warn(`No valid response found in handler: ${dataHandler}`);
  }

  return { ...previousConfig, dataHandlerOut: filteredResponse } as unknown as UserStreakConfig;
};

export { validationConfiguration as validation, handler };
