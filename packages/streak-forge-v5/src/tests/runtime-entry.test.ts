import { describe, expect, test, afterAll } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { generateBundle, pointAtRuntime, RUNTIME_SPECIFIER } from "../js-bundle";
import * as runtime from "../runtime";

const DIR = mkdtempSync(join(tmpdir(), "runtime-entry-"));
afterAll(() => rmSync(DIR, { recursive: true, force: true }));

describe("streak-forge/runtime", () => {
  test("carries the client authoring API", () => {
    for (const name of ["Script", "Dynamic", "WidgetPlaceholder", "ComponentPlaceholder", "Fragment", "jsx", "widget", "handler", "component", "jsonSafetyIssue"]) {
      expect(runtime).toHaveProperty(name);
    }
  });
});

describe("pointAtRuntime", () => {
  test("points every form of the root import at the runtime, leaves subpaths alone", () => {
    const js = [
      'import{Script as h,Dynamic as m}from"streak-forge";',
      'import { WidgetPlaceholder } from "streak-forge";',
      'import "streak-forge";',
      'const lazy = import("streak-forge");',
      'import{jsxDEV as x}from"streak-forge/jsx-dev-runtime";',
    ].join("\n");
    const out = pointAtRuntime(js, "W");
    expect(out).toContain(`from"${RUNTIME_SPECIFIER}"`);
    expect(out).toContain(`from "${RUNTIME_SPECIFIER}"`);
    expect(out).toContain(`import "${RUNTIME_SPECIFIER}"`);
    expect(out).toContain(`import("${RUNTIME_SPECIFIER}")`);
    expect(out).toContain('from"streak-forge/jsx-dev-runtime"');
    expect(out).not.toMatch(/["']streak-forge["']/);
    expect(pointAtRuntime(out, "W")).toBe(out); // idempotent (cached bundles)
  });

  test("a name the runtime doesn't have fails at prebuild time, naming the widget", () => {
    expect(() => pointAtRuntime('import{fullScan as f}from"streak-forge";', "Hero (src/widgets/Hero.tsx)")).toThrow(
      /Hero \(src\/widgets\/Hero.tsx\) imports "fullScan"/,
    );
    expect(() => pointAtRuntime('import sf from"streak-forge";', "Hero")).toThrow(/default import/);
  });
});

describe("generateBundle", () => {
  test("a real widget bundle imports the runtime, not the main entry", async () => {
    const src = join(DIR, "Badge.tsx");
    writeFileSync(src, 'import { Script } from "streak-forge";\nexport const Badge = () => Script({ id: "b", children: () => {} });\n');
    const out = join(DIR, "out");
    const result = await generateBundle({ filePath: src, name: "Badge", fileHash: `h${Date.now()}` }, out, "widgets");
    const js = readFileSync(join(out, result.fileName), "utf-8");
    expect(js).toContain(`"${RUNTIME_SPECIFIER}"`);
    expect(js).not.toMatch(/["']streak-forge["']/);
  });
});
