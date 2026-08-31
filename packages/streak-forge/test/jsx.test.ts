/**
 * Unit tests for the JSX runtime: `createElement` / `jsx` VNode construction
 * and `renderToString` HTML serialization.
 *
 * Run with:  bun test   (from packages/streak-forge, or `bun run test` at the repo root)
 */

import { describe, test, expect } from "bun:test";
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
