import type {
  LexicalCandidate,
  LexicalSearchBackend,
  LexicalVersionInput,
  StagedContentChunk,
} from "@avermate/agent-contracts";
import {
  contentSourceRecordSchema,
  contentVersionRecordSchema,
  lexicalCandidateSchema,
  ownedLexicalQuerySchema,
  stagedContentChunkSchema,
} from "@avermate/agent-contracts";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

type IndexedVersion = {
  ownerId: string;
  source: LexicalVersionInput["source"];
  version: LexicalVersionInput["version"];
  chunks: StagedContentChunk[];
};

type LexicalFile = {
  version: 1;
  versions: Record<string, IndexedVersion>;
};

function normalize(value: string) {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase("fr")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

function terms(value: string) {
  return normalize(value).split(/\s+/u).filter(Boolean);
}

function scoreChunk(
  chunk: StagedContentChunk,
  query: string,
  mode: "terms" | "phrase" | "prefix" | "exact",
) {
  const haystack = normalize(chunk.normalizedText || chunk.text);
  const needle = normalize(query);
  if (!needle) return null;
  if (mode === "exact") return haystack === needle ? 1_000 : null;
  if (mode === "phrase") {
    const index = haystack.indexOf(needle);
    return index === -1 ? null : 500 + needle.length / (1 + index);
  }
  const queryTerms = terms(needle);
  const haystackTerms = terms(haystack);
  if (mode === "prefix") {
    const matches = queryTerms.filter((term) =>
      haystackTerms.some((candidate) => candidate.startsWith(term)),
    ).length;
    return matches === queryTerms.length ? 100 + matches : null;
  }
  const frequency = new Map<string, number>();
  for (const term of haystackTerms) {
    frequency.set(term, (frequency.get(term) ?? 0) + 1);
  }
  const matches = queryTerms.reduce(
    (total, term) => total + (frequency.get(term) ?? 0),
    0,
  );
  return queryTerms.every((term) => frequency.has(term))
    ? matches + queryTerms.length / Math.max(1, haystackTerms.length)
    : null;
}

function projectIds(version: IndexedVersion["version"]) {
  const value = version.metadata.projectIds;
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string")
    : [];
}

async function atomicWrite(path: string, state: LexicalFile) {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.${crypto.randomUUID()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(state)}\n`, {
    mode: 0o600,
    flag: "wx",
  });
  await rename(temporary, path);
}

/** A bounded, restart-safe lexical backend used by Node profiles. */
export class FilesystemLexicalSearchBackend implements LexicalSearchBackend {
  readonly #path: string;
  readonly #ownerId: string;
  readonly #maximumBytes: number;
  #state: LexicalFile | null = null;
  #mutex: Promise<void> = Promise.resolve();

  constructor(input: { path: string; ownerId: string; maximumBytes: number }) {
    if (!input.ownerId) throw new Error("NODE_LEXICAL_OWNER_REQUIRED");
    this.#path = input.path;
    this.#ownerId = input.ownerId;
    this.#maximumBytes = input.maximumBytes;
  }

  async initialize() {
    await this.#load();
  }

  async capabilities() {
    return {
      available: true,
      implementation: "avermate-node-json-lexical-v1",
      modes: ["terms", "phrase", "prefix", "exact"] as const,
    };
  }

  async upsertVersion(input: LexicalVersionInput) {
    const source = contentSourceRecordSchema.parse(input.source);
    const version = contentVersionRecordSchema.parse(input.version);
    const chunks = input.chunks.map((chunk) =>
      stagedContentChunkSchema.parse(chunk),
    );
    if (
      input.ownerId !== this.#ownerId ||
      source.ownerId !== this.#ownerId ||
      version.sourceId !== source.id
    ) {
      throw new Error("NODE_LEXICAL_OWNER_OR_SOURCE_MISMATCH");
    }
    const ordinals = new Set(chunks.map((chunk) => chunk.ordinal));
    if (ordinals.size !== chunks.length) {
      throw new Error("NODE_LEXICAL_DUPLICATE_ORDINAL");
    }
    await this.#exclusive((state) => {
      const previous = state.versions[version.id];
      if (previous && previous.ownerId !== this.#ownerId) {
        throw new Error("NODE_LEXICAL_VERSION_COLLISION");
      }
      state.versions[version.id] = {
        ownerId: this.#ownerId,
        source,
        version,
        chunks,
      };
    });
  }

  async removeVersion(versionId: string) {
    if (!versionId || versionId.length > 256) {
      throw new Error("NODE_LEXICAL_VERSION_ID_INVALID");
    }
    await this.#exclusive((state) => {
      const version = state.versions[versionId];
      if (version?.ownerId === this.#ownerId) delete state.versions[versionId];
    });
  }

  async search(input: Parameters<LexicalSearchBackend["search"]>[0]) {
    const query = ownedLexicalQuerySchema.parse(input);
    if (query.ownerId !== this.#ownerId) {
      throw new Error("NODE_LEXICAL_OWNER_MISMATCH");
    }
    const state = await this.#load();
    const candidates: LexicalCandidate[] = [];
    for (const indexed of Object.values(state.versions)) {
      if (indexed.ownerId !== this.#ownerId) continue;
      if (
        query.yearIds.length > 0 &&
        (!indexed.source.yearId || !query.yearIds.includes(indexed.source.yearId))
      ) {
        continue;
      }
      if (
        query.subjectIds.length > 0 &&
        (!indexed.source.subjectId ||
          !query.subjectIds.includes(indexed.source.subjectId))
      ) {
        continue;
      }
      if (
        query.originKinds.length > 0 &&
        !query.originKinds.includes(indexed.source.originKind)
      ) {
        continue;
      }
      if (
        query.projectIds.length > 0 &&
        !projectIds(indexed.version).some((id) => query.projectIds.includes(id))
      ) {
        continue;
      }
      for (const chunk of indexed.chunks) {
        const score = scoreChunk(chunk, query.query, query.mode);
        if (score === null) continue;
        candidates.push(
          lexicalCandidateSchema.parse({
            sourceId: indexed.source.id,
            versionId: indexed.version.id,
            chunkId: chunk.chunkId ?? `${indexed.version.id}:${chunk.ordinal}`,
            ordinal: chunk.ordinal,
            score,
            snippet: chunk.text.slice(0, 16_384),
            locator: chunk.locator,
            contentHash: chunk.contentHash,
            evidenceKind: chunk.evidenceKind,
          }),
        );
      }
    }
    return candidates
      .sort(
        (left, right) =>
          right.score - left.score ||
          left.versionId.localeCompare(right.versionId) ||
          left.ordinal - right.ordinal,
      )
      .slice(0, query.limit);
  }

  async getChunks(ownerId: string, rawChunkIds: readonly string[]) {
    if (ownerId !== this.#ownerId) {
      throw new Error("NODE_LEXICAL_OWNER_MISMATCH");
    }
    const chunkIds = [...new Set(rawChunkIds)];
    if (
      chunkIds.length === 0 ||
      chunkIds.length > 64 ||
      chunkIds.some((id) => !id || id.length > 256)
    ) {
      throw new Error("NODE_LEXICAL_CHUNK_REQUEST_INVALID");
    }
    const state = await this.#load();
    const byId = new Map<string, StagedContentChunk>();
    for (const indexed of Object.values(state.versions)) {
      if (indexed.ownerId !== ownerId) continue;
      for (const chunk of indexed.chunks) {
        if (chunk.chunkId && chunkIds.includes(chunk.chunkId)) {
          byId.set(chunk.chunkId, chunk);
        }
      }
    }
    if (byId.size !== chunkIds.length) {
      throw new Error("NODE_LEXICAL_CHUNK_NOT_FOUND");
    }
    return chunkIds.map((id) => structuredClone(byId.get(id)!));
  }

  async verify() {
    const state = await this.#load();
    const missingVersionIds: string[] = [];
    const orphanedVersionIds: string[] = [];
    for (const [versionId, indexed] of Object.entries(state.versions)) {
      if (indexed.version.id !== versionId) orphanedVersionIds.push(versionId);
      if (indexed.version.sourceId !== indexed.source.id) {
        missingVersionIds.push(versionId);
      }
    }
    return {
      consistent:
        missingVersionIds.length === 0 && orphanedVersionIds.length === 0,
      indexedVersions: Object.keys(state.versions).length,
      missingVersionIds,
      orphanedVersionIds,
    };
  }

  async exportOwner(ownerId: string): Promise<LexicalVersionInput[]> {
    if (ownerId !== this.#ownerId) {
      throw new Error("NODE_LEXICAL_OWNER_MISMATCH");
    }
    const state = await this.#load();
    return Object.values(state.versions)
      .filter((entry) => entry.ownerId === ownerId)
      .sort((left, right) => left.version.id.localeCompare(right.version.id))
      .map((entry) =>
        structuredClone({
          ownerId,
          source: entry.source,
          version: entry.version,
          chunks: entry.chunks,
        }),
      );
  }

  async deleteOwner(ownerId: string) {
    if (ownerId !== this.#ownerId) {
      throw new Error("NODE_LEXICAL_OWNER_MISMATCH");
    }
    let deletedVersions = 0;
    await this.#exclusive((state) => {
      for (const [versionId, entry] of Object.entries(state.versions)) {
        if (entry.ownerId !== ownerId) continue;
        delete state.versions[versionId];
        deletedVersions += 1;
      }
    });
    return { deletedVersions };
  }

  async #load() {
    if (this.#state) return this.#state;
    try {
      const state = JSON.parse(await readFile(this.#path, "utf8")) as LexicalFile;
      if (state.version !== 1 || !state.versions) {
        throw new Error("NODE_LEXICAL_STORE_VERSION_UNSUPPORTED");
      }
      this.#state = state;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      this.#state = { version: 1, versions: {} };
    }
    return this.#state;
  }

  async #exclusive<T>(operation: (state: LexicalFile) => T | Promise<T>) {
    const previous = this.#mutex;
    let release!: () => void;
    this.#mutex = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    try {
      const state = await this.#load();
      const result = await operation(state);
      const bytes = new TextEncoder().encode(JSON.stringify(state)).byteLength;
      if (bytes > this.#maximumBytes) {
        this.#state = null;
        throw new Error("NODE_LEXICAL_QUOTA_EXCEEDED");
      }
      await atomicWrite(this.#path, state);
      return result;
    } finally {
      release();
    }
  }
}
