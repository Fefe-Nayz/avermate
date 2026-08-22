import type { Client } from "@libsql/client";
import type {
  IngestionReasonCode,
  IngestionStrategy,
} from "@avermate/agent-contracts";
import { db } from "../db";
import { newId } from "../lib/id";
import { canonicalJson } from "../search/values";
import { safeIngestionFailure } from "./errors";

type SqlClient = Pick<Client, "execute" | "transaction">;

function now() {
  return Math.floor(Date.now() / 1_000);
}

export class SourceIngestionRevisionStore {
  constructor(private readonly client: SqlClient = db.$client) {}

  async create(input: {
    ownerId: string;
    documentId: string;
    strategy: IngestionStrategy;
    canonicalUrl: string;
    policyRef: string;
    settings?: Record<string, unknown>;
    actionId?: string | null;
  }) {
    const id = newId("irev");
    const timestamp = now();
    const inserted = await this.client.execute({
      sql: `
        INSERT INTO source_ingestion_revisions (
          id, userId, documentId, revision, strategy, state, canonicalUrl,
          policyRef, settingsVersion, settingsJson, actionId, createdAt, updatedAt
        )
        SELECT ?, document.userId, document.id,
          COALESCE((
            SELECT MAX(previous.revision) + 1
            FROM source_ingestion_revisions previous
            WHERE previous.documentId = document.id
          ), 1),
          ?, 'planned', document.sourceUrl, ?, 1, ?, ?, ?, ?
        FROM material_documents document
        WHERE document.id = ? AND document.userId = ?
          AND document.sourceType = 'link' AND document.sourceUrl = ?
      `,
      args: [
        id,
        input.strategy,
        input.policyRef,
        canonicalJson(input.settings ?? {}),
        input.actionId ?? null,
        timestamp,
        timestamp,
        input.documentId,
        input.ownerId,
        input.canonicalUrl,
      ],
    });
    if (Number(inserted.rowsAffected) !== 1) {
      throw new Error("The link material is unavailable");
    }
    const revisionRow = await this.client.execute({
      sql: `SELECT revision FROM source_ingestion_revisions WHERE id = ? AND userId = ? LIMIT 1`,
      args: [id, input.ownerId],
    });
    return Object.freeze({ id, revision: Number(revisionRow.rows[0]!.revision) });
  }

  async queued(input: { ownerId: string; id: string; jobId: string }) {
    await this.transition(input.ownerId, input.id, ["planned"], "queued", {
      jobId: input.jobId,
    });
  }

  async running(ownerId: string, id: string) {
    await this.transition(ownerId, id, ["planned", "queued", "running"], "running", {
      startedAt: now(),
    });
  }

  async ready(input: {
    ownerId: string;
    id: string;
    strategy?: IngestionStrategy;
    finalUrl: string;
    language?: string | null;
    resultDigest?: string | null;
    diagnostics?: Record<string, unknown>;
  }) {
    await this.transition(input.ownerId, input.id, ["running", "queued"], "ready", {
      strategy: input.strategy,
      finalUrl: input.finalUrl,
      language: input.language ?? null,
      resultDigest: input.resultDigest ?? null,
      diagnosticsVersion: input.diagnostics ? 1 : null,
      diagnosticsJson: input.diagnostics
        ? canonicalJson(input.diagnostics)
        : null,
      completedAt: now(),
      reasonCode: null,
      safeError: null,
    });
  }

  async failed(ownerId: string, id: string, error: unknown) {
    const failure = safeIngestionFailure(error);
    await this.transition(ownerId, id, ["planned", "queued", "running"], "failed", {
      reasonCode: failure.reasonCode,
      safeError: failure.message,
      completedAt: now(),
    });
    return failure;
  }

  async list(ownerId: string, documentId: string) {
    const result = await this.client.execute({
      sql: `
        SELECT * FROM source_ingestion_revisions
        WHERE userId = ? AND documentId = ?
        ORDER BY revision DESC LIMIT 50
      `,
      args: [ownerId, documentId],
    });
    return result.rows.map((row) => ({
      id: String(row.id),
      revision: Number(row.revision),
      strategy: String(row.strategy) as IngestionStrategy,
      state: String(row.state),
      reasonCode:
        row.reasonCode === null
          ? null
          : (String(row.reasonCode) as IngestionReasonCode),
      safeError: row.safeError === null ? null : String(row.safeError),
      canonicalUrl: String(row.canonicalUrl),
      finalUrl: row.finalUrl === null ? null : String(row.finalUrl),
      language: row.language === null ? null : String(row.language),
      jobId: row.jobId === null ? null : String(row.jobId),
      createdAt: new Date(Number(row.createdAt) * 1_000),
      completedAt:
        row.completedAt === null
          ? null
          : new Date(Number(row.completedAt) * 1_000),
    }));
  }

  private async transition(
    ownerId: string,
    id: string,
    from: readonly string[],
    to: string,
    values: {
      jobId?: string;
      strategy?: IngestionStrategy;
      finalUrl?: string;
      language?: string | null;
      resultDigest?: string | null;
      diagnosticsVersion?: number | null;
      diagnosticsJson?: string | null;
      reasonCode?: IngestionReasonCode | null;
      safeError?: string | null;
      startedAt?: number;
      completedAt?: number;
    },
  ) {
    const sets: string[] = ["state = ?", "updatedAt = ?"];
    const args: Array<string | number | null> = [to, now()];
    for (const [key, value] of Object.entries(values)) {
      if (value === undefined) continue;
      sets.push(`${key} = ?`);
      args.push(value);
    }
    const placeholders = from.map(() => "?").join(", ");
    const result = await this.client.execute({
      sql: `UPDATE source_ingestion_revisions SET ${sets.join(", ")} WHERE id = ? AND userId = ? AND state IN (${placeholders})`,
      args: [...args, id, ownerId, ...from],
    });
    if (Number(result.rowsAffected) !== 1) {
      throw new Error(`Ingestion revision transition to ${to} lost its state fence`);
    }
  }
}

export const sourceIngestionRevisionStore = new SourceIngestionRevisionStore();
