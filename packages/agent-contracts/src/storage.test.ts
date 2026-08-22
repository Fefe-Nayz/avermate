import { describe, expect, test } from "bun:test";
import {
  objectStorageRangeInputSchema,
  ownedObjectRefSchema,
  objectTransferGrantInputSchema,
} from "./storage";

describe("object storage contracts", () => {
  test("accepts opaque owned keys and rejects traversal", () => {
    expect(
      ownedObjectRefSchema.safeParse({
        ownerId: "user-1",
        namespace: "course-files",
        key: "objects/abc/file.pdf",
      }).success,
    ).toBe(true);
    for (const key of ["../secret", "/absolute", "a/../../secret", "a//b"]) {
      expect(
        ownedObjectRefSchema.safeParse({
          ownerId: "user-1",
          namespace: "course-files",
          key,
        }).success,
      ).toBe(false);
    }
  });

  test("rejects inverted ranges", () => {
    expect(
      objectStorageRangeInputSchema.safeParse({
        ref: { ownerId: "user-1", namespace: "files", key: "a" },
        start: 10,
        endInclusive: 9,
      }).success,
    ).toBe(false);
  });

  test("bounds transfer grants to one object and a short lifetime", () => {
    const base = {
      ref: { ownerId: "user-1", namespace: "files", key: "a" },
      operation: "download",
      mode: "core-relay",
      byteLimit: 1_024,
      audience: "browser-session-1",
    };
    expect(
      objectTransferGrantInputSchema.safeParse({
        ...base,
        expiresInSeconds: 60,
      }).success,
    ).toBe(true);
    expect(
      objectTransferGrantInputSchema.safeParse({
        ...base,
        expiresInSeconds: 3_600,
      }).success,
    ).toBe(false);
  });
});
