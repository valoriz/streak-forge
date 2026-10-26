/**
 * JSON-safety for handler results — a handler's return value must survive
 * `JSON.parse(JSON.stringify(value))` unchanged, so it can be cached outside
 * the process (a store shared across build containers) and not only in the
 * in-process memo `handler()` keeps today.
 *
 * Two layers, same rules:
 *  - `JsonSafe<T>` — compile time, used by `handler()`'s signature.
 *  - `jsonSafetyIssue(value)` — runtime, for values the types can't see
 *    (`any` from `res.json()`, casts, third-party data).
 *
 * Allowed: string, finite number, boolean, null, arrays of those, plain
 * objects of those. `undefined` is allowed as an object property value only
 * (JSON drops the key, and `obj.key` still reads `undefined` after a round
 * trip). Everything else is rejected: Date, Map, Set, RegExp, class
 * instances, functions, bigint, symbol, NaN/Infinity, undefined inside an
 * array or as the whole result, circular references.
 */

type JsonPrimitive = string | number | boolean | null;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type NotJson =
  | ((...args: any[]) => unknown)
  | Date
  | Map<unknown, unknown>
  | Set<unknown>
  | RegExp
  | Promise<unknown>
  | bigint
  | symbol;

/** `T` itself when it is JSON-safe (see module doc), otherwise a type `T`
 *  is not assignable to — so `T extends JsonSafe<T>` is the check.
 *  `unknown`/`any` pass: only the runtime check can judge those. */
export type JsonSafe<T> = unknown extends T
  ? T
  : T extends JsonPrimitive | undefined
    ? T
    : T extends NotJson
      ? never
      : T extends object
        ? { [K in keyof T]: JsonSafe<T[K]> }
        : never;

/** Returns `null` when `value` is JSON-safe, else a short description of the
 *  first problem with its path, e.g. `$.items[2].createdAt is a Date`. */
export function jsonSafetyIssue(value: unknown): string | null {
  if (value === undefined) return "$ is undefined";
  return check(value, "$", new Set());
}

export function isJsonSafe(value: unknown): boolean {
  return jsonSafetyIssue(value) === null;
}

function check(value: unknown, path: string, seen: Set<object>): string | null {
  if (value === null || typeof value === "string" || typeof value === "boolean") return null;
  if (typeof value === "number") return Number.isFinite(value) ? null : `${path} is ${value}`;
  if (typeof value !== "object") return `${path} is a ${typeof value}`;

  if (seen.has(value)) return `${path} is a circular reference`;
  seen.add(value);
  try {
    if (Array.isArray(value)) {
      for (let i = 0; i < value.length; i++) {
        const item: unknown = value[i];
        if (item === undefined) return `${path}[${i}] is undefined`;
        const issue = check(item, `${path}[${i}]`, seen);
        if (issue) return issue;
      }
      return null;
    }
    const proto = Object.getPrototypeOf(value);
    if (proto !== Object.prototype && proto !== null) {
      const name =
        (proto?.constructor as { name?: string } | undefined)?.name ||
        "non-plain object";
      return `${path} is a ${name}`;
    }
    for (const [key, item] of Object.entries(value)) {
      if (item === undefined) continue;
      const issue = check(item, `${path}.${key}`, seen);
      if (issue) return issue;
    }
    return null;
  } finally {
    seen.delete(value);
  }
}
