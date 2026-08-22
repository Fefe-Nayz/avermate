import { and, eq } from "drizzle-orm";
import { db } from "../db";
import { mcpOperations } from "../db/schema";
import type {
  OperationReservation,
  PersistedProjectionBundle,
  ToolOperationStore,
} from "./idempotency";

/** Compatibility-backed durable fence. Legacy rows remain untouched/readable. */
export class DrizzleToolOperationStore implements ToolOperationStore {
  async reserve(input: {
    userId: string;
    toolId: string;
    toolVersion: number;
    branchId: string | null;
    idempotencyKey: string;
    argumentsHash: string;
  }): Promise<OperationReservation> {
    const toolName = `${input.toolId}@${input.toolVersion}#${input.branchId ?? "root"}`;
    const [created] = await db
      .insert(mcpOperations)
      .values({
        userId: input.userId,
        toolName,
        idempotencyKey: input.idempotencyKey,
        argumentsHash: input.argumentsHash,
      })
      .onConflictDoNothing()
      .returning({ id: mcpOperations.id });
    if (created) return { state: "new", reference: created.id };
    const [existing] = await db
      .select()
      .from(mcpOperations)
      .where(
        and(
          eq(mcpOperations.userId, input.userId),
          eq(mcpOperations.toolName, toolName),
          eq(mcpOperations.idempotencyKey, input.idempotencyKey),
        ),
      )
      .limit(1);
    if (!existing || existing.argumentsHash !== input.argumentsHash) {
      return { state: "conflict" };
    }
    if (existing.status === "completed" && existing.result) {
      const result = existing.result as Partial<PersistedProjectionBundle>;
      if ("model" in result && "ui" in result && "audit" in result) {
        return {
          state: "replayed",
          projections: result as PersistedProjectionBundle,
        };
      }
      return { state: "inspect-required" };
    }
    return { state: "inspect-required" };
  }

  async complete(
    reference: string,
    projections: PersistedProjectionBundle,
  ): Promise<void> {
    await db
      .update(mcpOperations)
      .set({
        status: "completed",
        result: projections as Record<string, unknown>,
        completedAt: new Date(),
      })
      .where(eq(mcpOperations.id, reference));
  }

  async inspectRequired(_reference: string): Promise<void> {
    // The legacy table intentionally represents inspect-required as pending.
  }
}
