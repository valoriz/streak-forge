/**
 * Tests for the `common` prop contract:
 *   - filterHandlerResponse preserves the `common` key from the handler return
 *   - per-widget data is kept, unrelated keys are dropped
 *   - `common` is absent (undefined) when the handler does not return it
 */

import { describe, test, expect } from "bun:test";
import { filterHandlerResponse } from "../src/build/buildPage";

describe("filterHandlerResponse — common key", () => {
  test("preserves common when present", () => {
    const response = {
      common: { siteName: "Acme", year: 2026 },
      heroWidget: { title: "Hello" },
    };
    const result = filterHandlerResponse(response, ["heroWidget"]);
    expect(result.common).toEqual({ siteName: "Acme", year: 2026 });
  });

  test("common is absent when handler does not return it", () => {
    const response = { heroWidget: { title: "Hello" } };
    const result = filterHandlerResponse(response, ["heroWidget"]);
    expect(result.common).toBeUndefined();
  });

  test("common: undefined is treated as absent", () => {
    const response = { common: undefined, heroWidget: { title: "Hello" } };
    const result = filterHandlerResponse(response, ["heroWidget"]);
    expect(result.common).toBeUndefined();
  });

  test("keeps per-widget data alongside common", () => {
    const response = {
      common: { theme: "dark" },
      navWidget: { links: ["/"] },
      footerWidget: { year: 2026 },
    };
    const result = filterHandlerResponse(response, [
      "navWidget",
      "footerWidget",
    ]);
    expect(result.navWidget).toEqual({ links: ["/"] });
    expect(result.footerWidget).toEqual({ year: 2026 });
    expect(result.common).toEqual({ theme: "dark" });
  });

  test("drops keys that are not widget ids and not common", () => {
    const response = {
      common: { theme: "dark" },
      heroWidget: { title: "Hello" },
      status: 200,
      _internal: "scratch",
    };
    const result = filterHandlerResponse(response, ["heroWidget"]);
    expect(result.status).toBeUndefined();
    expect(result._internal).toBeUndefined();
  });

  test("works when widget id is not present in response", () => {
    const response = { common: { theme: "dark" } };
    const result = filterHandlerResponse(response, ["heroWidget"]);
    expect(result.common).toEqual({ theme: "dark" });
    expect(result.heroWidget).toBeUndefined();
  });

  test("works with empty widgetIds array", () => {
    const response = { common: { foo: "bar" }, orphan: 1 };
    const result = filterHandlerResponse(response, []);
    expect(result.common).toEqual({ foo: "bar" });
    expect(result.orphan).toBeUndefined();
  });
});
