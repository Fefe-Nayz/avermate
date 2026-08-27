import type { Client } from "@libsql/client";

type ReadClient = Pick<Client, "execute">;

export type OwnedEmbeddingGenerationSelection = {
  generationId: string;
  /** Exact immutable versions this collection is allowed to contribute. */
  versionIds: readonly string[];
};

type GenerationMembership = {
  generationId: string;
  versionIds: Set<string>;
  state: "active" | "superseded";
  activatedAt: number;
  updatedAt: number;
};

function generationPreference(
  left: GenerationMembership,
  right: GenerationMembership,
) {
  return (
    Number(right.state === "active") - Number(left.state === "active") ||
    right.activatedAt - left.activatedAt ||
    right.updatedAt - left.updatedAt ||
    right.generationId.localeCompare(left.generationId, "en")
  );
}

/**
 * Select immutable vector generations authorized for one retrieval.
 *
 * Ordinary searches resolve to the single active generation. A version-fenced
 * retry may span several rebuilds: no one generation is required to contain
 * every historical attachment. The selector instead builds a deterministic,
 * minimal-ish set of same-owner/same-space/same-publication-epoch collections
 * and assigns every requested version to exactly one collection.
 *
 * The returned version lists are part of the security boundary. Callers must
 * pass them to the vector backend and reject results for every other version;
 * a historical collection may also contain unrelated source heads.
 */
export async function selectOwnedEmbeddingGenerations(input: {
  client: ReadClient;
  ownerId: string;
  spaceId: string;
  publicationEpoch: number;
  versionIds?: readonly string[];
}): Promise<readonly OwnedEmbeddingGenerationSelection[] | null> {
  const versionIds = [...new Set(input.versionIds ?? [])];
  if (versionIds.length === 0) {
    const active = await input.client.execute({
      sql: `SELECT id FROM corpus_embedding_generations
        WHERE userId = ? AND spaceId = ? AND state = 'active'
          AND publicationEpoch = ?
          AND indexedVersionCount = expectedVersionCount
          AND activatedAt IS NOT NULL
        ORDER BY activatedAt DESC, updatedAt DESC, id DESC
        LIMIT 1`,
      args: [input.ownerId, input.spaceId, input.publicationEpoch],
    });
    return active.rows[0]
      ? [{ generationId: String(active.rows[0].id), versionIds: [] }]
      : null;
  }

  const rows = await input.client.execute({
    sql: `SELECT generations.id AS generationId, members.versionId,
        generations.state, generations.activatedAt, generations.updatedAt
      FROM corpus_embedding_generations AS generations
      JOIN corpus_embedding_generation_versions AS members
        ON members.generationId = generations.id
      JOIN content_versions AS versions ON versions.id = members.versionId
      JOIN content_sources AS sources ON sources.id = versions.sourceId
      WHERE generations.userId = ? AND generations.spaceId = ?
        AND generations.publicationEpoch = ?
        AND generations.state IN ('active', 'superseded')
        AND generations.indexedVersionCount = generations.expectedVersionCount
        AND generations.activatedAt IS NOT NULL
        AND members.indexedAt IS NOT NULL
        AND sources.userId = generations.userId
        AND members.versionId IN (${versionIds.map(() => "?").join(", ")})
      ORDER BY CASE WHEN generations.state = 'active' THEN 0 ELSE 1 END,
        generations.activatedAt DESC, generations.updatedAt DESC,
        generations.id DESC, members.versionId`,
    args: [input.ownerId, input.spaceId, input.publicationEpoch, ...versionIds],
  });

  const byGeneration = new Map<string, GenerationMembership>();
  for (const row of rows.rows) {
    const generationId = String(row.generationId);
    const versionId = String(row.versionId);
    const current = byGeneration.get(generationId) ?? {
      generationId,
      versionIds: new Set<string>(),
      state: row.state === "active" ? "active" : "superseded",
      activatedAt: Number(row.activatedAt),
      updatedAt: Number(row.updatedAt),
    };
    current.versionIds.add(versionId);
    byGeneration.set(generationId, current);
  }

  const availableVersions = new Set(
    [...byGeneration.values()].flatMap((generation) => [
      ...generation.versionIds,
    ]),
  );
  if (versionIds.some((versionId) => !availableVersions.has(versionId))) {
    return null;
  }

  const remaining = new Set(versionIds);
  const generations = [...byGeneration.values()];
  const selected: OwnedEmbeddingGenerationSelection[] = [];
  while (remaining.size > 0) {
    const candidates = generations
      .map((generation) => ({
        generation,
        coverage: [...generation.versionIds].filter((versionId) =>
          remaining.has(versionId),
        ),
      }))
      .filter((candidate) => candidate.coverage.length > 0)
      .sort(
        (left, right) =>
          right.coverage.length - left.coverage.length ||
          generationPreference(left.generation, right.generation),
      );
    const winner = candidates[0];
    if (!winner) return null;

    // Preserve the caller's immutable-version order rather than SQLite row
    // order so collection reads and their traces remain reproducible.
    const assigned = versionIds.filter(
      (versionId) =>
        remaining.has(versionId) && winner.generation.versionIds.has(versionId),
    );
    for (const versionId of assigned) remaining.delete(versionId);
    selected.push({
      generationId: winner.generation.generationId,
      versionIds: assigned,
    });
  }

  return selected;
}

/** Compatibility helper for call sites that genuinely require one collection. */
export async function selectOwnedEmbeddingGeneration(input: {
  client: ReadClient;
  ownerId: string;
  spaceId: string;
  publicationEpoch: number;
  versionIds?: readonly string[];
}) {
  const selected = await selectOwnedEmbeddingGenerations(input);
  return selected?.length === 1 ? selected[0]!.generationId : null;
}
