import { describe, expect, test } from "bun:test";
import {
  closeManagedTestDatabase,
  createManagedTestDatabase,
} from "../managed/managed-test-db";
import { ManagedCostControlError, ManagedCostControls } from "./cost-controls";

const now = new Date("2026-08-22T12:00:00.000Z");
const nowSeconds = Math.floor(now.getTime() / 1_000);

describe.serial("managed cost and abuse controls", () => {
  test("blocks global, account, capability and provider circuit breakers", async () => {
    for (const [scope, scopeId] of [
      ["global", "*"],
      ["account", "account-a"],
      ["capability", "ocr.pages"],
      ["provider", "mistral"],
    ] as const) {
      const client = await createManagedTestDatabase();
      try {
        await client.execute({
          sql: `INSERT INTO managed_circuit_breakers
            (id, scope, scopeId, state, reasonCode, actorId, expiresAt, updatedAt)
            VALUES (?, ?, ?, 'open', 'shadow-cap-trip', 'test-admin', ?, ?)`,
          args: [
            `breaker-${scope}`,
            scope,
            scopeId,
            nowSeconds + 60,
            nowSeconds,
          ],
        });
        await expect(
          new ManagedCostControls(client, () => now).assertAllowed({
            accountId: "account-a",
            capability: "ocr.pages",
            provider: "mistral",
          }),
        ).rejects.toMatchObject({
          reasonCode: "shadow-cap-trip",
        } satisfies Partial<ManagedCostControlError>);
      } finally {
        await closeManagedTestDatabase(client);
      }
    }
  });

  test("blocks a scoped abuse decision but ignores expired controls", async () => {
    const client = await createManagedTestDatabase();
    try {
      await client.execute({
        sql: `INSERT INTO managed_abuse_decisions
          (id, accountId, capability, reasonCode, policyVersion, state,
           appealState, expiresAt, createdAt, updatedAt)
          VALUES ('abuse-a', 'account-a', 'ocr.pages', 'upload-risk',
            'abuse/1', 'quarantined', 'pending', ?, ?, ?)`,
        args: [nowSeconds + 60, nowSeconds, nowSeconds],
      });
      await client.execute({
        sql: `INSERT INTO managed_circuit_breakers
          (id, scope, scopeId, state, reasonCode, actorId, expiresAt, updatedAt)
          VALUES ('expired-a', 'global', '*', 'open', 'expired', 'test-admin', ?, ?)`,
        args: [nowSeconds - 1, nowSeconds - 10],
      });
      const controls = new ManagedCostControls(client, () => now);
      await expect(
        controls.assertAllowed({
          accountId: "account-a",
          capability: "ocr.pages",
        }),
      ).rejects.toMatchObject({ reasonCode: "upload-risk" });
      await expect(
        controls.assertAllowed({
          accountId: "account-a",
          capability: "tts.characters",
        }),
      ).resolves.toBeUndefined();
    } finally {
      await closeManagedTestDatabase(client);
    }
  });
});
