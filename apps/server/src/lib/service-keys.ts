import { and, eq, sql } from "drizzle-orm";
import { db } from "../db";
import { userServiceKeys, type ServiceKeyKind } from "../db/schema";
import { open, seal } from "./crypto";
import { env } from "./env";
import { SecurityAuditWriter } from "../observability/audit";

const operatorKeys: Record<ServiceKeyKind, () => string | undefined> = {
  mistral: () => env.MISTRAL_API_KEY,
  transcription: () => env.TRANSCRIPTION_API_KEY,
  inference: () => env.INFERENCE_API_KEY,
};

/**
 * Operator-paid keys are never an implicit production fallback. Development
 * remains zero-config and a full self-host controls its own instance keys;
 * hosted production must explicitly enable the metered managed adapters.
 */
export function operatorServiceKeysEnabled() {
  return (
    env.AVERMATE_DEPLOYMENT_MODE === "full-self-host" ||
    env.NODE_ENV !== "production" ||
    env.MANAGED_ADAPTERS_ENABLED
  );
}

export type ResolvedServiceKey =
  | {
      key: string;
      source: "user";
      /** Internal CAS token. It must never cross an API boundary or be logged. */
      invalidationToken: string;
    }
  | {
      key: string;
      source: "operator";
    };

export function publicServiceKey(
  row: Pick<
    typeof userServiceKeys.$inferSelect,
    "kind" | "hint" | "status" | "updatedAt"
  >,
) {
  return {
    kind: row.kind,
    hint: row.hint,
    status: row.status,
    updatedAt: row.updatedAt,
  };
}

export async function listServiceKeys(userId: string) {
  const rows = await db
    .select({
      kind: userServiceKeys.kind,
      hint: userServiceKeys.hint,
      status: userServiceKeys.status,
      updatedAt: userServiceKeys.updatedAt,
    })
    .from(userServiceKeys)
    .where(eq(userServiceKeys.userId, userId));
  return rows.map(publicServiceKey);
}

export async function setServiceKey(
  userId: string,
  kind: ServiceKeyKind,
  plaintext: string,
) {
  const key = plaintext.trim();
  if (!key) throw new Error("A service key cannot be empty");
  const now = new Date();
  const sealedKey = seal(key);
  const [row] = await db
    .insert(userServiceKeys)
    .values({
      kind,
      provider: kind,
      sealedKey,
      hint: key.slice(-4),
      status: "active",
      userId,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: [userServiceKeys.userId, userServiceKeys.kind],
      set: {
        provider: kind,
        sealedKey,
        hint: key.slice(-4),
        keyVersion: sql`${userServiceKeys.keyVersion} + 1`,
        revokedAt: null,
        status: "active",
        updatedAt: now,
      },
    })
    .returning({
      kind: userServiceKeys.kind,
      hint: userServiceKeys.hint,
      status: userServiceKeys.status,
      updatedAt: userServiceKeys.updatedAt,
    });
  if (!row) throw new Error("The service key was not saved");
  return publicServiceKey(row);
}

export async function listProviderServiceKeyMetadata(userId: string) {
  return db
    .select({
      kind: userServiceKeys.kind,
      provider: userServiceKeys.provider,
      hint: userServiceKeys.hint,
      status: userServiceKeys.status,
      keyVersion: userServiceKeys.keyVersion,
      scopes: userServiceKeys.scopesJson,
      lastValidatedAt: userServiceKeys.lastValidatedAt,
      revokedAt: userServiceKeys.revokedAt,
      updatedAt: userServiceKeys.updatedAt,
    })
    .from(userServiceKeys)
    .where(eq(userServiceKeys.userId, userId));
}

