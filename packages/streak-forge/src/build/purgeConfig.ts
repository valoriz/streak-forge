import fs from "fs";
import path from "path";

export const PURGE_CONFIG_FILE = "purgecss.config.js";

// A RegExp can't cross JSON, so it travels as its parts and the optimizer
// (streak-distiller) rebuilds it on the other side.
export interface SerializedRegExp {
  source: string;
  flags: string;
}

export type PurgeMatcher = string | SerializedRegExp;

export interface PurgeConfig {
  safelist?:
    | PurgeMatcher[]
    | {
        standard?: PurgeMatcher[];
        deep?: SerializedRegExp[];
        greedy?: SerializedRegExp[];
        variables?: PurgeMatcher[];
        keyframes?: PurgeMatcher[];
      };
  blocklist?: PurgeMatcher[];
  dynamicAttributes?: string[];
  keyframes?: boolean;
  fontFace?: boolean;
  variables?: boolean;
}

// Only plain-data purgecss options are forwarded - functions (extractors etc.)
// can't be serialized, and options like `content`/`css` are the optimizer's
// own business, not the client's.
const MATCHER_LIST_KEYS = ["blocklist"] as const;
const BOOLEAN_KEYS = ["keyframes", "fontFace", "variables"] as const;
const SAFELIST_KEYS = ["standard", "deep", "greedy", "variables", "keyframes"] as const;

const toMatcher = (value: unknown): PurgeMatcher | undefined => {
  if (typeof value === "string") return value;
  if (value instanceof RegExp) return { source: value.source, flags: value.flags };
  return undefined;
};

const toMatcherList = (value: unknown, key: string): PurgeMatcher[] | undefined => {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) {
    console.warn(`streak-forge: ${PURGE_CONFIG_FILE}: "${key}" must be an array, ignored.`);
    return undefined;
  }
  return value.flatMap((item) => {
    const matcher = toMatcher(item);
    if (matcher === undefined) console.warn(`streak-forge: ${PURGE_CONFIG_FILE}: "${key}" entries must be strings or RegExps, dropped ${String(item)}.`);
    return matcher === undefined ? [] : [matcher];
  });
};

export const serializePurgeConfig = (mod: Record<string, unknown>): PurgeConfig | undefined => {
  const out: Record<string, unknown> = {};

  if (Array.isArray(mod.safelist)) {
    out.safelist = toMatcherList(mod.safelist, "safelist");
  } else if (mod.safelist && typeof mod.safelist === "object") {
    const safelist: Record<string, unknown> = {};
    for (const key of SAFELIST_KEYS) {
      const list = toMatcherList((mod.safelist as Record<string, unknown>)[key], `safelist.${key}`);
      if (list) safelist[key] = list;
    }
    out.safelist = safelist;
  }

  for (const key of MATCHER_LIST_KEYS) {
    const list = toMatcherList(mod[key], key);
    if (list) out[key] = list;
  }

  if (mod.dynamicAttributes !== undefined) {
    if (Array.isArray(mod.dynamicAttributes) && mod.dynamicAttributes.every((a) => typeof a === "string")) {
      out.dynamicAttributes = mod.dynamicAttributes;
    } else {
      console.warn(`streak-forge: ${PURGE_CONFIG_FILE}: "dynamicAttributes" must be a string array, ignored.`);
    }
  }

  for (const key of BOOLEAN_KEYS) {
    if (typeof mod[key] === "boolean") out[key] = mod[key];
  }

  return Object.keys(out).length > 0 ? (out as PurgeConfig) : undefined;
};

// One load per project root per process - the build commands render many
// pages against the same root.
const cache = new Map<string, Promise<PurgeConfig | undefined>>();

/**
 * Reads the client's `purgecss.config.js` (named exports, same shape as
 * purgecss options) from the project root and turns it into JSON-safe data
 * for the optimizer. Missing file = undefined, so builds without one are
 * unchanged.
 */
export const loadPurgeConfig = (projectRoot: string): Promise<PurgeConfig | undefined> => {
  const filePath = path.resolve(projectRoot, PURGE_CONFIG_FILE);
  let pending = cache.get(filePath);
  if (!pending) {
    pending = fs.existsSync(filePath)
      ? import(filePath)
          .then((mod) => serializePurgeConfig({ ...mod, ...(mod.default ?? {}) }))
          // A broken config must not fail the page build - fall back to the
          // optimizer's defaults, same as having no config at all.
          .catch((error: Error) => {
            console.warn(`streak-forge: failed to load ${filePath}, ignored: ${error.message}`);
            return undefined;
          })
      : Promise.resolve(undefined);
    cache.set(filePath, pending);
  }
  return pending;
};
