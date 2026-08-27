import type { ProviderConsent } from "@avermate/agent-contracts";
import { db } from "../db";
import { retrievalProviderConsents } from "../db/schema";
import {
  cancelOwnedEmbeddingJobs,
  rotateEmbeddingPublicationFence,
} from "./embedding-publication-fence";
import { COHERE_RERANK_DISCLOSURE_REVISION } from "./rerank-providers";
import { GEMINI_EMBEDDING_DISCLOSURE_REVISION } from "./gemini-embedding";

const disclosures = {
  "gemini:embedding": GEMINI_EMBEDDING_DISCLOSURE_REVISION,
  "cohere:rerank": COHERE_RERANK_DISCLOSURE_REVISION,
} as const;

export type SupportedRetrievalConsent = keyof typeof disclosures;

export function retrievalDisclosure(
  provider: "gemini" | "cohere",
  capability: "embedding" | "rerank",
) {
  const key = `${provider}:${capability}` as SupportedRetrievalConsent;
  const revision = disclosures[key];
  if (!revision) throw new Error("RETRIEVAL_PROVIDER_CAPABILITY_UNSUPPORTED");
  return revision;
}

export async function grantRetrievalProviderConsent(input: {
  userId: string;
  provider: "gemini" | "cohere";
  capability: "embedding" | "rerank";
  disclosureRevision: string;
  policyRevision: string;
}): Promise<ProviderConsent> {
  const expected = retrievalDisclosure(input.provider, input.capability);
  if (input.disclosureRevision !== expected) {
    throw new Error("RETRIEVAL_DISCLOSURE_REVISION_STALE");
  }
  if (!input.policyRevision.trim() || input.policyRevision.length > 256) {
    throw new Error("RETRIEVAL_POLICY_REVISION_INVALID");
  }
  const now = new Date();
  await db
    .insert(retrievalProviderConsents)
    .values({
      userId: input.userId,
      provider: input.provider,
      capability: input.capability,
      disclosureRevision: input.disclosureRevision,
      policyRevision: input.policyRevision,
      grantedAt: now,
      revokedAt: null,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: [
        retrievalProviderConsents.userId,
        retrievalProviderConsents.provider,
        retrievalProviderConsents.capability,
      ],
      set: {
        disclosureRevision: input.disclosureRevision,
        policyRevision: input.policyRevision,
        grantedAt: now,
        revokedAt: null,
        updatedAt: now,
      },
    });
  return {
    provider: input.provider,
    capability: input.capability,
    disclosureRevision: input.disclosureRevision,
    grantedAt: now.toISOString(),
  };
}

export async function revokeRetrievalProviderConsent(input: {
  userId: string;
  provider: "gemini" | "cohere";
  capability: "embedding" | "rerank";
}) {
  const revokedAt = Math.floor(Date.now() / 1_000);
  const transaction = await db.$client.transaction("write");
  try {
    const updated = await transaction.execute({
      sql: `UPDATE retrieval_provider_consents
        SET revokedAt = ?, updatedAt = ?
        WHERE userId = ? AND provider = ? AND capability = ?
          AND revokedAt IS NULL`,
      args: [
        revokedAt,
        revokedAt,
        input.userId,
        input.provider,
        input.capability,
      ],
    });
    let queuedJobsCancelled = 0;
    let runningJobsCancellationRequested = 0;
    let publicationEpoch: number | null = null;
    if (
      Number(updated.rowsAffected) > 0 &&
      input.provider === "gemini" &&
      input.capability === "embedding"
    ) {
      const fence = await rotateEmbeddingPublicationFence(
        input.userId,
        false,
        transaction,
      );
      publicationEpoch = fence.publicationEpoch;
      const cancelled = await cancelOwnedEmbeddingJobs(
        input.userId,
        transaction,
      );
      queuedJobsCancelled = cancelled.queuedJobsCancelled;
      runningJobsCancellationRequested =
        cancelled.runningJobsCancellationRequested;
    }
    await transaction.commit();
    return {
      revoked: Number(updated.rowsAffected) > 0,
      publicationEpoch,
      queuedJobsCancelled,
      runningJobsCancellationRequested,
      requiresExplicitReenable: publicationEpoch !== null,
    };
  } catch (error) {
    await transaction.rollback().catch(() => undefined);
    throw error;
  }
}
