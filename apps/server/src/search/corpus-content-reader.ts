import type { NodeLexicalSearchTransport } from "@avermate/agent-contracts";
import type { Client, InValue } from "@libsql/client";
import { createHash } from "node:crypto";
import { db } from "../db";
import { relayNodeProviderTransport } from "../node/services";
import { isNodeCorpusEnvelope } from "./node-corpus-envelope";
import { jsonValue } from "./values";

type SqlClient = Pick<Client, "execute">;

export type AuthorizedCorpusChunkRow = Record<string, InValue> & {
  chunkId?: InValue;
  id?: InValue;
  userId: InValue;
  placement: InValue;
  placementRef: InValue;
  text: InValue;
  normalizedText: InValue;
  contentHash: InValue;
  headingPathJson: InValue;
};

export type CorpusChunkBody = {
  chunkId: string;
  text: string;
  normalizedText: string;
  headingPath: string[] | null;
  contentHash: string;
};

function coreBody(row: AuthorizedCorpusChunkRow): CorpusChunkBody {
  if (isNodeCorpusEnvelope(String(row.text))) {
    throw new Error("CORE_CORPUS_ENVELOPE_PLACEMENT_MISMATCH");
  }
  const heading =
    row.headingPathJson === null ? null : jsonValue(row.headingPathJson);
  if (
    heading !== null &&
    (!Array.isArray(heading) ||
      !heading.every((entry) => typeof entry === "string"))
  ) {
    throw new Error("CORPUS_CHUNK_HEADING_INVALID");
  }
  return {
    chunkId: String(row.chunkId ?? row.id),
    text: String(row.text),
    normalizedText: String(row.normalizedText),
    headingPath: heading,
    contentHash: String(row.contentHash),
  };
}

/**
 * Reads Core bodies locally and Node bodies only through the authenticated
 * relay. The encrypted Core envelope is intentionally not an offline fallback.
 */
export class RoutedCorpusContentReader {
  constructor(
    private readonly client: SqlClient = db.$client,
    private readonly transport: NodeLexicalSearchTransport =
      relayNodeProviderTransport,
  ) {}

  async hydrate(rows: readonly AuthorizedCorpusChunkRow[]) {
    const bodies = new Map<string, CorpusChunkBody>();
    const groups = new Map<
      string,
      { ownerId: string; nodeId: string; rows: AuthorizedCorpusChunkRow[] }
    >();
    for (const row of rows) {
      const chunkId = String(row.chunkId ?? row.id);
      if (!chunkId) throw new Error("CORPUS_CHUNK_ID_REQUIRED");
      if (row.placement !== "node") {
        bodies.set(chunkId, coreBody(row));
        continue;
      }
      if (row.placementRef === null) {
        throw new Error("NODE_RETRIEVAL_PLACEMENT_INVALID");
      }
      const ownerId = String(row.userId);
      const nodeId = String(row.placementRef);
      const key = `${ownerId}\0${nodeId}`;
      const group = groups.get(key) ?? { ownerId, nodeId, rows: [] };
      group.rows.push(row);
      groups.set(key, group);
    }

    for (const group of groups.values()) {
      if (!(await this.transport.online(group.nodeId))) {
        throw new Error("NODE_RETRIEVAL_CAPABILITY_OFFLINE");
      }
      for (let offset = 0; offset < group.rows.length; offset += 64) {
        const batch = group.rows.slice(offset, offset + 64);
        const expected = new Map(
          batch.map((row) => [
            String(row.chunkId ?? row.id),
            String(row.contentHash),
          ]),
        );
        const chunks = await this.transport.getLexicalChunks({
          nodeId: group.nodeId,
          ownerId: group.ownerId,
          chunkIds: [...expected.keys()],
        });
        const returned = new Set<string>();
        for (const chunk of chunks) {
          const chunkId = chunk.chunkId;
          if (
            !chunkId ||
            returned.has(chunkId) ||
            expected.get(chunkId) !== chunk.contentHash ||
            createHash("sha256").update(chunk.text).digest("hex") !==
              chunk.contentHash
          ) {
            throw new Error("NODE_RETRIEVAL_CHUNK_IDENTITY_MISMATCH");
          }
          returned.add(chunkId);
          bodies.set(chunkId, {
            chunkId,
            text: chunk.text,
            normalizedText: chunk.normalizedText,
            headingPath: chunk.headingPath,
            contentHash: chunk.contentHash,
          });
        }
        if (
          returned.size !== expected.size ||
          [...expected.keys()].some((chunkId) => !returned.has(chunkId))
        ) {
          throw new Error("NODE_RETRIEVAL_CHUNK_RESULT_INCOMPLETE");
        }
      }
    }
    return bodies;
  }

  async readOwnedChunk(ownerId: string, chunkId: string) {
    const result = await this.client.execute({
      sql: `SELECT chunks.id AS chunkId, chunks.text, chunks.normalizedText,
          chunks.contentHash, chunks.headingPathJson, sources.userId,
          sources.placement, sources.placementRef
        FROM content_chunks AS chunks
        JOIN content_versions AS versions ON versions.id = chunks.versionId
        JOIN content_sources AS sources ON sources.id = versions.sourceId
        WHERE chunks.id = ? AND sources.userId = ? LIMIT 1`,
      args: [chunkId, ownerId],
    });
    const row = result.rows[0] as unknown as
      | AuthorizedCorpusChunkRow
      | undefined;
    if (!row) return null;
    return (await this.hydrate([row])).get(chunkId) ?? null;
  }
}

export const routedCorpusContentReader = new RoutedCorpusContentReader();
