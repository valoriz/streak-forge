import { Dynamic } from "../../../jsx.js";

// Regression fixture for the CSS-purge sample scan's own Dynamic handling
// (cli/render.ts's expandDynamicForSample) — "only-inside-dynamic" exists
// ONLY inside a <Dynamic> block, "outside-dynamic" only outside it.
export const DynamicPurgeWidget = widget({})(() => ({
  type: "div",
  props: {
    children: [
      { type: "span", props: { className: "outside-dynamic", children: "outside" } },
      Dynamic({
        id: "purge-test-panel",
        children: { type: "span", props: { className: "only-inside-dynamic", children: "inside" } },
      }),
    ],
  },
}));
