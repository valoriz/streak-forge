import { describe, test, expect, afterEach } from "bun:test";
import { rmSync } from "node:fs";
import { join } from "node:path";
import { runPreBuild } from "../build.js";

const FIXTURES = join(import.meta.dir, "fixtures");
const OUT_DIR = join(import.meta.dir, "build-scratch");

afterEach(() => {
  rmSync(OUT_DIR, { recursive: true, force: true });
  rmSync(".streak-forge-cache", { recursive: true, force: true });
});

// Trivial, always-succeeding stand-ins — the collision check (when it
// fires) happens before either is ever called, so these only need to be
// real enough for the non-colliding/scopeClasses:false path below.
const fakePurgeEngine = async () => ".a{color:red}\n.b{color:blue}";
const fakeRenderSample = async () => "<div>sample</div>";

describe("build.runPreBuild scopeClasses collision check", () => {
  // "Type105" and "Type126" are a REAL, verified shortScopePrefix collision
  // (both hash to "cc40") — not a hypothetical, found by brute-force search
  // over shortScopePrefix's own 3-hex-char space. Deliberately tiny (see
  // shortScopePrefix's own doc comment on why) — this test is what makes
  // that tradeoff safe: a collision is a loud, immediate build failure,
  // never silent style corruption.
  const widgetsDir = join(FIXTURES, "collision-widgets");

  test("throws, naming both colliding types, when scopeClasses is true", async () => {
    await expect(
      runPreBuild({
        widgetsDir,
        handlersDir: join(FIXTURES, "does-not-exist"),
        outDir: OUT_DIR,
        fullCssPath: join(FIXTURES, "does-not-exist.css"),
        purgeEngine: fakePurgeEngine,
        renderSample: fakeRenderSample,
        strict: true,
        bundle: false,
        scopeClasses: true,
      }),
    ).rejects.toThrow(/scopeClasses prefix collision.*"Type105".*"Type126"|scopeClasses prefix collision.*"Type126".*"Type105"/);
  });

  test("does NOT throw when scopeClasses is false (default) — the check only runs when scoping is actually used", async () => {
    const result = await runPreBuild({
      widgetsDir,
      handlersDir: join(FIXTURES, "does-not-exist"),
      outDir: OUT_DIR,
      fullCssPath: join(FIXTURES, "does-not-exist.css"),
      purgeEngine: fakePurgeEngine,
      renderSample: fakeRenderSample,
      strict: true,
      bundle: false,
    });
    expect(Object.keys(result.registry.widgets).sort()).toEqual(["Type105", "Type126"]);
  });

  test("no collision, no throw — distinct widgets with distinct prefixes build fine with scopeClasses: true", async () => {
    const result = await runPreBuild({
      widgetsDir: join(FIXTURES, "widgets"), // HelloBanner + StaticBadge — no known collision
      handlersDir: join(FIXTURES, "does-not-exist"),
      outDir: OUT_DIR,
      fullCssPath: join(FIXTURES, "does-not-exist.css"),
      purgeEngine: fakePurgeEngine,
      renderSample: fakeRenderSample,
      strict: true,
      bundle: false,
      scopeClasses: true,
    });
    expect(Object.keys(result.registry.widgets).sort()).toEqual(["HelloBanner", "StaticBadge"]);
  });
});
