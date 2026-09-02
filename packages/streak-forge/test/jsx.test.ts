/**
 * Unit tests for the JSX runtime: `createElement` / `jsx` VNode construction
 * and `renderToString` HTML serialization.
 *
 * Run with:  bun test   (from packages/streak-forge, or `bun run test` at the repo root)
 */

import { describe, test, expect, spyOn } from "bun:test";
import { createElement, jsx, jsxs } from "../src/jsx/element";
import { Fragment } from "../src/jsx/types";
import { renderToString } from "../src/jsx/renderToString";

describe("createElement", () => {
  test("wraps type + config into a VNode", () => {
    expect(createElement("div", { id: "a" })).toEqual({
      type: "div",
      props: { id: "a" },
    });
  });

  test("null config becomes an empty props object", () => {
    expect(createElement("div", null)).toEqual({ type: "div", props: {} });
  });

  test("a single child is stored as props.children directly", () => {
    expect(createElement("p", null, "hi").props.children).toBe("hi");
  });

  test("multiple children are stored as an array", () => {
    expect(createElement("ul", null, "a", "b").props.children).toEqual([
      "a",
      "b",
    ]);
  });

  test("no children leaves props.children undefined", () => {
    expect(createElement("br", null).props).toEqual({});
  });
});

describe("jsx / jsxs", () => {
  test("jsx builds the same VNode shape", () => {
    expect(jsx("span", { className: "x" })).toEqual({
      type: "span",
      props: { className: "x" },
    });
  });

  test("jsx tolerates null props", () => {
    expect(jsx("span", null as unknown as Record<string, unknown>)).toEqual({
      type: "span",
      props: {},
    });
  });

  test("jsxs is the same function as jsx", () => {
    expect(jsxs).toBe(jsx);
  });
});

describe("renderToString — primitives", () => {
  test("null / undefined / boolean render to empty string", async () => {
    expect(await renderToString(null)).toBe("");
    expect(await renderToString(undefined)).toBe("");
    expect(await renderToString(true)).toBe("");
    expect(await renderToString(false)).toBe("");
  });

  test("numbers render verbatim, including 0", async () => {
    expect(await renderToString(0)).toBe("0");
    expect(await renderToString(42)).toBe("42");
  });

  test("text is HTML-escaped (& < >) but not quotes", async () => {
    expect(await renderToString(`a < b & c > d "q"`)).toBe(
      `a &lt; b &amp; c &gt; d "q"`,
    );
  });

  test("arrays are concatenated with no separator", async () => {
    expect(await renderToString(["a", "b", "c"])).toBe("abc");
  });
});

describe("renderToString — elements", () => {
  test("simple element with text child", async () => {
    expect(await renderToString(createElement("div", null, "hi"))).toBe(
      "<div>hi</div>",
    );
  });

  test("nested elements", async () => {
    const tree = createElement(
      "div",
      { className: "wrap" },
      createElement("span", null, "y"),
    );
    expect(await renderToString(tree)).toBe(
      `<div class="wrap"><span>y</span></div>`,
    );
  });

  test("void elements self-close and take no children", async () => {
    expect(await renderToString(createElement("br", null))).toBe("<br/>");
    expect(await renderToString(createElement("img", { src: "/a.png" }))).toBe(
      `<img src="/a.png"/>`,
    );
  });

  test("array children render in order, falsy entries skipped", async () => {
    const tree = createElement("div", null, [null, "a", undefined, false, "b"]);
    expect(await renderToString(tree)).toBe("<div>ab</div>");
  });

  test("dangerouslySetInnerHTML is emitted raw (not escaped) and wins over children", async () => {
    const tree = createElement("div", {
      dangerouslySetInnerHTML: { __html: "<b>raw</b>" },
    });
    expect(await renderToString(tree)).toBe("<div><b>raw</b></div>");
  });
});

describe("renderToString — attributes", () => {
  test("className -> class, htmlFor -> for", async () => {
    expect(
      await renderToString(
        createElement("label", { className: "c", htmlFor: "e" }),
      ),
    ).toBe(`<label class="c" for="e"></label>`);
  });

  test("boolean true renders a bare attribute; false/null/undefined are dropped", async () => {
    expect(
      await renderToString(createElement("input", { disabled: true })),
    ).toBe("<input disabled/>");
    expect(
      await renderToString(
        createElement("input", { disabled: false, checked: null }),
      ),
    ).toBe("<input/>");
  });

  test('attribute values are escaped for & and "', async () => {
    const tree = createElement("div", { title: `he said "hi" & bye` });
    expect(await renderToString(tree)).toBe(
      `<div title="he said &quot;hi&quot; &amp; bye"></div>`,
    );
  });

  test("style objects are serialized, kebab-cased, custom props preserved, empties filtered", async () => {
    const tree = createElement("div", {
      style: {
        fontSize: "12px",
        "--brand": "#000",
        color: null,
        display: false,
      },
    });
    expect(await renderToString(tree)).toBe(
      `<div style="font-size:12px;--brand:#000"></div>`,
    );
  });

  test("on* handler props are not serialized", async () => {
    const tree = createElement(
      "button",
      { onClick: () => {}, type: "button" },
      "x",
    );
    expect(await renderToString(tree)).toBe(`<button type="button">x</button>`);
  });
});

