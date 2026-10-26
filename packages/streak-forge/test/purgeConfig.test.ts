/**
 * Tests for purgecss.config.js -> JSON-safe purgeConfig. The optimizer only
 * receives JSON (dev-build POST body / raw-content.json), so RegExps must be
 * split into { source, flags } and anything non-data dropped.
 */

import { describe, test, expect } from "bun:test";
import fs from "fs";
import os from "os";
import path from "path";
import {
  loadPurgeConfig,
  serializePurgeConfig,
} from "../src/build/purgeConfig";

describe("serializePurgeConfig", () => {
  test("RegExps become { source, flags }, strings stay strings", () => {
    const out = serializePurgeConfig({
      dynamicAttributes: ["dir", "data-theme"],
      safelist: { standard: ["html", /^swiper-/], greedy: [/rtl/i] },
      blocklist: [/^debug-/],
      keyframes: true,
    });
    expect(out).toEqual({
      dynamicAttributes: ["dir", "data-theme"],
      safelist: {
        standard: ["html", { source: "^swiper-", flags: "" }],
        greedy: [{ source: "rtl", flags: "i" }],
      },
      blocklist: [{ source: "^debug-", flags: "" }],
      keyframes: true,
    });
    expect(JSON.parse(JSON.stringify(out))).toEqual(out);
  });

  test("array safelist is supported", () => {
    expect(serializePurgeConfig({ safelist: ["a", /b/] })).toEqual({
      safelist: ["a", { source: "b", flags: "" }],
    });
  });

  test("functions and unknown keys are dropped", () => {
    const out = serializePurgeConfig({
      defaultExtractor: (c: string) => c.split(" "),
      content: ["**/*.html"],
      safelist: ["ok", () => true],
      dynamicAttributes: ["dir", 1],
    });
    expect(out).toEqual({ safelist: ["ok"] });
  });

  test("nothing usable = undefined", () => {
    expect(serializePurgeConfig({})).toBeUndefined();
  });
});

describe("loadPurgeConfig", () => {
  test("reads named exports from purgecss.config.js in the project root", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sf-purge-"));
    fs.writeFileSync(
      path.join(dir, "purgecss.config.js"),
      `export const dynamicAttributes = ["dir"];\nexport const safelist = { greedy: [/rtl/] };\n`,
    );
    expect(await loadPurgeConfig(dir)).toEqual({
      dynamicAttributes: ["dir"],
      safelist: { greedy: [{ source: "rtl", flags: "" }] },
    });
  });

  test("missing file = undefined", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sf-purge-"));
    expect(await loadPurgeConfig(dir)).toBeUndefined();
  });
});
