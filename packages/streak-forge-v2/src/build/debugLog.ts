import config from "../config";

// Info-level output is opt-in (STREAK_DEBUG=true) - a normal run stays
// silent except for warnings/errors, matching the core package's own logging
// posture (warn/error only, no unsolicited info noise).
export const debugLog = (...args: unknown[]): void => {
  if (config.debug) console.info(...args);
};
