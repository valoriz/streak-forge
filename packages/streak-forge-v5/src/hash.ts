import { createHash } from "node:crypto";

/**
 * One hash function, reused everywhere a cache key is needed:
 *  - registry.ts     -> per-file content hash (incremental rescan)
 *  - css-purge.ts     -> widget source + dynamicClasses hash (CSS cache key)
 *  - html-cache.ts     -> props/data hash (fragment cache key)
 *
 * Deliberately not cryptographically-sensitive (this is a build cache key,
 * not a security boundary) so a fast, short hash is preferable to sha256.
 */
export function hashOf(input: string): string {
  return createHash("sha1").update(input).digest("hex").slice(0, 10);
}

/** Deterministic hash of a JSON-serializable value. Sorts object keys so
 *  `{a:1,b:2}` and `{b:2,a:1}` hash identically — matters because prop
 *  ordering shouldn't bust the fragment cache. */
export function hashValue(value: unknown): string {
  return hashOf(stableStringify(value));
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const keys = Object.keys(value as Record<string, unknown>).sort();
  const body = keys
    .map((k) => `${JSON.stringify(k)}:${stableStringify((value as Record<string, unknown>)[k])}`)
    .join(",");
  return `{${body}}`;
}
