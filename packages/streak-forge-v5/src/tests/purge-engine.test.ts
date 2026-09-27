import { describe, expect, test, afterEach } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { defaultPurgeEngine } from "../cli/purge-engine.js";

const OUT_DIR = join(import.meta.dir, "purge-engine-scratch");
const CSS_PATH = join(OUT_DIR, "full.css");

afterEach(() => {
  rmSync(OUT_DIR, { recursive: true, force: true });
});

function writeFullCss(css: string): void {
  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(CSS_PATH, css);
}

describe("cli.defaultPurgeEngine", () => {
  test("keeps a Tailwind v4 :where() rule whose class is used, drops an unused one", async () => {
    writeFullCss(":where(.space-y-3 > :not(:last-child)) { margin: 1px }\n:where(.space-y-9 > :not(:last-child)) { margin: 9px }");
    const css = await defaultPurgeEngine({ html: '<div class="space-y-3"></div>', fullCssPath: CSS_PATH });
    expect(css).toContain(".space-y-3");
    expect(css).not.toContain(".space-y-9");
  });

  test("keeps an attribute-variant rule when its class is used, even without the attribute in the HTML", async () => {
    writeFullCss('.data-\\[active\\=true\\]\\:b[data-active="true"] { color: red }\n.data-\\[open\\]\\:c[data-open] { color: blue }');
    const used = await defaultPurgeEngine({ html: '<div class="data-[active=true]:b"></div>', fullCssPath: CSS_PATH });
    expect(used).toContain("data-active");
    expect(used).not.toContain("data-open");
  });
});
