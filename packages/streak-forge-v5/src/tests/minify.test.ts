import { describe, test, expect } from "bun:test";
import { minifyCss, minifyHtml, minifyJsFiles, findFilesByBasename } from "../minify.js";
import { mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";

describe("minify.minifyCss", () => {
  test("strips comments and collapses whitespace around structural characters", () => {
    const css = `/* comment */\n.a {\n  color: red;\n  margin: 0 auto;\n}\n\n.b { color: blue; }`;
    const out = minifyCss(css);
    expect(out).not.toContain("/*");
    expect(out).not.toContain("\n");
    expect(out).toBe(".a{color:red;margin:0 auto}.b{color:blue}");
  });

  test("preserves whitespace inside quoted string literals", () => {
    const css = `.a::before { content: "a  b"; }`;
    expect(minifyCss(css)).toContain('"a  b"');
  });
});

describe("minify.minifyHtml", () => {
  test("collapses whitespace between tags and strips comments", () => {
    const html = `<div>\n  <p>Hello</p>\n  <!-- comment -->\n  <span>World</span>\n</div>`;
    expect(minifyHtml(html)).toBe("<div><p>Hello</p><span>World</span></div>");
  });

  test("preserves <pre> content verbatim, including internal whitespace", () => {
    const html = `<pre>  line1\n  line2  </pre>`;
    expect(minifyHtml(html)).toBe(html);
  });

  test("does not touch a self-contained marker's own attribute spacing (no whitespace inside a single tag)", () => {
    const marker = '<div data-widget-placeholder="x" data-widget-type="Y"></div>';
    expect(minifyHtml(marker)).toBe(marker);
  });
});

describe("minify.minifyJsFiles / findFilesByBasename", () => {
  const DIR = join(import.meta.dir, "minify-scratch");

  test("batch-minifies real JS files in place, renaming locals but keeping property names/string literals", async () => {
    rmSync(DIR, { recursive: true, force: true });
    mkdirSync(join(DIR, "widgets/A"), { recursive: true });
    mkdirSync(join(DIR, "widgets/B"), { recursive: true });
    writeFileSync(join(DIR, "widgets/A/script.js"), `(function(){var options={label:"A"};console.log(options.label);})();`);
    writeFileSync(join(DIR, "widgets/B/bundle.js"), `(function(){var options={label:"B"};console.log(options.label);})();`);
    writeFileSync(join(DIR, "widgets/A/index.html"), "<p>not js</p>"); // must NOT be touched

    const found = findFilesByBasename(DIR, new Set(["script.js", "bundle.js"]));
    expect(found.sort()).toEqual([join(DIR, "widgets/A/script.js"), join(DIR, "widgets/B/bundle.js")].sort());

    await minifyJsFiles(found, DIR);

    const a = readFileSync(join(DIR, "widgets/A/script.js"), "utf-8");
    const b = readFileSync(join(DIR, "widgets/B/bundle.js"), "utf-8");
    expect(a).toContain(".label)");
    expect(a).toContain('"A"');
    expect(a.length).toBeLessThan(`(function(){var options={label:"A"};console.log(options.label);})();`.length + 5);
    expect(b).toContain('"B"');
    expect(readFileSync(join(DIR, "widgets/A/index.html"), "utf-8")).toBe("<p>not js</p>");

    rmSync(DIR, { recursive: true, force: true });
  });

  test("does not scramble content across files sharing a basename AND a same-named immediate parent directory — the real bug this guards against", async () => {
    // Mirrors a real page-specific widget layout: the SAME instance id
    // ("hello-message") reused under several DIFFERENT page folders, each
    // with its own distinct script.js content. result.outputs comes back
    // from Bun.build sorted by output path, NOT in entrypoint order —
    // relying on index-based zipping silently wrote one page's minified
    // script into a completely unrelated file (once, for real, in this
    // exact shape — see minifyJsFiles' own doc comment).
    rmSync(DIR, { recursive: true, force: true });
    const pages = ["about", "docs", "index"];
    for (const page of pages) {
      mkdirSync(join(DIR, `pages/${page}/widgets/hello-message`), { recursive: true });
      writeFileSync(join(DIR, `pages/${page}/widgets/hello-message/script.js`), `(function(){console.log("PAGE_${page.toUpperCase()}");})();`);
    }
    mkdirSync(join(DIR, "__streak"), { recursive: true });
    writeFileSync(join(DIR, "__streak/root.js"), `(function(){console.log("ROOT_RUNTIME");})();`);

    const found = findFilesByBasename(DIR, new Set(["script.js", "root.js"]));
    expect(found.length).toBe(4);

    await minifyJsFiles(found, DIR);

    for (const page of pages) {
      const src = readFileSync(join(DIR, `pages/${page}/widgets/hello-message/script.js`), "utf-8");
      expect(src).toContain(`PAGE_${page.toUpperCase()}`);
      for (const other of pages) {
        if (other !== page) expect(src).not.toContain(`PAGE_${other.toUpperCase()}`);
      }
    }
    const rootSrc = readFileSync(join(DIR, "__streak/root.js"), "utf-8");
    expect(rootSrc).toContain("ROOT_RUNTIME");
    expect(rootSrc).not.toContain("PAGE_");

    rmSync(DIR, { recursive: true, force: true });
  });

  test("no-ops on an empty file list", async () => {
    await expect(minifyJsFiles([], DIR)).resolves.toBeUndefined();
  });
});
