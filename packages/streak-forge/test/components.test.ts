/**
 * Unit tests for streak-forge/components: Script (the options -> data-sf-opts
 * bridge + the per-widget minify cache), WidgetPlaceholder, Dynamic, Preload.
 *
 * These build VNodes by calling the components as plain functions and inspect
 * the returned `{ type, props }` — no render pipeline needed.
 */

import { describe, test, expect } from "bun:test";
import { Script, WidgetPlaceholder, Dynamic, Preload } from "../src/components";
import {
  SCRIPT_OPTS_ATTR,
  OPTS_PLACEHOLDER,
  customTags,
} from "../src/constants";
import { renderToString } from "../src/jsx/renderToString";

describe("Script — options bridge", () => {
  test("returns a <script> marker VNode carrying the id", () => {
    const vnode = Script({ id: "hero", children: () => {} });
    expect(vnode.type).toBe(customTags.SCRIPT);
    expect(vnode.props.id).toBe("hero");
  });

  test("data-sf-opts is JSON.stringify(options)", () => {
    const options = { accent: "#818cf8", ms: 700 };
    const vnode = Script({ id: "x", options, children: () => {} });
    expect(vnode.props[SCRIPT_OPTS_ATTR]).toBe(JSON.stringify(options));
  });

  test("data-sf-opts defaults to '{}' when options is omitted", () => {
    const vnode = Script({ id: "x", children: () => {} });
    expect(vnode.props[SCRIPT_OPTS_ATTR]).toBe("{}");
  });

  test("throws when options is not JSON-serializable", () => {
    const options = { toJSON: () => undefined };
    expect(() => Script({ id: "x", options, children: () => {} })).toThrow(
      /JSON-serializable/,
    );
  });

  test("the inline template keeps the OPTS_PLACEHOLDER identifier and calls into window", () => {
    const vnode = Script({ id: "x", children: (gDom) => gDom.location.href });
    const html = vnode.props.dangerouslySetInnerHTML.__html as string;
    expect(html).toContain(OPTS_PLACEHOLDER);
    expect(html).toContain("window");
  });

  test("string children (post-transform form) are accepted", () => {
    const vnode = Script({ id: "x", children: "(gDom,options)=>{options.k}" });
    expect(vnode.props.dangerouslySetInnerHTML.__html).toContain(
      OPTS_PLACEHOLDER,
    );
  });

  test("the minified template is cached: identical fn source => identical output string", () => {
    const fn = "(gDom,options)=>{gDom.loadPackage('p');return options.n;}";
    const a = Script({ id: "a", children: fn }).props.dangerouslySetInnerHTML
      .__html;
    const b = Script({ id: "b", children: fn }).props.dangerouslySetInnerHTML
      .__html;
    expect(a).toBe(b);
  });

  test("per-render options never leak into the cached template", () => {
    const fn = "(gDom,options)=>{options.secret}";
    const html = Script({
      id: "a",
      options: { secret: "hunter2" },
      children: fn,
    }).props.dangerouslySetInnerHTML.__html as string;
    expect(html).not.toContain("hunter2");
  });

  test("renders to a <script> tag with an escaped data-sf-opts attribute", async () => {
    const out = await renderToString(
      Script({ id: "x", options: { a: 1 }, children: () => {} }),
    );
    expect(out.startsWith(`<script id="x"`)).toBe(true);
    expect(out).toContain(`${SCRIPT_OPTS_ATTR}="{&quot;a&quot;:1}"`);
    expect(out.endsWith("</script>")).toBe(true);
  });
});

describe("WidgetPlaceholder", () => {
  test("throws when id is missing", () => {
    expect(() => WidgetPlaceholder({ id: "", type: "Foo" })).toThrow();
  });

  test("throws when type is missing", () => {
    expect(() => WidgetPlaceholder({ id: "Foo", type: "" })).toThrow();
  });

  test("returns a marker VNode carrying id and type", () => {
    const vnode = WidgetPlaceholder({ id: "Foo", type: "Bar" });
    expect(vnode.type).toBe(customTags.WIDGET);
    expect(vnode.props).toEqual({ id: "Foo", type: "Bar" });
  });
});

describe("Dynamic", () => {
  test("throws when id is missing", () => {
    expect(() => Dynamic({ id: "" })).toThrow();
  });

  test("wraps children under the given id", () => {
    const vnode = Dynamic({ id: "panel", children: "hello" });
    expect(vnode.type).toBe(customTags.DYNAMIC);
    expect(vnode.props.id).toBe("panel");
    expect(vnode.props.children).toBe("hello");
  });
});

describe("Preload", () => {
  test("passes href/as/media through unchanged", () => {
    const vnode = Preload({
      href: "/img.png",
      as: "image",
      media: "(min-width: 768px)",
    });
    expect(vnode.type).toBe(customTags.PRELOAD);
    expect(vnode.props).toEqual({
      href: "/img.png",
      as: "image",
      media: "(min-width: 768px)",
    });
  });
});
