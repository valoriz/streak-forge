import { describe, test, expect } from "bun:test";
import { Dynamic, renderToString, collectScripts, isKind, resolvePlaceholders, WidgetPlaceholder, type VNode } from "../jsx.js";

// jsx.ts's Dynamic marker itself — a thin wrapper preserving id/children,
// same shape as WidgetPlaceholder/ComponentPlaceholder. The real
// extraction behavior (children rendered+persisted separately, node
// replaced with a plain marker div) lives in page-build.ts's
// extractDynamicBlocks and is covered there — this file only pins down
// Dynamic's own contract in isolation.
describe("jsx.Dynamic", () => {
  test("throws when id is missing", () => {
    expect(() => Dynamic({ id: "" })).toThrow();
  });

  test("wraps children under the given id, unresolved", () => {
    const vnode = Dynamic({ id: "panel", children: "hello" });
    expect(vnode.type).toBe(Dynamic);
    expect(vnode.props.id).toBe("panel");
    expect(vnode.props.children).toBe("hello");
  });

  test("renderToString treats an unresolved Dynamic as empty (defensive fallback)", async () => {
    const vnode: VNode = Dynamic({ id: "panel", children: "hello" });
    expect(await renderToString(vnode)).toBe("");
  });

  test("collectScripts does not descend into an unresolved Dynamic", async () => {
    const vnode: VNode = Dynamic({ id: "panel", children: "hello" });
    expect(await collectScripts(vnode)).toEqual([]);
  });
});

describe("jsx.renderToString raw content", () => {
  test("dangerouslySetInnerHTML renders its __html unescaped and is not emitted as an attribute", async () => {
    const node: VNode = { type: "div", props: { id: "x", dangerouslySetInnerHTML: { __html: "<b>hi</b>" } } };
    expect(await renderToString(node)).toBe('<div id="x"><b>hi</b></div>');
  });

  test("<script> children stay raw text, and a stray </script is escaped", async () => {
    const node: VNode = { type: "script", props: { children: 'if (a < b) x = "</script>";' } };
    expect(await renderToString(node)).toBe('<script>if (a < b) x = "<\\/script>";</script>');
  });

  test("<script dangerouslySetInnerHTML> is escaped the same way", async () => {
    const node: VNode = { type: "script", props: { dangerouslySetInnerHTML: { __html: "window.X = 1 < 2;<!--" } } };
    expect(await renderToString(node)).toBe("<script>window.X = 1 < 2;<\\!--</script>");
  });
});

describe("jsx.isKind — placeholders built by the other package's copy of jsx.ts", () => {
  // streak-forge and streak-boot each ship a jsx.ts; a VNode made by one
  // must be recognized by the other. Simulate the other copy's function.
  function otherCopy(kind: string) {
    const fn = (props: Record<string, unknown>): VNode => ({ type: fn, props });
    (fn as unknown as Record<symbol, string>)[Symbol.for("streak-forge.kind")] = kind;
    return fn;
  }

  test("matches by kind, not only by identity", () => {
    expect(isKind(otherCopy("widget-placeholder"), WidgetPlaceholder)).toBe(true);
    expect(isKind(otherCopy("dynamic"), WidgetPlaceholder)).toBe(false);
    expect(isKind(() => null, WidgetPlaceholder)).toBe(false);
  });

  test("resolvePlaceholders resolves the other copy's WidgetPlaceholder", async () => {
    const Other = otherCopy("widget-placeholder");
    const tree: VNode = { type: "div", props: { children: [Other({ id: "nav", type: "Nav" })] } };
    const resolved = await resolvePlaceholders(tree, WidgetPlaceholder, (id) => ({ type: "nav", props: { id } }));
    expect(await renderToString(resolved)).toBe('<div><nav id="nav"></nav></div>');
  });
});
