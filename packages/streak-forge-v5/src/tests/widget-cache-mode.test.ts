import { describe, expect, test, afterAll } from "bun:test";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { parseFile } from "../annotations";
import { widget } from "../hoc";

const DIR = mkdtempSync(join(tmpdir(), "widget-cache-mode-"));
afterAll(() => rmSync(DIR, { recursive: true, force: true }));

function parseWidget(name: string, source: string) {
  const file = join(DIR, `${name}.tsx`);
  writeFileSync(file, source);
  return parseFile(file).widgets[0];
}

describe("widget({ cache }) — registry", () => {
  test("absent cache is left out of the registry entry (means none)", () => {
    expect(parseWidget("Plain", `export const Plain = widget({})(() => null);`)?.cache).toBeUndefined();
  });

  test("each literal mode is recorded", () => {
    for (const mode of ["none", "type", "props"] as const) {
      const name = `W${mode}`;
      expect(parseWidget(name, `export const ${name} = widget({ cache: "${mode}" })(() => null);`)?.cache).toBe(mode);
    }
  });

  test("an unknown mode or a non-literal value is a build error", () => {
    expect(() => parseWidget("Bad", `export const Bad = widget({ cache: "page" })(() => null);`)).toThrow(/cache/);
    expect(() => parseWidget("Expr", `const m = "type"; export const Expr = widget({ cache: m })(() => null);`)).toThrow(/string literal/);
  });
});

describe("widget({ cache }) — compile-time checks", () => {
  test("type: no props allowed; props: JSON-safe props only", () => {
    widget({ cache: "type" })(() => null);
    widget({ cache: "props" })((props: { data?: { title?: string; ids: number[] } }) => props.data?.title ?? null);
    widget({ cache: "none" })((props: { at: Date }) => props.at.toISOString());
    widget({})((props: { at: Date }) => props.at.toISOString());

    // @ts-expect-error "type" caches once per widget type, so the widget can't take props
    widget({ cache: "type" })((props: { data?: { title?: string } }) => props.data?.title ?? null);
    // @ts-expect-error "props" hashes the props, so they must be JSON-safe
    widget({ cache: "props" })((props: { at: Date }) => props.at.toISOString());
    // @ts-expect-error functions in props are not JSON-safe
    widget({ cache: "props" })((props: { onClick: () => void }) => String(props.onClick));
    expect(true).toBe(true);
  });

  test("widget() still returns the wrapped function unchanged", () => {
    const fn = () => "x";
    expect(widget({ cache: "type" })(fn)).toBe(fn);
  });
});
