import { describe, expect, test } from "bun:test";
import {
  deletionReceiptV1Schema,
  entitlementSnapshotV1Schema,
  managedCapabilitySchema,
  pricingSnapshotV1Schema,
  usageEventV1Schema,
  usageQuantitySchema,
} from "./managed";

const at = "2026-08-22T12:00:00.000Z";

describe("managed-plane contracts", () => {
  test("accepts exact integer quantities and rejects ambiguous numeric forms", () => {
    expect(usageQuantitySchema.parse("0")).toBe("0");
    expect(usageQuantitySchema.parse("900719925474099300000")).toBe(
      "900719925474099300000",
    );
    for (const invalid of ["", "-1", "01", "1.5", "1e3", "Infinity"]) {
      expect(() => usageQuantitySchema.parse(invalid)).toThrow();
    }
  });

  test("keeps entitlement authorization provider-neutral and versioned", () => {
    expect(
      entitlementSnapshotV1Schema.parse({
        version: 1,
        id: "snapshot-1",
        accountId: "account-1",
        revision: "operator/2026-08-22",
        plan: "internal-shadow",
        status: "active",
        period: { startsAt: at, endsAt: "2026-09-22T12:00:00.000Z" },
        capabilities: Object.fromEntries(
          managedCapabilitySchema.options.map((capability) => [
            capability,
            {
            enabled: true,
            hardLimit: "1000",
            concurrency: 2,
            },
          ]),
        ),
        source: "operator",
        issuedAt: at,
      }),
    ).toMatchObject({ revision: "operator/2026-08-22", source: "operator" });
  });

  test("requires adjustment evidence and nonce-bound deletion receipts", () => {
    expect(() =>
      usageEventV1Schema.parse({
        version: 1,
        id: "event-1",
        accountId: "account-1",
        capability: "ocr.pages",
        quantity: "-1",
        unit: "pages",
        direction: "adjust",
        idempotencyKey: "adjustment-1",
        placement: { kind: "managed", providerId: "managed-eu" },
        authoritative: true,
        occurredAt: at,
      }),
    ).toThrow();
    expect(
      deletionReceiptV1Schema.parse({
        version: 1,
        requestId: "delete-1",
        placement: { kind: "managed", providerId: "managed-eu" },
        verifierKind: "managed-adapter",
        nonce: "nonce-1",
        manifestDigest: `sha256:${"a".repeat(64)}`,
        deletedObjectClasses: ["objects", "indexes"],
        completedAt: at,
      }),
    ).toMatchObject({ nonce: "nonce-1", verifierKind: "managed-adapter" });
  });

  test("rejects a zero pricing scale", () => {
    expect(() =>
      pricingSnapshotV1Schema.parse({
        version: 1,
        id: "price-1",
        provider: "fixture",
        capability: "model.inputTokens",
        unit: "tokens",
        currency: "EUR",
        rateMinor: "1",
        quantityScale: "0",
        effectiveAt: at,
        source: "provider",
      }),
    ).toThrow();
  });
});
