import { describe, expect, test } from "bun:test";
import { CapabilityOperationStore } from "./operation-store";
import { capabilityDigest } from "./values";

type StoreClient = ConstructorParameters<typeof CapabilityOperationStore>[0];

const reservation = {
  ownerId: "owner-1",
  capability: "speech.synthesize" as const,
  purpose: "learning-content" as const,
  inputDigest: capabilityDigest({ text: "hello" }),
  idempotencyKey: "idem-1",
  policySnapshot: {},
};

describe("CapabilityOperationStore reservation races", () => {
  test("looks up live evidence by exact owner, family and idempotency key rather than a bounded list", async () => {
    let calls = 0;
    const client = {
      execute: async (statement: { sql: string; args: unknown[] }) => {
        calls += 1;
        expect(statement.sql).toContain(
          "ownerId = ? AND capabilityKind = ? AND idempotencyKey = ?",
        );
        expect(statement.args).toEqual([
          "owner-1",
          "language.generate",
          "live-1",
        ]);
        return { rows: [] };
      },
    } as unknown as StoreClient;
    expect(
      await new CapabilityOperationStore(client).findByIdempotencyKey(
        "owner-1",
        "language.generate",
        "live-1",
      ),
    ).toBeNull();
    expect(calls).toBe(1);
  });

  test("rethrows non-unique insert failures without recursion or collision reads", async () => {
    const failure = Object.assign(new Error("database is locked"), {
      code: "SQLITE_BUSY",
    });
    let calls = 0;
    const client = {
      execute: async () => {
        calls += 1;
        if (calls === 1) return { rows: [], rowsAffected: 0 };
        throw failure;
      },
      transaction: async () => {
        throw new Error("unexpected transaction");
      },
    } as unknown as StoreClient;

    let observed: unknown;
    try {
      await new CapabilityOperationStore(client).reserve(reservation);
    } catch (error) {
      observed = error;
    }

    expect(observed).toBe(failure);
    expect(calls).toBe(2);
  });

  test("re-reads exactly once for the idempotency UNIQUE collision", async () => {
    const policySnapshotDigest = capabilityDigest({});
    const collision = Object.assign(
      new Error(
        "UNIQUE constraint failed: capability_operations.ownerId, capability_operations.capabilityKind, capability_operations.idempotencyKey",
      ),
      { code: "SQLITE_CONSTRAINT" },
    );
    let calls = 0;
    const client = {
      execute: async () => {
        calls += 1;
        if (calls === 1) return { rows: [], rowsAffected: 0 };
        if (calls === 2) throw collision;
        return {
          rows: [
            {
              id: "cop-winner",
              ownerId: reservation.ownerId,
              capabilityKind: reservation.capability,
              purpose: reservation.purpose,
              inputDigest: reservation.inputDigest,
              idempotencyKey: reservation.idempotencyKey,
              policySnapshotDigest,
              state: "reserved",
              routePlanJson: null,
              resultRefJson: null,
              resultDigest: null,
              safeErrorCode: null,
              retryable: 0,
              ambiguous: 0,
              revision: 1,
              createdAt: 1_700_000_000_000,
              updatedAt: 1_700_000_000_000,
              completedAt: null,
            },
          ],
          rowsAffected: 0,
        };
      },
      transaction: async () => {
        throw new Error("unexpected transaction");
      },
    } as unknown as StoreClient;

    const result = await new CapabilityOperationStore(client).reserve(
      reservation,
    );

    expect(result.replayed).toBe(true);
    expect(result.operation.id).toBe("cop-winner");
    expect(calls).toBe(3);
  });
});
