import { describe, test, expect } from "bun:test";
import { join } from "node:path";
import { renderSample } from "../cli/render.js";

// Regression test: renderToString correctly treats an unresolved <Dynamic>
// as empty for the REAL build/request path (page-build.ts's
// extractDynamicBlocks always strips it out first) — but the CSS-purge
// sample scan (renderSample) never goes through that extraction, so
// without its own expandDynamicForSample step it would silently miss
// every class used only inside a Dynamic block, purging them as "unused".
//
// renderInstanceFromBundle has no test here — it lives only in the
// streak-boot package (streakjs repo), tested there.
describe("cli/render.renderSample — sees inside <Dynamic> blocks for CSS-purge scanning", () => {
  test("includes classes from both outside and inside a Dynamic block", async () => {
    const filePath = join(import.meta.dir, "fixtures/dynamic-purge-widget/DynamicPurgeWidget.tsx");
    const html = await renderSample({ filePath, exportName: "DynamicPurgeWidget" });

    expect(html).toContain("outside-dynamic");
    expect(html).toContain("only-inside-dynamic");
  });
});
