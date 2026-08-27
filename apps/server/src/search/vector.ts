import type {
  IndexedVector,
  VectorCandidate,
  VectorCapabilities,
  VectorIndex,
  VectorQuery,
} from "@avermate/agent-contracts";

export class LexicalOnlyVectorIndex implements VectorIndex {
  async capabilities(): Promise<VectorCapabilities> {
    return { available: false, implementation: "lexical-only", dimensions: [] };
  }
  async upsert(_batch: readonly IndexedVector[]) {}
  async remove(_versionIds: readonly string[]) {}
  async search(_query: VectorQuery): Promise<VectorCandidate[]> {
    return [];
  }
}

function cosine(left: readonly number[], right: readonly number[]) {
  let dot = 0;
  let leftNorm = 0;
  let rightNorm = 0;
  for (let index = 0; index < left.length; index += 1) {
    const a = left[index]!;
    const b = right[index]!;
    dot += a * b;
    leftNorm += a * a;
    rightNorm += b * b;
  }
  return leftNorm > 0 && rightNorm > 0
    ? dot / (Math.sqrt(leftNorm) * Math.sqrt(rightNorm))
    : 0;
}

/** Explicit opt-in test/local adapter. Nothing selects it merely because no key exists. */
export class InMemoryVectorIndex implements VectorIndex {
  private readonly values = new Map<string, IndexedVector>();
  private readonly supportedDimensions: ReadonlySet<number>;

  constructor(private readonly dimensions: readonly number[]) {
    this.supportedDimensions = new Set(dimensions);
  }

  async capabilities(): Promise<VectorCapabilities> {
    return {
      available: this.dimensions.length > 0,
      implementation: "in-memory-cosine-v1",
      dimensions: [...this.dimensions],
    };
  }

  async upsert(batch: readonly IndexedVector[]) {
    for (const vector of batch) {
      if (!this.supportedDimensions.has(vector.values.length)) {
        throw new Error(`Unsupported vector dimension ${vector.values.length}`);
      }
      if (vector.values.some((value) => !Number.isFinite(value))) {
        throw new Error("Embedding vectors must contain only finite numbers");
      }
      this.values.set(
        `${vector.ownerId}:${vector.spaceId}:${vector.chunkId}`,
        structuredClone(vector),
      );
    }
  }

  async remove(versionIds: readonly string[]) {
    const selected = new Set(versionIds);
    for (const [key, value] of this.values) {
      if (selected.has(value.versionId)) this.values.delete(key);
    }
  }

  async search(query: VectorQuery): Promise<VectorCandidate[]> {
    if (!this.supportedDimensions.has(query.values.length)) return [];
    const versionIds =
      query.versionIds && query.versionIds.length > 0
        ? new Set(query.versionIds)
        : null;
    return [...this.values.values()]
      .filter(
        (entry) =>
          entry.ownerId === query.ownerId &&
          entry.spaceId === query.spaceId &&
          (!versionIds || versionIds.has(entry.versionId)),
      )
      .map((entry) => ({
        sourceId: entry.sourceId,
        versionId: entry.versionId,
        chunkId: entry.chunkId,
        score: cosine(query.values, entry.values),
      }))
      .sort(
        (left, right) =>
          right.score - left.score || left.chunkId.localeCompare(right.chunkId),
      )
      .slice(0, Math.max(0, Math.min(100, query.limit)));
  }
}

export type RankedCandidate = {
  sourceId: string;
  versionId: string;
  chunkId: string;
  score: number;
  channels: readonly ("lexical" | "vector")[];
};

/** Deterministic reciprocal-rank fusion with stable id tie-breaking. */
export function reciprocalRankFusion(input: {
  lexical: readonly { sourceId: string; versionId: string; chunkId: string }[];
  vector: readonly { sourceId: string; versionId: string; chunkId: string }[];
  lexicalWeight?: number;
  vectorWeight?: number;
  k?: number;
}): RankedCandidate[] {
  const scores = new Map<
    string,
    RankedCandidate & { mutableChannels: Set<"lexical" | "vector"> }
  >();
  const add = (
    channel: "lexical" | "vector",
    entries: typeof input.lexical,
    weight: number,
  ) => {
    entries.forEach((entry, rank) => {
      const key = `${entry.sourceId}:${entry.versionId}:${entry.chunkId}`;
      const current = scores.get(key) ?? {
        ...entry,
        score: 0,
        channels: [],
        mutableChannels: new Set(),
      };
      current.score += weight / ((input.k ?? 60) + rank + 1);
      current.mutableChannels.add(channel);
      scores.set(key, current);
    });
  };
  add("lexical", input.lexical, input.lexicalWeight ?? 1);
  add("vector", input.vector, input.vectorWeight ?? 1);
  return [...scores.values()]
    .map(({ mutableChannels, ...entry }) => ({
      ...entry,
      channels: [...mutableChannels].sort(),
    }))
    .sort(
      (left, right) =>
        right.score - left.score || left.chunkId.localeCompare(right.chunkId),
    );
}
