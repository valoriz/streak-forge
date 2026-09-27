import { describe, test, expect } from "bun:test";
import { Dynamic, renderToString, collectScripts, type VNode } from "../jsx.js";

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
