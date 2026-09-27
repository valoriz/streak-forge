import { describe, expect, test, afterEach } from "bun:test";
import { rmSync } from "node:fs";
import { generateWidgetCss, generateCommonCss, collectGlobalClasses, subtractCommonRules, findUndeclaredBracketClasses, prefixCssClasses, prefixHtmlClasses, shortScopePrefix } from "../css-purge.js";
import { parseFile } from "../annotations.js";
import { join } from "node:path";

const FIXTURES = join(import.meta.dir, "fixtures");
const OUT_DIR = join(import.meta.dir, "css-out-scratch");

afterEach(() => {
  rmSync(OUT_DIR, { recursive: true, force: true });
  rmSync(".streak-forge-cache", { recursive: true, force: true });
});

describe("css-purge.generateWidgetCss", () => {
  test("dummy-element injection carries @dynamicClasses into the purge scan", async () => {
    const widget = parseFile(join(FIXTURES, "widgets/HelloBanner.tsx")).widgets[0]!;
    let scannedHtml = "";

    const fakePurgeEngine = async ({ html }: { html: string; fullCssPath: string }) => {
      scannedHtml = html;
      // Fake engine: just returns rules for every class literally present.
      const classes = [...new Set(html.match(/class="([^"]+)"/g)?.flatMap((m) => m.slice(7, -1).split(" ")) ?? [])];
      return classes.map((c) => `.${c} { /* ${c} */ }`).join("\n");
    };

    const result = await generateWidgetCss(widget, "<div>real render</div>", fakePurgeEngine, "app.css", OUT_DIR);

    expect(result.fromCache).toBe(false);
    expect(scannedHtml).toContain("bg-red-500");
    expect(scannedHtml).toContain("bg-blue-500");
    expect(scannedHtml).toContain("text-sm");
    expect(result.css).toContain(".bg-red-500");
  });

  test("second call for same widget+annotations is served from cache", async () => {
    const widget = parseFile(join(FIXTURES, "widgets/HelloBanner.tsx")).widgets[0]!;
    let calls = 0;
    const countingEngine = async () => {
      calls++;
      return ".x{}";
    };

    await generateWidgetCss(widget, "<div/>", countingEngine, "app.css", OUT_DIR);
    const second = await generateWidgetCss(widget, "<div/>", countingEngine, "app.css", OUT_DIR);

    expect(calls).toBe(1); // purge engine only ran once
    expect(second.fromCache).toBe(true);
  });

  test("strips CSS comments from the purge engine's output (e.g. Tailwind's own preflight attribution notes) and collapses the blank lines left behind", async () => {
    const widget = parseFile(join(FIXTURES, "widgets/HelloBanner.tsx")).widgets[0]!;
    const commentyEngine = async () =>
      "/*\n1. A licensing/provenance comment, the kind Tailwind's own preflight ships.\n*/\n.bg-red-500{color:red}\n/* another one */\n.text-lg{font-size:1rem}";

    const result = await generateWidgetCss(widget, "<div/>", commentyEngine, "app.css", OUT_DIR);

    expect(result.css).not.toContain("/*");
    expect(result.css).not.toContain("*/");
    expect(result.css).not.toContain("licensing/provenance");
    expect(result.css).toContain(".bg-red-500{color:red}");
    expect(result.css).toContain(".text-lg{font-size:1rem}");
    // No run of 3+ blank lines left where a stripped comment used to be.
    expect(result.css).not.toMatch(/\n{3,}/);
  });

  test("scopeClasses: true renames every class selector in the result to <shortScopePrefix(type)>__<class>", async () => {
    const widget = parseFile(join(FIXTURES, "widgets/HelloBanner.tsx")).widgets[0]!;
    const fakeEngine = async () => ".bg-red-500{color:red}\nh1,h2,h3{margin:0}";

    const result = await generateWidgetCss(widget, "<div/>", fakeEngine, "app.css", OUT_DIR, "widgets", undefined, true);

    expect(result.css).toContain(`.${shortScopePrefix(widget.type)}__bg-red-500{color:red}`);
    // Tag-only selector has no class token — left completely alone.
    expect(result.css).toContain("h1,h2,h3{margin:0}");
  });

  test("minify: true (build only) collapses whitespace in the returned AND written css; dedup against commonCss still works since it runs on raw text first", async () => {
    const widget = parseFile(join(FIXTURES, "widgets/HelloBanner.tsx")).widgets[0]!;
    const commonCss = ".shared { color: green; }";
    const fakeEngine = async () => ".bg-red-500 {\n  color: red;\n}\n\n.shared { color: green; }";

    const result = await generateWidgetCss(widget, "<div/>", fakeEngine, "app.css", OUT_DIR, "widgets", commonCss, false, true);

    // The rule byte-identical to commonCss was correctly deduped away —
    // proves subtractCommonRules still compared RAW (unminified) text,
    // not the minified result.
    expect(result.css).not.toContain("shared");
    expect(result.css).toBe(".bg-red-500{color:red}");
    expect(result.fileName).toBeTruthy();
  });
});

describe("css-purge.generateCommonCss", () => {
  test("strips CSS comments from the purge engine's output too", async () => {
    const commentyEngine = async () => "/* preflight license note */\n*,\n::before,\n::after {\n  box-sizing: border-box;\n}";
    const css = await generateCommonCss(commentyEngine, "app.css");
    expect(css).not.toContain("/*");
    expect(css).not.toContain("preflight license note");
    expect(css).toContain("box-sizing: border-box;");
  });
});

describe("css-purge.shortScopePrefix", () => {
  test("is deterministic — same type always produces the same prefix", () => {
    expect(shortScopePrefix("ProductCard")).toBe(shortScopePrefix("ProductCard"));
  });

  test("differs for different types", () => {
    expect(shortScopePrefix("ProductCard")).not.toBe(shortScopePrefix("ProductBadge"));
  });

  test("is a valid CSS identifier — always starts with a letter, short", () => {
    const prefix = shortScopePrefix("HelloFeatures");
    expect(prefix).toMatch(/^[a-z][a-z0-9]*$/);
    expect(prefix.length).toBeLessThanOrEqual(6);
  });

  test("is much shorter than the type name it replaces", () => {
    expect(shortScopePrefix("HelloFeatures").length).toBeLessThan("HelloFeatures".length);
  });
});

describe("css-purge.prefixCssClasses", () => {
  test("renames a plain class selector", () => {
    expect(prefixCssClasses(".bg-blue-500{color:red}", "Card")).toBe(".Card__bg-blue-500{color:red}");
  });

  test("renames every class in a combinator/descendant selector", () => {
    expect(prefixCssClasses(".card .title{color:red}", "Card")).toBe(".Card__card .Card__title{color:red}");
  });

  test("renames every class in a comma-separated selector list", () => {
    expect(prefixCssClasses(".a, .b{color:red}", "Card")).toBe(".Card__a, .Card__b{color:red}");
  });

  test("leaves a pure tag/universal selector untouched (no class token)", () => {
    expect(prefixCssClasses("h1,h2,h3{margin:0}", "Card")).toBe("h1,h2,h3{margin:0}");
    expect(prefixCssClasses("*, ::before, ::after{box-sizing:border-box}", "Card")).toBe("*, ::before, ::after{box-sizing:border-box}");
  });

  test("preserves Tailwind's own selector escaping (variant colon) and leaves the real pseudo-class alone", () => {
    const input = ".hover\\:bg-blue-500:hover{color:red}";
    expect(prefixCssClasses(input, "Card")).toBe(".Card__hover\\:bg-blue-500:hover{color:red}");
  });

  test("recurses into @media/@supports bodies, rewriting their own nested selectors", () => {
    const input = "@media (min-width:768px){.sm\\:flex{display:flex}}";
    expect(prefixCssClasses(input, "Card")).toBe("@media (min-width:768px){.Card__sm\\:flex{display:flex}}");
  });

  test("never touches a decimal number inside a declaration's property VALUE", () => {
    expect(prefixCssClasses(".foo{margin:0.5rem}", "Card")).toBe(".Card__foo{margin:0.5rem}");
  });
});

describe("css-purge.prefixHtmlClasses", () => {
  test("renames every class in a class attribute", () => {
    expect(prefixHtmlClasses('<div class="bg-blue-500 p-4"></div>', "Card")).toBe('<div class="Card__bg-blue-500 Card__p-4"></div>');
  });

  test("rewrites every class attribute independently across multiple elements", () => {
    const html = '<div class="a"><span class="b c"></span></div>';
    expect(prefixHtmlClasses(html, "Card")).toBe('<div class="Card__a"><span class="Card__b Card__c"></span></div>');
  });

  test("an element with no class attribute is left untouched", () => {
    expect(prefixHtmlClasses("<div><p>text</p></div>", "Card")).toBe("<div><p>text</p></div>");
  });

  test("round-trips with prefixCssClasses: the prefixed HTML class matches the prefixed CSS selector", () => {
    const css = prefixCssClasses(".hover\\:bg-blue-500:hover{color:red}", "Card");
    const html = prefixHtmlClasses('<button class="hover:bg-blue-500">Buy</button>', "Card");
    // The CSS selector's escaped token, unescaped, equals the HTML's literal class value.
    expect(css).toContain(".Card__hover\\:bg-blue-500:hover");
    expect(html).toContain('class="Card__hover:bg-blue-500"');
  });
});

describe("css-purge.findUndeclaredBracketClasses", () => {
  test("flags bracket-syntax classes not declared in @dynamicClasses", () => {
    const source = `<div class="bg-[#123456] w-[37px] flex" />`;
    const undeclared = findUndeclaredBracketClasses(source, ["bg-[#123456]"]);
    expect(undeclared).toEqual(["w-[37px]"]);
  });

  test("no false positive when all bracket classes are declared", () => {
    const source = `<div class="bg-[#123456]" />`;
    const undeclared = findUndeclaredBracketClasses(source, ["bg-[#123456]"]);
    expect(undeclared).toEqual([]);
  });
});

describe("css-purge global (dynamicClasses) classes", () => {
  const globals = new Set(["hidden", "text-[11px]", "md:flex"]);

  test("prefixHtmlClasses leaves global classes unprefixed", () => {
    expect(prefixHtmlClasses('<p class="hidden p-2 text-[11px]"></p>', "cabc", globals)).toBe(
      '<p class="hidden cabc__p-2 text-[11px]"></p>',
    );
  });

  test("prefixCssClasses leaves global classes unprefixed, matching their escaped selector form", () => {
    const css = ".hidden{display:none}.p-2{padding:.5rem}.text-\\[11px\\]{font-size:11px}@media (min-width:768px){.md\\:flex{display:flex}}";
    expect(prefixCssClasses(css, "cabc", globals)).toBe(
      ".hidden{display:none}.cabc__p-2{padding:.5rem}.text-\\[11px\\]{font-size:11px}@media (min-width:768px){.md\\:flex{display:flex}}",
    );
  });

  test("generateCommonCss scans the global classes, so their rules land in the common bundle", async () => {
    let scanned = "";
    await generateCommonCss(
      async ({ html }) => {
        scanned = html;
        return "";
      },
      "unused.css",
      ["hidden", "md:flex"],
    );
    expect(scanned).toBe('<html><body><div class="hidden md:flex"></div></body></html>');
  });

  test("collectGlobalClasses unions every entry's dynamicClasses", () => {
    expect([...collectGlobalClasses([{ dynamicClasses: ["a", "b"] }, { dynamicClasses: ["b", "c"] }])]).toEqual(["a", "b", "c"]);
  });
});

describe("css-purge.subtractCommonRules with Tailwind v4 @layer output", () => {
  const common = `@layer properties;
@layer theme, base, components, utilities;
@layer base {
  * { margin: 0; padding: 0; }
}
@layer utilities {
  .hidden { display: none; }
}`;

  test("removes rules already in the common bundle from inside @layer/@media blocks, keeps the rest", () => {
    const widget = `@layer base {
  * { margin: 0; padding: 0; }
}
@layer utilities {
  .hidden { display: none; }
  .pt-2 { padding-top: 8px; }
  @media (width >= 64rem) {
    .lg\\:flex { display: flex; }
  }
}`;
    const out = subtractCommonRules(widget, common);
    expect(out).not.toContain("margin: 0");
    expect(out).not.toContain(".hidden");
    expect(out).toContain(".pt-2");
    expect(out).toContain(".lg\\:flex");
    expect(out).not.toContain("@layer base");
  });

  test("restates the common layer order first, so link order can't reorder cascade layers", () => {
    const out = subtractCommonRules("@layer utilities {\n  .pt-2 { padding-top: 8px; }\n}", common);
    expect(out.startsWith("@layer properties;\n@layer theme, base, components, utilities;\n@layer utilities {")).toBe(true);
  });

  test("returns empty when every rule is shared", () => {
    expect(subtractCommonRules("@layer utilities {\n  .hidden { display: none; }\n}", common)).toBe("");
  });
});
