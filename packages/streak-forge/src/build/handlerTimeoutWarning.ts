import { DATA_HANDLER_ERROR_THRESHOLD, DATA_HANDLER_WARNING_THRESHOLD } from "../constants";

// Same escalating color scheme as the legacy pageDataHandler module: yellow
// -> bold yellow -> red -> bright red -> bold red for anything beyond.
const ERROR_COLORS: (number | string)[] = [33, "1m\x1b[33", 31, 91];

// Warns once a data handler has been pending past DATA_HANDLER_WARNING_THRESHOLD,
// then escalates to repeating errors from DATA_HANDLER_ERROR_THRESHOLD onward -
// so a slow external data fetch shows up loudly in build output instead of
// silently stalling the whole render.
export const withHandlerTimeoutWarning = async (promise: Promise<any>, handlerName: string): Promise<any> => {
  const warnTimer = setTimeout(() => {
    console.warn(`\x1b[33m[!] Data handler "${handlerName}" is taking longer than ${DATA_HANDLER_WARNING_THRESHOLD}ms to respond.\x1b[0m`);
  }, DATA_HANDLER_WARNING_THRESHOLD);

  let errorCount = 1;
  const errorInterval = setInterval(() => {
    const color = ERROR_COLORS[errorCount - 1] ?? "1m\x1b[31";
    console.error(`\x1b[${color}m[!] Data handler "${handlerName}" took too long to respond, exceeding ${errorCount * DATA_HANDLER_ERROR_THRESHOLD}ms.\x1b[0m`);
    errorCount++;
  }, DATA_HANDLER_ERROR_THRESHOLD);

  try {
    return await promise;
  } finally {
    clearTimeout(warnTimer);
    clearInterval(errorInterval);
  }
};
