import type { HandlerResponse, RenderConfig } from "@core/types";

export interface UserStreakConfig extends RenderConfig {
  rootLayoutOut?: string;
  dataHandlerOut?: HandlerResponse;
}
