import { describe, expect, test } from "bun:test";
import { z } from "zod";
import {
  enforceFederatedRiskFloor,
  namespacedExternalToolId,
  opaqueFileHandleSchema,
  toolBudgetSchema,
  toolResultV1Schema,
} from "./index";

describe("tool contracts", () => {
  test("keeps result audiences structurally explicit", () => {
    const schema = toolResultV1Schema(
      z.strictObject({ count: z.number().int().nonnegative() }),
    );
    expect(schema.parse({ ok: true, data: { count: 2 } })).toEqual({
      ok: true,
      data: { count: 2 },
    });
    expect(() =>
      schema.parse({ ok: true, data: { count: 2 }, signedUrl: "secret" }),
    ).toThrow();
  });

  test("requires bounded budgets and opaque file handles", () => {
    expect(
      toolBudgetSchema.parse({ maxBytes: 1, maxDepth: 1, maxItems: 1 }),
    ).toBeTruthy();
    expect(() =>
      opaqueFileHandleSchema.parse("/private/bucket/file.pdf"),
    ).toThrow();
    expect(opaqueFileHandleSchema.parse(`fh1.${"a".repeat(32)}`)).toBeTruthy();
  });

  test("namespaces external IDs and never trusts advertised low risk", () => {
    expect(namespacedExternalToolId("my source", "grades.read")).toBe(
      "external.my-source.grades.read",
    );
    expect(enforceFederatedRiskFloor("low", "user-configured")).toBe("high");
    expect(enforceFederatedRiskFloor("irreversible", "node")).toBe(
      "irreversible",
    );
  });
});
