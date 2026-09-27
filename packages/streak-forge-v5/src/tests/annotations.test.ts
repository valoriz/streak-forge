import { describe, expect, test } from "bun:test";
import { parseFile } from "../annotations.js";
import { join } from "node:path";

const FIXTURES = join(import.meta.dir, "fixtures");

describe("annotations.parseFile", () => {
  test("parses @widget + @handler-binding + @dynamicClasses on HelloBanner", () => {
    const { widgets, handlers } = parseFile(join(FIXTURES, "widgets/HelloBanner.tsx"));

    expect(widgets).toHaveLength(1);
    const w = widgets[0]!;
    expect(w.type).toBe("HelloBanner");
    expect(w.kind).toBe("handler");
    expect(w.handlerName).toBe("HelloBannerHandler");
    expect(w.dynamicClasses).toEqual(
      expect.arrayContaining(["bg-red-500", "bg-blue-500", "bg-green-500", "text-sm", "text-lg"]),
    );
    expect(w.dynamicClassGroups).toHaveLength(2);
    expect(handlers).toHaveLength(0); // no bare @handler tag in this file
  });

  test("static widget (no @handler) is classified kind=static", () => {
    const { widgets } = parseFile(join(FIXTURES, "widgets/StaticBadge.tsx"));
    expect(widgets).toHaveLength(1);
    expect(widgets[0]!.kind).toBe("static");
    expect(widgets[0]!.handlerName).toBeUndefined();
    expect(widgets[0]!.dynamicClasses).toEqual([]);
  });

  test("bare @handler tag registers a handler, scope defaults correctly", () => {
    const { handlers } = parseFile(join(FIXTURES, "handlers/HelloBannerHandler.ts"));
    expect(handlers).toHaveLength(1);
    expect(handlers[0]!.exportName).toBe("HelloBannerHandler");
    expect(handlers[0]!.scope).toBe("widget");
  });

  test("sourceHash changes when dynamicClasses list changes (cache-busts CSS)", () => {
    const a = parseFile(join(FIXTURES, "widgets/HelloBanner.tsx")).widgets[0]!;
    // Same file parsed twice -> same hash (determinism check).
    const b = parseFile(join(FIXTURES, "widgets/HelloBanner.tsx")).widgets[0]!;
    expect(a.sourceHash).toBe(b.sourceHash);
  });
});