describe("renderToString — Fragment and components", () => {
  test("Fragment renders only its children", async () => {
    const tree = createElement(Fragment, null, [
      createElement("i", null, "a"),
      createElement("i", null, "b"),
    ]);
    expect(await renderToString(tree)).toBe("<i>a</i><i>b</i>");
  });

  test("a sync function component is invoked with props", async () => {
    const H1 = ({ text }: { text: string }) => createElement("h1", null, text);
    expect(await renderToString(createElement(H1, { text: "Title" }))).toBe(
      "<h1>Title</h1>",
    );
  });

  test("an async function component is awaited", async () => {
    const Slow = async ({ n }: { n: number }) => {
      await Promise.resolve();
      return createElement("p", null, String(n * 2));
    };
    expect(await renderToString(createElement(Slow, { n: 21 }))).toBe(
      "<p>42</p>",
    );
  });
});

describe("renderToString — raw-text elements (<script> / <style>)", () => {
  test("a stray </script> inside script content can't close the tag early", async () => {
    const code = `el.innerHTML = "<b></script><i>leak</i>";`;
    const out = await renderToString(
      createElement("script", { dangerouslySetInnerHTML: { __html: code } }),
    );
    // exactly one real closing tag, at the very end
    expect(out.match(/<\/script>/g)).toHaveLength(1);
    expect(out.endsWith("</script>")).toBe(true);
    // the inner one is neutralised but JS-equivalent
    expect(out).toContain(`<b><\\/script><i>leak</i>`);
  });

  test("<!-- inside script content is neutralised", async () => {
    const out = await renderToString(
      createElement("script", {
        dangerouslySetInnerHTML: { __html: `if (a<!--b) {}` },
      }),
    );
    expect(out).toContain(`a<\\!--b`);
  });

  test("script children are raw text, not HTML-escaped", async () => {
    const out = await renderToString(
      createElement("script", null, `for (let i = 0; i < n && i > -1; i++) {}`),
    );
    expect(out).toBe(
      `<script>for (let i = 0; i < n && i > -1; i++) {}</script>`,
    );
  });

  test("</style> inside style content is neutralised", async () => {
    const out = await renderToString(
      createElement("style", null, `a::after{content:"</style>"}`),
    );
    expect(out.match(/<\/style>/g)).toHaveLength(1);
    expect(out).toContain(`content:"<\\/style>"`);
  });

  test("ordinary elements are not touched", async () => {
    const out = await renderToString(
      createElement("p", null, "1 < 2 && 3 > 2"),
    );
    expect(out).toBe("<p>1 &lt; 2 &amp;&amp; 3 &gt; 2</p>");
  });

  test("script content with $&, $` etc. survives verbatim (no $-pattern substitution)", async () => {
    // minified `x&&y` short-circuits produce "$&&(" when the var is named $.
    const code = `z),$&&($.innerHTML="<svg>x</svg>"),done()`;
    const out = await renderToString(
      createElement("script", { dangerouslySetInnerHTML: { __html: code } }),
    );
    expect(out).toBe(`<script>${code}</script>`);
  });
});

describe("renderToString — lenient recovery", () => {
  test("a bare component function used as a child is invoked (props-less) and warns", async () => {
    const warn = spyOn(console, "warn").mockImplementation(() => {});
    try {
      const Icon = (p: { className?: string }) =>
        createElement("svg", { className: p.className ?? "default" });
      // <Badge icon={Icon}> -> Badge renders {icon} -> child is the raw fn
      const out = await renderToString(
        createElement("span", null, Icon as never),
      );
      expect(out).toBe(`<span><svg class="default"></svg></span>`);
      expect(String(warn.mock.calls[0]?.[0])).toContain(
        "used directly as a child",
      );
    } finally {
      warn.mockRestore();
    }
  });

  test("an anonymous function child still renders", async () => {
    const warn = spyOn(console, "warn").mockImplementation(() => {});
    try {
      const out = await renderToString(
        createElement("div", null, (() =>
          createElement("i", null, "x")) as never),
      );
      expect(out).toBe("<div><i>x</i></div>");
    } finally {
      warn.mockRestore();
    }
  });

  test("an element used where a tag/component was expected is unwrapped", async () => {
    const warn = spyOn(console, "warn").mockImplementation(() => {});
    try {
      const el = createElement("svg", { className: "icon" });
      // <X /> where X is already an element -> { type: el, props: {} }
      expect(await renderToString({ type: el, props: {} } as never)).toBe(
        `<svg class="icon"></svg>`,
      );
      // wrapper props are dropped, with a warning
      await renderToString({
        type: el,
        props: { className: "wrapper" },
      } as never);
      expect(String(warn.mock.calls.at(-1)?.[0])).toContain("used as a tag");
    } finally {
      warn.mockRestore();
    }
  });
});

describe("renderToString — malformed nodes", () => {
  test("a hand-built element with no props object renders (empty) instead of crashing", async () => {
    const warn = spyOn(console, "warn").mockImplementation(() => {});
    try {
      const bad = { type: "div", children: "hi" } as unknown;
      expect(await renderToString(bad as never)).toBe("<div></div>");
      expect(warn).toHaveBeenCalled();
      expect(String(warn.mock.calls[0]?.[0])).toContain("no props object");
    } finally {
      warn.mockRestore();
    }
  });

  test("an object that isn't an element throws a named error", async () => {
    await expect(renderToString({ foo: 1 } as never)).rejects.toThrow(
      /cannot render value as JSX/,
    );
  });

  test("a Promise passed as a child throws a named error", async () => {
    await expect(renderToString(Promise.resolve("x") as never)).rejects.toThrow(
      /cannot render value as JSX/,
    );
  });

  test("an element with an undefined type throws a named error", async () => {
    await expect(
      renderToString({ type: undefined, props: {} } as never),
    ).rejects.toThrow(/has no "type"/);
  });

  test("an element whose type is a number throws a named error", async () => {
    await expect(
      renderToString({ type: 42, props: {} } as never),
    ).rejects.toThrow(/"type" must be a string tag/);
  });
});
