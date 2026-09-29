import { describe, test, expect, spyOn } from "bun:test";
import { jsonSafetyIssue, isJsonSafe } from "../json-safe";
import { handler } from "../hoc";

describe("json-safe.jsonSafetyIssue", () => {
  test("accepts plain JSON data, and undefined object properties", () => {
    expect(jsonSafetyIssue({ a: "x", b: 1, c: true, d: null, e: [1, { f: "g" }], h: undefined })).toBeNull();
    expect(jsonSafetyIssue([])).toBeNull();
    expect(jsonSafetyIssue("text")).toBeNull();
    expect(jsonSafetyIssue(Object.create(null))).toBeNull();
  });

  test("allows the same object referenced twice (not a cycle)", () => {
    const shared = { id: 1 };
    expect(isJsonSafe({ a: shared, b: shared })).toBe(true);
  });

  test("reports the first problem with its path", () => {
    expect(jsonSafetyIssue({ items: [{ createdAt: new Date() }] })).toBe("$.items[0].createdAt is a Date");
    expect(jsonSafetyIssue({ m: new Map() })).toBe("$.m is a Map");
    expect(jsonSafetyIssue({ fn: () => 1 })).toBe("$.fn is a function");
    expect(jsonSafetyIssue({ n: 10n })).toBe("$.n is a bigint");
    expect(jsonSafetyIssue({ n: Number.NaN })).toBe("$.n is NaN");
    expect(jsonSafetyIssue([1, undefined])).toBe("$[1] is undefined");
    expect(jsonSafetyIssue(undefined)).toBe("$ is undefined");
    class Product {
      id = 1;
    }
    expect(jsonSafetyIssue({ p: new Product() })).toBe("$.p is a Product");
  });

  test("reports circular references", () => {
    const a: Record<string, unknown> = {};
    a.self = a;
    expect(jsonSafetyIssue(a)).toBe("$.self is a circular reference");
  });
});

describe("hoc.handler JSON-safety", () => {
  test("compile time: JSON-safe results type-check, others don't", () => {
    interface Data {
      name: string;
      tags: string[];
      extra?: { n: number };
    }
    handler({})(async (): Promise<Data> => ({ name: "a", tags: [] }));
    handler({})(async () => ({ list: [1, 2], nested: { ok: true, none: null } }));
    handler({})(async () => (await fetch("https://example.invalid").catch(() => new Response("{}"))).json());

    // @ts-expect-error Date is not JSON-safe
    handler({})(async () => ({ at: new Date() }));
    // @ts-expect-error functions are not JSON-safe
    handler({})(async () => ({ run: () => 1 }));
    // @ts-expect-error Map is not JSON-safe
    handler({})(async () => new Map<string, number>());
    expect(true).toBe(true);
  });

  test("runtime: warns once per handler when the result is not JSON-safe", async () => {
    const warn = spyOn(console, "warn").mockImplementation(() => {});
    const loose = handler({})(async (id: string) => ({ id, at: new Date() }) as unknown);
    await loose("a");
    await loose("b");
    await Promise.resolve();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]?.[0])).toContain("$.at is a Date");
    warn.mockRestore();
  });

  test("runtime: no warning for JSON-safe results", async () => {
    const warn = spyOn(console, "warn").mockImplementation(() => {});
    const clean = handler({})(async () => ({ ok: true }));
    await clean();
    await Promise.resolve();
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });
});
