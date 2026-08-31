/**
 * Unit tests for the <Script> closure-leak detector — the check behind
 * `streak-forge validate` (hard fail) and the dev-server warning. A <Script>
 * body is serialized with `.toString()`, so anything it closes over that
 * isn't a browser global, `gDom`, or `options` becomes a ReferenceError in
 * the browser. `findClosureLeaks` flags those references.
 */

import { describe, test, expect } from "bun:test";
import {
  findClosureLeaks,
  formatClosureLeak,
} from "../src/build/scriptTransform";

const wrap = (body: string) =>
  `export default () => <Script id="w">{(gDom, options) => { ${body} }}</Script>;`;

describe("findClosureLeaks", () => {
  test("clean body: only gDom, options, locals, and browser globals", () => {
    const src = wrap(`
      const n = options.count;
      const el = document.getElementById("x");
      gDom.loadPackage("chart");
      window.setTimeout(() => el && (el.textContent = String(n + 1)), 0);
    `);
    expect(findClosureLeaks(src, "w.tsx")).toEqual([]);
  });

  test("flags a reference to an outer/imported value", () => {
    const leaks = findClosureLeaks(wrap("renderChart(options.data);"), "w.tsx");
    expect(leaks).toHaveLength(1);
    expect(leaks[0]).toMatchObject({ name: "renderChart", file: "w.tsx" });
    expect(leaks[0].line).toBeGreaterThan(0);
    expect(leaks[0].column).toBeGreaterThan(0);
  });

  test("flags every distinct leaked identifier", () => {
    const leaks = findClosureLeaks(wrap("foo(); bar(); foo();"), "w.tsx");
    expect(leaks.map((l) => l.name).sort()).toEqual(["bar", "foo"]);
  });

  test("locally declared names are not leaks", () => {
    const src = wrap(`
      function double(x) { return x * 2; }
      const y = double(options.n);
      gDom.geById("out");
      return y;
    `);
    expect(findClosureLeaks(src, "w.tsx")).toEqual([]);
  });

  test("only <Script> (capital S) is inspected, not a lowercase <script>", () => {
    const src = `export default () => <script>{(g) => { leaked(); }}</script>;`;
    expect(findClosureLeaks(src, "w.tsx")).toEqual([]);
  });

  test("a plain .ts file with no <Script> JSX yields nothing", () => {
    expect(findClosureLeaks(`export const x = 1 + 2;`, "helper.ts")).toEqual(
      [],
    );
  });
});

describe("formatClosureLeak", () => {
  const leak = {
    name: "renderChart",
    file: "src/widgets/Chart.tsx",
    line: 12,
    column: 5,
  };

  test("names the identifier, the location, and the fix", () => {
    const msg = formatClosureLeak(leak);
    expect(msg).toContain("src/widgets/Chart.tsx:12:5");
    expect(msg).toContain(`"renderChart"`);
    expect(msg).toContain("options");
  });

  test("colored output wraps the message in ANSI escapes", () => {
    const msg = formatClosureLeak(leak, true);
    expect(msg).toContain("\x1b[");
    expect(msg).toContain("renderChart");
  });
});
