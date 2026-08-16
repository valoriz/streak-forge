import { importFromDir, moduleExistsInDir } from "../moduleLoader";
import { withHandlerTimeoutWarning } from "./handlerTimeoutWarning";
import { MIDDLEWARE_NAME } from "../constants";
import type { RenderConfig } from "../types";

/**
 * Loads and calls the reserved Middleware.ts (if the app has one) - a silent
 * no-op when absent, so this is fully optional for existing apps. Returning
 * undefined means "skip - use the normal sitemap-resolved config"; returning
 * a RenderConfig means "render this instead". Wrapped in the same
 * handler-timeout warning as any other handler, since a slow Middleware
 * blocks the page it's resolving.
 */
export const resolveMiddleware = async (handlerDir: string, url: string, req?: Request): Promise<RenderConfig | undefined> => {
  if (!moduleExistsInDir(handlerDir, MIDDLEWARE_NAME)) return undefined;

  const middlewareModule = await importFromDir(handlerDir, MIDDLEWARE_NAME);
  const result = await withHandlerTimeoutWarning(middlewareModule.default(url, req), MIDDLEWARE_NAME);
  return result || undefined;
};
