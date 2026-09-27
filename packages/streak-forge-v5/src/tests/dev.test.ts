import { describe, test, expect, afterEach } from "bun:test";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { runDevBuildOnce, renderDevPage } from "../cli/dev.js";

const ROOT = join(import.meta.dir, "fixtures/dev-project");
const DEV_DIR = join(ROOT, ".dev");

afterEach(() => {
  rmSync(DEV_DIR, { recursive: true, force: true });
  rmSync(join(ROOT, ".streak-forge-cache"), { recursive: true, force: true });
});

describe("cli/dev.runDevBuildOnce", () => {
  test("promotes public/'s passthrough assets to a FLAT path under .dev/, matching what the mock server actually resolves", async () => {
    await runDevBuildOnce(ROOT);

    // The bug: this used to only exist nested under .dev/public/..., which
    // the mock server (outDir/<path> directly, matching the real out/'s
    // flat layout) never looked at — found for real via a 404 on
    // /images/streak-logo.svg in examples/hello-streak-app's dev server.
    const flatPath = join(DEV_DIR, "test-asset.txt");
    expect(existsSync(flatPath)).toBe(true);
    expect(readFileSync(flatPath, "utf-8")).toBe("hello-passthrough-asset\n");

    // The nested copy .dev/public/ still exists too (harmless, unused by
    // the server) — this test only asserts the FLAT copy the server
    // actually needs is there.
    expect(existsSync(join(DEV_DIR, "public", "test-asset.txt"))).toBe(true);
  });

  test("still writes a real, composable page — the promotion step doesn't break the rest of the build", async () => {
    await runDevBuildOnce(ROOT);
    expect(existsSync(join(DEV_DIR, "pages/index/meta.json"))).toBe(true);
    expect(existsSync(join(DEV_DIR, "body/AppShell/index.html"))).toBe(true);
  });
});

describe("cli/dev.renderDevPage — per-request re-render", () => {
  test("re-renders the requested page into .dev/ (a reload shows fresh output); unknown urls return false", async () => {
    const result = await runDevBuildOnce(ROOT);
    rmSync(join(DEV_DIR, "pages/index"), { recursive: true, force: true });

    expect(await renderDevPage(ROOT, result, "/")).toBe(true);
    expect(existsSync(join(DEV_DIR, "pages/index/meta.json"))).toBe(true);

    expect(await renderDevPage(ROOT, result, "/does-not-exist")).toBe(false);
  });
});
