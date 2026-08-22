import { createHash } from "node:crypto";
import type { InValue, Transaction } from "@libsql/client";
import {
  capabilityPlacementSchema,
  deletionReceiptV1Schema,
  placementDeletionStateSchema,
  type CapabilityPlacement,
  type DeletionReceiptV1,
  type PlacementDeletionState,
} from "@avermate/agent-contracts";
import type { EntitlementSqlClient } from "../entitlements/service";
import { newId } from "../lib/id";
import { SecurityAuditWriter } from "../observability/audit";
import { safeOperationalMetadata } from "../observability/redaction";

type Row = Record<string, InValue>;

function seconds(date: Date) {
  return Math.floor(date.getTime() / 1_000);
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => `${JSON.stringify(key)}:${canonical(child)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function digest(value: unknown): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(canonical(value)).digest("hex")}`;
}

export function managedPlacementKey(placement: CapabilityPlacement) {
  return placement.kind === "node"
    ? `node:${placement.nodeId}:${placement.providerId}`
    : `${placement.kind}:${placement.providerId}`;
}

export type PrivacyScope = {
  kind: "account" | "project" | "thread";
  id: string;
};

export type PlacementDeleteResult =
  | { state: "pending_remote_deletion" }
  | { state: "revoked_unreachable"; safeErrorCode: string }
  | { state: "user_action_required"; safeErrorCode: string }
  | { state: "failed"; safeErrorCode: string; retryable: boolean }
  | { state: "verified_deleted"; receipt: DeletionReceiptV1 };

export interface PrivacyPlacementHandler {
  readonly placement: CapabilityPlacement;
  readonly objectClasses: readonly string[];
  /** Revoke reads/grants and persist a domain tombstone in the same transaction. */
  tombstone(input: {
    accountId: string;
    scope: PrivacyScope;
    requestId: string;
    transaction: Transaction;
  }): Promise<void>;
  export(input: {
    accountId: string;
    scope: PrivacyScope;
  }): Promise<unknown>;
  delete(input: {
    accountId: string;
    scope: PrivacyScope;
    requestId: string;
    nonce: string;
    manifestDigest: `sha256:${string}`;
    objectClasses: readonly string[];
  }): Promise<PlacementDeleteResult>;
  trash?(input: { accountId: string; scope: PrivacyScope }): Promise<void>;
}

export interface PrivacyExportSink {
  adopt(input: {
    accountId: string;
    requestId: string;
    json: string;
    markdown: string;
    digest: `sha256:${string}`;
  }): Promise<unknown>;
}

export class PrivacyOperationError extends Error {
  constructor(
    readonly code: "not-found" | "forbidden" | "conflict" | "invalid-receipt",
    message: string,
  ) {
    super(message);
    this.name = "PrivacyOperationError";
  }
}

