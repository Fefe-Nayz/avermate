import { describe, expect, test } from "bun:test";
import { canonicalDigest, canonicalJson } from "./canonical-json";

describe("RFC 8785 canonical envelope", () => {
  test("sorts object keys recursively without changing array order", () => {
    expect(canonicalJson({ z: [3, 2, 1], a: { y: true, x: null } })).toBe(
      '{"a":{"x":null,"y":true},"z":[3,2,1]}',
    );
    expect(canonicalDigest({ b: 1, a: 2 })).toBe(
      canonicalDigest({ a: 2, b: 1 }),
    );
  });

  test("rejects silent JSON coercions", () => {
    expect(() => canonicalJson({ missing: undefined })).toThrow();
    expect(() => canonicalJson(Number.NaN)).toThrow();
    expect(() => canonicalJson(new Date())).toThrow();
  });
});
