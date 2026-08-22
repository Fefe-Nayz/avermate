import { z } from "zod";
import type { EntitlementSqlClient } from "../entitlements/service";
import { SecurityAuditWriter } from "../observability/audit";

export const managedModelPolicyInputSchema = z.strictObject({
  provider: z.string().trim().min(1).max(128),
  model: z.string().trim().min(1).max(256),
  revision: z.string().trim().min(1).max(128),
  enabled: z.boolean(),
  modalities: z
    .array(z.enum(["text", "image", "audio", "video", "embedding"]))
    .min(1)
    .max(5),
  contextTokens: z.string().regex(/^[1-9]\d*$/u),
  supportsTools: z.boolean(),
  supportsStructuredOutput: z.boolean(),
  regions: z.array(z.string().trim().min(1).max(64)).min(1).max(32),
  retentionPolicy: z.string().trim().min(1).max(256),
  zeroRetention: z.boolean(),
  trainingOptInRequired: z.boolean(),
  pricingSnapshotId: z.string().trim().min(1).max(256).optional(),
});

export async function publishManagedModelPolicy(input: {
  client: EntitlementSqlClient;
  policy: z.infer<typeof managedModelPolicyInputSchema>;
  actorId: string;
  justification: string;
  correlationId: string;
  clock?: () => Date;
}) {
  const policy = managedModelPolicyInputSchema.parse(input.policy);
  const normalized = {
    ...policy,
    modalities: [...new Set(policy.modalities)].sort(),
    regions: [...new Set(policy.regions)].sort(),
  };
  const now = input.clock?.() ?? new Date();
  const transaction = await input.client.transaction("write");
  try {
    const inserted = await transaction.execute({
      sql: `INSERT INTO managed_model_catalogue
        (provider, model, revision, enabled, modalitiesJson, contextTokens,
         supportsTools, supportsStructuredOutput, regionsJson,
         retentionPolicy, zeroRetention, trainingOptInRequired,
         pricingSnapshotId, updatedAt)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(provider, model, revision) DO NOTHING`,
      args: [
        normalized.provider,
        normalized.model,
        normalized.revision,
        normalized.enabled ? 1 : 0,
        JSON.stringify(normalized.modalities),
        normalized.contextTokens,
        normalized.supportsTools ? 1 : 0,
        normalized.supportsStructuredOutput ? 1 : 0,
        JSON.stringify(normalized.regions),
        normalized.retentionPolicy,
        normalized.zeroRetention ? 1 : 0,
        normalized.trainingOptInRequired ? 1 : 0,
        normalized.pricingSnapshotId ?? null,
        Math.floor(now.getTime() / 1_000),
      ],
    });
    const rows = await transaction.execute({
      sql: `SELECT * FROM managed_model_catalogue
        WHERE provider = ? AND model = ? AND revision = ? LIMIT 1`,
      args: [normalized.provider, normalized.model, normalized.revision],
    });
    const row = rows.rows[0];
    const matches =
      row &&
      Number(row.enabled) === Number(normalized.enabled) &&
      String(row.modalitiesJson) === JSON.stringify(normalized.modalities) &&
      String(row.contextTokens) === normalized.contextTokens &&
      Number(row.supportsTools) === Number(normalized.supportsTools) &&
      Number(row.supportsStructuredOutput) ===
        Number(normalized.supportsStructuredOutput) &&
      String(row.regionsJson) === JSON.stringify(normalized.regions) &&
      String(row.retentionPolicy) === normalized.retentionPolicy &&
      Number(row.zeroRetention) === Number(normalized.zeroRetention) &&
      Number(row.trainingOptInRequired) ===
        Number(normalized.trainingOptInRequired) &&
      String(row.pricingSnapshotId ?? "") ===
        (normalized.pricingSnapshotId ?? "");
    if (!matches) throw new Error("MANAGED_MODEL_REVISION_CONFLICT");
    if (Number(inserted.rowsAffected) > 0) {
      await new SecurityAuditWriter(input.client, () => now).append(
        {
          accountId: null,
          actorId: input.actorId,
          actorKind: "admin",
          action: "managed.model-policy-published",
          resourceKind: "managed-model-policy",
          resourceId: `${normalized.provider}:${normalized.model}:${normalized.revision}`,
          justification: input.justification,
          correlationId: input.correlationId,
          policyVersion: "managed-model-policy/1",
          metadata: normalized,
        },
        transaction,
      );
    }
    await transaction.commit();
    return { policy: normalized, replayed: Number(inserted.rowsAffected) === 0 };
  } catch (error) {
    await transaction.rollback();
    throw error;
  }
}