/** Validate with one minimal provider call, then seal without ever echoing it. */
export async function setProviderServiceKey(input: {
  userId: string;
  kind: ServiceKeyKind;
  provider: string;
  plaintext: string;
  scopes: string[];
  validate: (key: string) => Promise<void>;
  correlationId: string;
}) {
  const key = input.plaintext.trim();
  if (!key) throw new Error("A service key cannot be empty");
  const provider = input.provider.trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9._-]{0,127}$/u.test(provider)) {
    throw new Error("Invalid provider identifier");
  }
  const scopes = [...new Set(input.scopes.map((scope) => scope.trim()))]
    .filter(Boolean)
    .sort();
  if (scopes.length > 64 || scopes.some((scope) => scope.length > 128)) {
    throw new Error("Invalid provider key scopes");
  }
  await input.validate(key);
  const now = new Date();
  const sealedKey = seal(key);
  const [row] = await db
    .insert(userServiceKeys)
    .values({
      kind: input.kind,
      provider,
      sealedKey,
      hint: key.slice(-4),
      keyVersion: 1,
      scopesJson: scopes,
      lastValidatedAt: now,
      revokedAt: null,
      status: "active",
      userId: input.userId,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: [userServiceKeys.userId, userServiceKeys.kind],
      set: {
        provider,
        sealedKey,
        hint: key.slice(-4),
        keyVersion: sql`${userServiceKeys.keyVersion} + 1`,
        scopesJson: scopes,
        lastValidatedAt: now,
        revokedAt: null,
        status: "active",
        updatedAt: now,
      },
    })
    .returning({
      id: userServiceKeys.id,
      kind: userServiceKeys.kind,
      provider: userServiceKeys.provider,
      hint: userServiceKeys.hint,
      keyVersion: userServiceKeys.keyVersion,
      scopes: userServiceKeys.scopesJson,
      lastValidatedAt: userServiceKeys.lastValidatedAt,
      status: userServiceKeys.status,
    });
  if (!row) throw new Error("The provider key was not saved");
  await new SecurityAuditWriter(db.$client).append({
    accountId: input.userId,
    actorId: input.userId,
    actorKind: "user",
    action: "provider-key.validated-and-rotated",
    resourceKind: "provider-key",
    resourceId: row.id,
    correlationId: input.correlationId,
    policyVersion: "provider-key-lifecycle/1",
    metadata: {
      provider,
      kind: input.kind,
      scopes,
      keyVersion: row.keyVersion,
    },
  });
  return row;
}

export async function revokeProviderServiceKey(input: {
  userId: string;
  kind: ServiceKeyKind;
  reason: string;
  correlationId: string;
}) {
  const now = new Date();
  const [row] = await db
    .update(userServiceKeys)
    .set({
      // Replace ciphertext so revocation also destroys Avermate's usable copy.
      sealedKey: seal(`revoked:${crypto.randomUUID()}`),
      hint: "",
      status: "revoked",
      revokedAt: now,
      updatedAt: now,
    })
    .where(
      and(
        eq(userServiceKeys.userId, input.userId),
        eq(userServiceKeys.kind, input.kind),
      ),
    )
    .returning({ id: userServiceKeys.id, provider: userServiceKeys.provider });
  if (row) {
    await new SecurityAuditWriter(db.$client).append({
      accountId: input.userId,
      actorId: input.userId,
      actorKind: "user",
      action: "provider-key.revoked",
      resourceKind: "provider-key",
      resourceId: row.id,
      justification: input.reason,
      correlationId: input.correlationId,
      policyVersion: "provider-key-lifecycle/1",
      metadata: { provider: row.provider, kind: input.kind },
    });
  }
  return { revoked: Boolean(row) };
}

export async function clearServiceKey(userId: string, kind: ServiceKeyKind) {
  await db
    .delete(userServiceKeys)
    .where(
      and(eq(userServiceKeys.userId, userId), eq(userServiceKeys.kind, kind)),
    );
  return { ok: true };
}

export async function markServiceKeyInvalid(
  userId: string,
  kind: ServiceKeyKind,
  invalidationToken: string,
) {
  const [invalidated] = await db
    .update(userServiceKeys)
    .set({ status: "invalid", updatedAt: new Date() })
    .where(
      and(
        eq(userServiceKeys.userId, userId),
        eq(userServiceKeys.kind, kind),
        eq(userServiceKeys.status, "active"),
        eq(userServiceKeys.sealedKey, invalidationToken),
      ),
    )
    .returning({ kind: userServiceKeys.kind });
  return Boolean(invalidated);
}

/** Resolve a usable user credential before falling back to the instance key. */
export async function resolveServiceKey(
  userId: string,
  kind: ServiceKeyKind,
): Promise<ResolvedServiceKey | null> {
  const [row] = await db
    .select({ sealedKey: userServiceKeys.sealedKey })
    .from(userServiceKeys)
    .where(
      and(
        eq(userServiceKeys.userId, userId),
        eq(userServiceKeys.kind, kind),
        eq(userServiceKeys.status, "active"),
      ),
    )
    .limit(1);
  if (row) {
    try {
      return {
        key: open(row.sealedKey),
        source: "user",
        invalidationToken: row.sealedKey,
      };
    } catch {
      await markServiceKeyInvalid(userId, kind, row.sealedKey);
    }
  }

  const operator = operatorServiceKeysEnabled()
    ? operatorKeys[kind]()?.trim()
    : undefined;
  return operator ? { key: operator, source: "operator" } : null;
}