export class PrivacyOperationService {
  readonly #client: EntitlementSqlClient;
  readonly #handlers: Map<string, PrivacyPlacementHandler>;
  readonly #owns: (accountId: string, scope: PrivacyScope) => Promise<boolean>;
  readonly #exportSink?: PrivacyExportSink;
  readonly #verifyExternalReceipt?: (
    receipt: DeletionReceiptV1,
  ) => Promise<void> | void;
  readonly #clock: () => Date;
  readonly #audit: SecurityAuditWriter;

  constructor(input: {
    client: EntitlementSqlClient;
    handlers: PrivacyPlacementHandler[];
    owns: (accountId: string, scope: PrivacyScope) => Promise<boolean>;
    exportSink?: PrivacyExportSink;
    verifyExternalReceipt?: (
      receipt: DeletionReceiptV1,
    ) => Promise<void> | void;
    clock?: () => Date;
  }) {
    this.#client = input.client;
    this.#handlers = new Map(
      input.handlers.map((handler) => [
        managedPlacementKey(handler.placement),
        handler,
      ]),
    );
    this.#owns = input.owns;
    this.#exportSink = input.exportSink;
    this.#verifyExternalReceipt = input.verifyExternalReceipt;
    this.#clock = input.clock ?? (() => new Date());
    this.#audit = new SecurityAuditWriter(input.client, this.#clock);
  }

  async requestExport(input: {
    accountId: string;
    scope: PrivacyScope;
    actorId: string;
    correlationId: string;
  }) {
    await this.#assertOwned(input.accountId, input.scope);
    const requestId = newId("priv");
    await this.#client.execute({
      sql: `INSERT INTO privacy_operation_requests
        (id, accountId, kind, scopeKind, scopeId, state, requestedAt)
        VALUES (?, ?, 'export', ?, ?, 'running', ?)`,
      args: [
        requestId,
        input.accountId,
        input.scope.kind,
        input.scope.id,
        seconds(this.#clock()),
      ],
    });
    try {
      const placements = [] as { placement: CapabilityPlacement; data: unknown }[];
      for (const handler of this.#handlers.values()) {
        placements.push({
          placement: handler.placement,
          data: await handler.export({
            accountId: input.accountId,
            scope: input.scope,
          }),
        });
      }
      const archive = {
        exportVersion: 1,
        requestId,
        accountId: input.accountId,
        scope: input.scope,
        exportedAt: this.#clock().toISOString(),
        placements,
      };
      const archiveDigest = digest(archive);
      const json = JSON.stringify(archive, null, 2);
      const markdown = [
        "# Avermate data export",
        "",
        `- Request: ${requestId}`,
        `- Scope: ${input.scope.kind}/${input.scope.id}`,
        `- Digest: ${archiveDigest}`,
        `- Placements: ${placements.map((item) => managedPlacementKey(item.placement)).join(", ")}`,
        "",
        "The JSON manifest preserves exact placement and branch/artifact relationships.",
        "",
      ].join("\n");
      const objectRef = this.#exportSink
        ? await this.#exportSink.adopt({
            accountId: input.accountId,
            requestId,
            json,
            markdown,
            digest: archiveDigest,
          })
        : null;
      await this.#client.execute({
        sql: `UPDATE privacy_operation_requests SET state = 'completed',
          manifestDigest = ?, exportObjectRefJson = ?, completedAt = ?
          WHERE id = ? AND accountId = ?`,
        args: [
          archiveDigest,
          objectRef === null ? null : JSON.stringify(objectRef),
          seconds(this.#clock()),
          requestId,
          input.accountId,
        ],
      });
      await this.#audit.append({
        accountId: input.accountId,
        actorId: input.actorId,
        actorKind: "user",
        action: "privacy.export-completed",
        resourceKind: "privacy-operation",
        resourceId: requestId,
        correlationId: input.correlationId,
        policyVersion: "managed-privacy/1",
        metadata: { scope: input.scope, archiveDigest },
      });
      return { requestId, archive, json, markdown, digest: archiveDigest, objectRef };
    } catch (error) {
      await this.#client.execute({
        sql: `UPDATE privacy_operation_requests SET state = 'failed',
          safeErrorCode = 'EXPORT_FAILED', completedAt = ? WHERE id = ?`,
        args: [seconds(this.#clock()), requestId],
      });
      throw error;
    }
  }

  async requestTrash(input: {
    accountId: string;
    scope: PrivacyScope;
    actorId: string;
    correlationId: string;
  }) {
    await this.#assertOwned(input.accountId, input.scope);
    const requestId = newId("priv");
    await this.#client.execute({
      sql: `INSERT INTO privacy_operation_requests
        (id, accountId, kind, scopeKind, scopeId, state, requestedAt)
        VALUES (?, ?, 'trash', ?, ?, 'running', ?)`,
      args: [
        requestId,
        input.accountId,
        input.scope.kind,
        input.scope.id,
        seconds(this.#clock()),
      ],
    });
    for (const handler of this.#handlers.values()) {
      await handler.trash?.({ accountId: input.accountId, scope: input.scope });
    }
    await this.#client.execute({
      sql: `UPDATE privacy_operation_requests SET state = 'completed', completedAt = ?
        WHERE id = ? AND accountId = ?`,
      args: [seconds(this.#clock()), requestId, input.accountId],
    });
    await this.#audit.append({
      accountId: input.accountId,
      actorId: input.actorId,
      actorKind: "user",
      action: "privacy.trash-requested",
      resourceKind: "privacy-operation",
      resourceId: requestId,
      correlationId: input.correlationId,
      policyVersion: "managed-privacy/1",
      metadata: { scope: input.scope },
    });
    return { requestId, recoverable: true };
  }

  async requestDeleteNow(input: {
    accountId: string;
    scope: PrivacyScope;
    actorId: string;
    correlationId: string;
  }) {
    await this.#assertOwned(input.accountId, input.scope);
    const requestId = newId("priv");
    const descriptors = [...this.#handlers.values()].map((handler) => ({
      placement: handler.placement,
      placementKey: managedPlacementKey(handler.placement),
      objectClasses: [...handler.objectClasses].sort(),
      nonce: `delete_${crypto.randomUUID()}`,
    }));
    const manifestDigest = digest({
      version: 1,
      requestId,
      accountId: input.accountId,
      scope: input.scope,
      targets: descriptors,
    });
    const tx = await this.#client.transaction("write");
    try {
      await tx.execute({
        sql: `INSERT INTO privacy_operation_requests
          (id, accountId, kind, scopeKind, scopeId, state, manifestDigest,
           requestedAt, tombstoneAt)
          VALUES (?, ?, 'delete-now', ?, ?, 'running', ?, ?, ?)`,
        args: [
          requestId,
          input.accountId,
          input.scope.kind,
          input.scope.id,
          manifestDigest,
          seconds(this.#clock()),
          seconds(this.#clock()),
        ],
      });
      for (const descriptor of descriptors) {
        const handler = this.#handlers.get(descriptor.placementKey)!;
        await handler.tombstone({
          accountId: input.accountId,
          scope: input.scope,
          requestId,
          transaction: tx,
        });
        await tx.execute({
          sql: `INSERT INTO privacy_operation_targets
            (requestId, placementKey, placementJson, state, nonce,
             manifestDigest, objectClassesJson, attempts, updatedAt)
            VALUES (?, ?, ?, 'core_tombstoned', ?, ?, ?, 0, ?)`,
          args: [
            requestId,
            descriptor.placementKey,
            canonical(descriptor.placement),
            descriptor.nonce,
            manifestDigest,
            JSON.stringify(descriptor.objectClasses),
            seconds(this.#clock()),
          ],
        });
      }
      await this.#audit.append(
        {
          accountId: input.accountId,
          actorId: input.actorId,
          actorKind: "user",
          action: "privacy.delete-tombstoned",
          resourceKind: "privacy-operation",
          resourceId: requestId,
          correlationId: input.correlationId,
          policyVersion: "managed-privacy/1",
          metadata: { scope: input.scope, manifestDigest },
        },
        tx,
      );
      await tx.commit();
    } catch (error) {
      await tx.rollback();
      throw error;
    }
    return this.resumeDelete({ accountId: input.accountId, requestId });
  }

  async resumeDelete(input: { accountId: string; requestId: string }) {
    const requestRows = await this.#client.execute({
      sql: `SELECT * FROM privacy_operation_requests
        WHERE id = ? AND accountId = ? AND kind = 'delete-now' LIMIT 1`,
      args: [input.requestId, input.accountId],
    });
    const request = requestRows.rows[0] as Row | undefined;
    if (!request) throw new PrivacyOperationError("not-found", "Deletion request not found");
    const scope: PrivacyScope = {
      kind: request.scopeKind as PrivacyScope["kind"],
      id: String(request.scopeId),
    };
    const targetRows = await this.#client.execute({
      sql: `SELECT * FROM privacy_operation_targets
        WHERE requestId = ? ORDER BY placementKey`,
      args: [input.requestId],
    });
    for (const target of targetRows.rows as Row[]) {
      const current = placementDeletionStateSchema.parse(target.state);
      if (
        current === "verified_deleted" ||
        current === "revoked_unreachable" ||
        current === "user_action_required"
      ) {
        continue;
      }
      const handler = this.#handlers.get(String(target.placementKey));
      if (!handler) {
        await this.#setTarget(input.requestId, String(target.placementKey), {
          state: "pending_remote_deletion",
          safeErrorCode: "PLACEMENT_HANDLER_OFFLINE",
        });
        continue;
      }
      await this.#setTarget(input.requestId, String(target.placementKey), {
        state: "pending_remote_deletion",
      });
      let result: PlacementDeleteResult;
      try {
        result = await handler.delete({
          accountId: input.accountId,
          scope,
          requestId: input.requestId,
          nonce: String(target.nonce),
          manifestDigest: String(target.manifestDigest) as `sha256:${string}`,
          objectClasses: JSON.parse(String(target.objectClassesJson)) as string[],
        });
      } catch {
        result = {
          state: "failed",
          safeErrorCode: "PLACEMENT_DELETE_FAILED",
          retryable: true,
        };
      }
      if (result.state === "verified_deleted") {
        const receipt = deletionReceiptV1Schema.parse(result.receipt);
        this.#validateReceipt(target, receipt);
        if (receipt.verifierKind !== "managed-adapter") {
          await this.#verifyExternalReceipt?.(receipt);
        }
        await this.#setTarget(input.requestId, String(target.placementKey), {
          state: "verified_deleted",
          receipt,
        });
      } else {
        await this.#setTarget(input.requestId, String(target.placementKey), result);
      }
    }
    return this.#refreshRequest(input.accountId, input.requestId);
  }

  async get(accountId: string, requestId: string) {
    const rows = await this.#client.execute({
      sql: "SELECT * FROM privacy_operation_requests WHERE id = ? AND accountId = ? LIMIT 1",
      args: [requestId, accountId],
    });
    const request = rows.rows[0] as Row | undefined;
    if (!request) throw new PrivacyOperationError("not-found", "Privacy operation not found");
    const targets = await this.#client.execute({
      sql: `SELECT placementKey, placementJson, state, safeErrorCode,
        receiptJson, attempts, updatedAt FROM privacy_operation_targets
        WHERE requestId = ? ORDER BY placementKey`,
      args: [requestId],
    });
    return {
      id: String(request.id),
      kind: String(request.kind),
      scope: { kind: String(request.scopeKind), id: String(request.scopeId) },
      state: String(request.state),
      manifestDigest:
        request.manifestDigest === null ? null : String(request.manifestDigest),
      safeErrorCode:
        request.safeErrorCode === null ? null : String(request.safeErrorCode),
      targets: (targets.rows as Row[]).map((target) => ({
        placementKey: String(target.placementKey),
        placement: capabilityPlacementSchema.parse(
          JSON.parse(String(target.placementJson)),
        ),
        state: placementDeletionStateSchema.parse(target.state),
        safeErrorCode:
          target.safeErrorCode === null ? null : String(target.safeErrorCode),
        receipt:
          target.receiptJson === null
            ? null
            : deletionReceiptV1Schema.parse(
                typeof target.receiptJson === "string"
                  ? JSON.parse(target.receiptJson)
                  : target.receiptJson,
              ),
        attempts: Number(target.attempts),
      })),
    };
  }

  async #assertOwned(accountId: string, scope: PrivacyScope) {
    if (!(await this.#owns(accountId, scope))) {
      // Do not distinguish absent from cross-tenant resources.
      throw new PrivacyOperationError("not-found", "Privacy scope not found");
    }
  }

  #validateReceipt(row: Row, receipt: DeletionReceiptV1) {
    const placement = capabilityPlacementSchema.parse(
      JSON.parse(String(row.placementJson)),
    );
    if (
      receipt.requestId !== String(row.requestId) ||
      receipt.nonce !== String(row.nonce) ||
      receipt.manifestDigest !== String(row.manifestDigest) ||
      managedPlacementKey(receipt.placement) !== managedPlacementKey(placement)
    ) {
      throw new PrivacyOperationError(
        "invalid-receipt",
        "Deletion receipt is not bound to this request",
      );
    }
  }

  async #setTarget(
    requestId: string,
    placementKey: string,
    result:
      | PlacementDeleteResult
      | {
          state: PlacementDeletionState;
          safeErrorCode?: string;
          receipt?: DeletionReceiptV1;
        },
  ) {
    await this.#client.execute({
      sql: `UPDATE privacy_operation_targets SET state = ?, receiptJson = ?,
        safeErrorCode = ?, attempts = attempts + 1, lastAttemptAt = ?, updatedAt = ?
        WHERE requestId = ? AND placementKey = ?`,
      args: [
        result.state,
        "receipt" in result && result.receipt
          ? JSON.stringify(result.receipt)
          : null,
        "safeErrorCode" in result ? result.safeErrorCode ?? null : null,
        seconds(this.#clock()),
        seconds(this.#clock()),
        requestId,
        placementKey,
      ],
    });
  }

  async #refreshRequest(accountId: string, requestId: string) {
    const rows = await this.#client.execute({
      sql: "SELECT state FROM privacy_operation_targets WHERE requestId = ?",
      args: [requestId],
    });
    const states = (rows.rows as Row[]).map((row) =>
      placementDeletionStateSchema.parse(row.state),
    );
    const completed = states.every((state) => state === "verified_deleted");
    const pending = states.some((state) =>
      [
        "requested",
        "core_tombstoned",
        "pending_remote_deletion",
        "failed",
      ].includes(state),
    );
    const state = completed ? "completed" : pending ? "running" : "partial";
    await this.#client.execute({
      sql: `UPDATE privacy_operation_requests SET state = ?,
        completedAt = CASE WHEN ? <> 'running' THEN ? ELSE completedAt END
        WHERE id = ? AND accountId = ?`,
      args: [state, state, seconds(this.#clock()), requestId, accountId],
    });
    return this.get(accountId, requestId);
  }
}

export function managedDeletionReceipt(input: {
  requestId: string;
  placement: CapabilityPlacement;
  nonce: string;
  manifestDigest: `sha256:${string}`;
  objectClasses: readonly string[];
  completedAt?: Date;
}): DeletionReceiptV1 {
  return deletionReceiptV1Schema.parse({
    version: 1,
    requestId: input.requestId,
    placement: input.placement,
    verifierKind: "managed-adapter",
    nonce: input.nonce,
    manifestDigest: input.manifestDigest,
    deletedObjectClasses: [...input.objectClasses],
    completedAt: (input.completedAt ?? new Date()).toISOString(),
  });
}

export const privacyInternals = {
  canonical,
  digest,
  safeOperationalMetadata,
};
