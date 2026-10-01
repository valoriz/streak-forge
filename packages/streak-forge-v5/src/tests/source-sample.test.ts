import { describe, expect, test, afterEach } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { sourceSampleFor } from "../cli/source-sample";

const ROOT = join(import.meta.dir, "source-sample-scratch");

afterEach(() => {
  rmSync(ROOT, { recursive: true, force: true });
});

function write(rel: string, text: string): string {
  const path = join(ROOT, rel);
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, text);
  return path;
}

describe("cli/source-sample.sourceSampleFor", () => {
  test("returns the entry's source plus its project imports, transitively, without running them", async () => {
    const entry = write(
      "project/src/widgets/Card.tsx",
      'import { Badge } from "../common/Badge";\nexport const Card = widget({})(() => <div className="p-4 card-root" />);\n',
    );
    write(
      "project/src/common/Badge.tsx",
      'import "./deep";\nexport const Badge = () => <span className="badge-pill" />;\n',
    );
    write(
      "project/src/common/deep.ts",
      'throw new Error("must never execute"); export const x = "deep-class";\n',
    );

    const text = await sourceSampleFor(join(ROOT, "project"))({
      filePath: entry,
    });
    expect(text).toContain("card-root");
    expect(text).toContain("badge-pill");
    expect(text).toContain("deep-class");
  });

  test("never reads node_modules or files outside the project root", async () => {
    const entry = write(
      "project/src/widgets/Card.tsx",
      'import { a } from "outside-pkg";\nimport { b } from "../../../elsewhere/lib";\nexport const Card = () => null;\n',
    );
    write(
      "project/node_modules/outside-pkg/index.ts",
      'export const a = "from-node-modules";\n',
    );
    write("elsewhere/lib.ts", 'export const b = "from-outside-root";\n');

    const text = await sourceSampleFor(join(ROOT, "project"))({
      filePath: entry,
    });
    expect(text).not.toContain("from-node-modules");
    expect(text).not.toContain("from-outside-root");
  });
});
