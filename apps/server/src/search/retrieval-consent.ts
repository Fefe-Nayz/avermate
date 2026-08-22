import { and, eq } from "drizzle-orm";
import type { ProviderConsent } from "@avermate/agent-contracts";
import { db } from "../db";
import { retrievalProviderConsents } from "../db/schema";
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
  const revokedAt = new Date();
  const rows = await db
    .update(retrievalProviderConsents)
    .set({ revokedAt, updatedAt: revokedAt })
    .where(
      and(
        eq(retrievalProviderConsents.userId, input.userId),
        eq(retrievalProviderConsents.provider, input.provider),
        eq(retrievalProviderConsents.capability, input.capability),
      ),
    )
    .returning({ id: retrievalProviderConsents.id });
  return { revoked: rows.length > 0 };
}
