import { importFromDir, moduleExistsInDir } from "../moduleLoader";
import { withHandlerTimeoutWarning } from "./handlerTimeoutWarning";
import { COMMON_HANDLER_NAME } from "../constants";

/**
 * Loads and calls the reserved CommonHandler.ts (if the app has one) - a
 * silent no-op when absent, so this is fully optional for existing apps.
 * Wrapped in the same handler-timeout warning as any other data handler,
 * since a slow CommonHandler blocks every page that depends on it.
 */
export const getCommonHandlerData = async (handlerDir: string): Promise<Record<string, any> | undefined> => {
  if (!moduleExistsInDir(handlerDir, COMMON_HANDLER_NAME)) return undefined;

  const commonModule = await importFromDir(handlerDir, COMMON_HANDLER_NAME);
  const response = await withHandlerTimeoutWarning(commonModule.default(), COMMON_HANDLER_NAME);
  return response || undefined;
};
