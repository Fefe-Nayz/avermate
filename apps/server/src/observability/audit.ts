import type { Client, Transaction } from "@libsql/client";
import { newId } from "../lib/id";
import { safeOperationalMetadata } from "./redaction";

type SqlTarget = Pick<Client, "execute"> | Transaction;

function seconds(date: Date) {
  return Math.floor(date.getTime() / 1_000);
}

export class SecurityAuditWriter {
  constructor(
    private readonly client: Pick<Client, "execute">,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  async append(
    input: {
      accountId?: string | null;
      actorId: string;
      actorKind: "user" | "admin" | "system" | "provider";
      action: string;
      resourceKind: string;
      resourceId?: string | null;
      justification?: string | null;
      correlationId: string;
      policyVersion: string;
      metadata?: unknown;
    },
    target: SqlTarget = this.client,
  ) {
    const id = newId("saud");
    await target.execute({
      sql: `INSERT INTO security_audit_events
        (id, accountId, actorId, actorKind, action, resourceKind, resourceId,
         justification, correlationId, policyVersion, redactedMetadataJson,
         occurredAt)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [
        id,
        input.accountId ?? null,
        input.actorId,
        input.actorKind,
        input.action,
        input.resourceKind,
        input.resourceId ?? null,
        input.justification ?? null,
        input.correlationId,
        input.policyVersion,
        JSON.stringify(safeOperationalMetadata(input.metadata ?? {})),
        seconds(this.clock()),
      ],
    });
    return id;
  }
}
