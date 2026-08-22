import { and, eq } from "drizzle-orm";
import { db } from "../db";
import { userServiceKeys, type ServiceKeyKind } from "../db/schema";
import { open, seal } from "./crypto";
import { env } from "./env";

const operatorKeys: Record<ServiceKeyKind, () => string | undefined> = {
  mistral: () => env.MISTRAL_API_KEY,
  transcription: () => env.TRANSCRIPTION_API_KEY,
  inference: () => env.INFERENCE_API_KEY,
};

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
      sealedKey,
      hint: key.slice(-4),
      status: "active",
      userId,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: [userServiceKeys.userId, userServiceKeys.kind],
      set: {
        sealedKey,
        hint: key.slice(-4),
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

  const operator = operatorKeys[kind]()?.trim();
  return operator ? { key: operator, source: "operator" } : null;
}
