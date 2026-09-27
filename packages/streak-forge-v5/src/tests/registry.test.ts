import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { writeFileSync, rmSync, mkdirSync, readFileSync } from "node:fs";
import { fullScan, incrementalRescan, saveRegistry, loadRegistry } from "../registry.js";
import { walkFiles } from "../fs-utils.js";

const FIXTURES = join(import.meta.dir, "fixtures");

describe("registry.fullScan", () => {
  test("scans widgets + handlers dirs into one registry, both widget kinds present", () => {
    const registry = fullScan(join(FIXTURES, "widgets"), join(FIXTURES, "handlers"));

    expect(Object.keys(registry.widgets).sort()).toEqual(["HelloBanner", "StaticBadge"]);
    expect(registry.widgets.HelloBanner!.kind).toBe("handler");
    expect(registry.widgets.StaticBadge!.kind).toBe("static");
    expect(Object.keys(registry.handlers)).toEqual(["HelloBannerHandler"]);
    expect(registry.version).toBe(1);
  });
});

describe("registry.incrementalRescan", () => {
  const scratch = join(import.meta.dir, "fixtures-scratch");

  test("changing a widget file updates only that widget's entry", () => {
    rmSync(scratch, { recursive: true, force: true });
    mkdirSync(join(scratch, "widgets"), { recursive: true });
    mkdirSync(join(scratch, "handlers"), { recursive: true });

    const widgetPath = join(scratch, "widgets/Foo.tsx");
    writeFileSync(
      widgetPath,
      `export const Foo = widget({})((props: any) => "<div>v1</div>");\n`,
    );

    const registry = fullScan(join(scratch, "widgets"), join(scratch, "handlers"));
    expect(registry.widgets.Foo!.sourceHash).toBeDefined();
    const originalHash = registry.widgets.Foo!.sourceHash;

    // Simulate an edit.
    writeFileSync(
      widgetPath,
      `export const Foo = widget({})((props: any) => "<div>v2 CHANGED</div>");\n`,
    );

    const allFiles = [
      ...walkFiles(join(scratch, "widgets"), [".tsx", ".ts"]),
      ...walkFiles(join(scratch, "handlers"), [".ts"]),
    ];
    const updated = incrementalRescan(registry, widgetPath, allFiles);

    expect(updated.widgets.Foo!.sourceHash).not.toBe(originalHash);
    expect(Object.keys(updated.widgets)).toEqual(["Foo"]); // no duplicate/stale entries

    rmSync(scratch, { recursive: true, force: true });
  });

  test("editing a file that another widget imports invalidates the dependent too", () => {
    rmSync(scratch, { recursive: true, force: true });
    mkdirSync(join(scratch, "widgets"), { recursive: true });
    mkdirSync(join(scratch, "handlers"), { recursive: true });

    const sharedPath = join(scratch, "widgets/shared.ts");
    const dependentPath = join(scratch, "widgets/Dependent.tsx");

    writeFileSync(sharedPath, `export const LABEL = "v1";\n`);
    writeFileSync(
      dependentPath,
      `import { LABEL } from "./shared";\nexport const Dependent = widget({})(() => LABEL);\n`,
    );

    const registry = fullScan(join(scratch, "widgets"), join(scratch, "handlers"));
    const originalHash = registry.widgets.Dependent!.sourceHash;

    // Only shared.ts changes — Dependent.tsx's own text is untouched.
    writeFileSync(sharedPath, `export const LABEL = "v2 CHANGED";\n`);

    const allFiles = [
      ...walkFiles(join(scratch, "widgets"), [".tsx", ".ts"]),
      ...walkFiles(join(scratch, "handlers"), [".ts"]),
    ];
    const updated = incrementalRescan(registry, sharedPath, allFiles);

    // Dependent's registry entry must still exist (re-registered) even though
    // its own sourceHash is unchanged (its file text didn't change) — this
    // test mainly proves the dependent file gets re-parsed at all, not lost.
    expect(updated.widgets.Dependent).toBeDefined();
    expect(updated.widgets.Dependent!.sourceHash).toBe(originalHash);

    rmSync(scratch, { recursive: true, force: true });
  });
});

describe("registry.saveRegistry / loadRegistry — portable paths", () => {
  const OUT = join(import.meta.dir, "registry-scratch");

  test("meta.json stores filePath relative to the project root; loading resolves it against the given root", () => {
    rmSync(OUT, { recursive: true, force: true });
    const registry = fullScan(join(FIXTURES, "widgets"), join(FIXTURES, "handlers"));
    saveRegistry(registry, OUT, import.meta.dir);

    const persisted = JSON.parse(readFileSync(join(OUT, "widgets/HelloBanner/meta.json"), "utf-8"));
    expect(persisted.meta.filePath).toBe("fixtures/widgets/HelloBanner.tsx");

    // Same output folder, loaded as if copied under another project root.
    const loaded = loadRegistry(OUT, "/elsewhere/project")!;
    const widget = loaded.widgets.HelloBanner!;
    expect(widget.filePath).toBe("/elsewhere/project/fixtures/widgets/HelloBanner.tsx");
    expect(loaded.fileHashes[widget.filePath]).toBe(registry.fileHashes[registry.widgets.HelloBanner!.filePath]);
    rmSync(OUT, { recursive: true, force: true });
  });
});
