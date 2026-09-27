import { describe, expect, test } from "bun:test";
import { hashOf, hashValue } from "../hash.js";

describe("hash", () => {
  test("hashOf is deterministic", () => {
    expect(hashOf("abc")).toBe(hashOf("abc"));
    expect(hashOf("abc")).not.toBe(hashOf("abd"));
  });

  test("hashValue is insensitive to key order (props-hash cache key stability)", () => {
    const a = hashValue({ color: "red", size: "lg" });
    const b = hashValue({ size: "lg", color: "red" });
    expect(a).toBe(b);
  });

  test("hashValue differs when actual values differ", () => {
    const a = hashValue({ color: "red" });
    const b = hashValue({ color: "blue" });
    expect(a).not.toBe(b);
  });
});
