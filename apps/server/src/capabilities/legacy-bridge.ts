import { createHash } from "node:crypto";
import type { Client, InValue } from "@libsql/client";
import { db } from "../db";
import { capabilityIso } from "./values";

type SqlClient = Pick<Client, "execute">;
type Row = Record<string, InValue>;

export type LegacyVirtualCapabilityConnection = {
  id: string;
  ownerId: string;
  pluginId: string;
  displayName: string;
  status: "ready" | "invalid" | "disabled";
  revision: number;
  credentialSlots: Array<{
    slot: "apiKey";
    hint: string;
    status: "active" | "invalid" | "revoked";
    keyVersion: number;
    validatedAt: string | null;
  }>;
  legacy: true;
};

const pluginByProvider: Record<string, string> = {
  mistral: "avermate.mistral",
  transcription: "avermate.mistral",
  gemini: "ai-sdk.google",
  cohere: "avermate.cohere",
  openai: "ai-sdk.openai",
  openrouter: "avermate.openrouter",
  elevenlabs: "ai-sdk.elevenlabs",
};

function virtualId(ownerId: string, kind: string, provider: string) {
  return `legacy_conn_${createHash("sha256")
    .update(`${ownerId}\0${kind}\0${provider}`)
    .digest("hex")}`;
}

/** Read-only projection; legacy ciphertext remains in user_service_keys. */
export async function legacyServiceKeysAsConnections(
  ownerId: string,
  client: SqlClient = db.$client,
): Promise<LegacyVirtualCapabilityConnection[]> {
  const result = await client.execute({
    sql: `SELECT kind, provider, hint, status, keyVersion,
        lastValidatedAt, updatedAt
      FROM user_service_keys WHERE userId = ?
      ORDER BY provider, kind`,
    args: [ownerId],
  });
  return (result.rows as Row[]).flatMap((row) => {
    const provider = String(row.provider || row.kind).toLowerCase();
    const pluginId = pluginByProvider[provider];
    if (!pluginId) return [];
    const status = row.status as "active" | "invalid" | "revoked";
    return [
      {
        id: virtualId(ownerId, String(row.kind), provider),
        ownerId,
        pluginId,
        displayName: `Legacy ${provider} connection`,
        status:
          status === "active"
            ? ("ready" as const)
            : status === "invalid"
              ? ("invalid" as const)
              : ("disabled" as const),
        revision: Number(row.keyVersion),
        credentialSlots: [
          {
            slot: "apiKey" as const,
            hint: String(row.hint),
            status,
            keyVersion: Number(row.keyVersion),
            validatedAt:
              row.lastValidatedAt === null
                ? null
                : capabilityIso(row.lastValidatedAt),
          },
        ],
        legacy: true as const,
      },
    ];
  });
}
