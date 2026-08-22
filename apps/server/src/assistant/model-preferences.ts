import {
  assistantModelPreferenceSchema,
  type AssistantModelPreference,
} from "@avermate/agent-contracts";
import type { AssistantSqlClient } from "./core-conversation-store";
import { isoFromSqlite } from "../search/values";

function nowSeconds() {
  return Math.floor(Date.now() / 1_000);
}

export type AssistantModelPreferenceUpdate = Omit<
  AssistantModelPreference,
  "revision" | "updatedAt"
> & { expectedRevision: number };

export class AssistantModelPreferenceService {
  constructor(private readonly client: AssistantSqlClient) {}

  async get(ownerId: string): Promise<AssistantModelPreference> {
    const result = await this.client.execute({
      sql: `SELECT * FROM assistant_model_preferences WHERE userId = ? LIMIT 1`,
      args: [ownerId],
    });
    const row = result.rows[0];
    if (!row) {
      return assistantModelPreferenceSchema.parse({
        defaultModelKey: null,
        route: "selected-only",
        fallback: "none",
        maximumInputTokens: null,
        maximumOutputTokens: null,
        maximumEstimatedCostMinor: null,
        currency: null,
        revision: 1,
        updatedAt: new Date(0).toISOString(),
      });
    }
    return assistantModelPreferenceSchema.parse({
      defaultModelKey:
        row.defaultModelKey === null ? null : String(row.defaultModelKey),
      route: row.route,
      fallback: row.fallback,
      maximumInputTokens:
        row.maximumInputTokens === null
          ? null
          : Number(row.maximumInputTokens),
      maximumOutputTokens:
        row.maximumOutputTokens === null
          ? null
          : Number(row.maximumOutputTokens),
      maximumEstimatedCostMinor:
        row.maximumEstimatedCostMinor === null
          ? null
          : Number(row.maximumEstimatedCostMinor),
      currency: row.currency === null ? null : String(row.currency),
      revision: Number(row.revision),
      updatedAt: isoFromSqlite(row.updatedAt),
    });
  }

  async update(
    ownerId: string,
    input: AssistantModelPreferenceUpdate,
  ): Promise<AssistantModelPreference> {
    const { expectedRevision, ...candidate } = input;
    const value = assistantModelPreferenceSchema.omit({
      revision: true,
      updatedAt: true,
    }).parse(candidate);
    const transaction = await this.client.transaction("write");
    try {
      const current = await transaction.execute({
        sql: `SELECT revision FROM assistant_model_preferences
              WHERE userId = ? LIMIT 1`,
        args: [ownerId],
      });
      const row = current.rows[0];
      const now = nowSeconds();
      if (!row) {
        if (expectedRevision !== 1) {
          throw new Error("Assistant model preference revision changed");
        }
        await transaction.execute({
          sql: `INSERT INTO assistant_model_preferences
            (userId, defaultModelKey, route, fallback, maximumInputTokens,
             maximumOutputTokens, maximumEstimatedCostMinor, currency,
             revision, createdAt, updatedAt)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, 2, ?, ?)`,
          args: [
            ownerId,
            value.defaultModelKey,
            value.route,
            value.fallback,
            value.maximumInputTokens,
            value.maximumOutputTokens,
            value.maximumEstimatedCostMinor,
            value.currency,
            now,
            now,
          ],
        });
      } else {
        const revision = Number(row.revision);
        if (revision !== expectedRevision) {
          throw new Error("Assistant model preference revision changed");
        }
        const changed = await transaction.execute({
          sql: `UPDATE assistant_model_preferences SET defaultModelKey = ?,
            route = ?, fallback = ?, maximumInputTokens = ?,
            maximumOutputTokens = ?, maximumEstimatedCostMinor = ?,
            currency = ?, revision = revision + 1, updatedAt = ?
            WHERE userId = ? AND revision = ?`,
          args: [
            value.defaultModelKey,
            value.route,
            value.fallback,
            value.maximumInputTokens,
            value.maximumOutputTokens,
            value.maximumEstimatedCostMinor,
            value.currency,
            now,
            ownerId,
            revision,
          ],
        });
        if (changed.rowsAffected !== 1) {
          throw new Error("Assistant model preference revision changed");
        }
      }
      await transaction.commit();
      return this.get(ownerId);
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  }
}
