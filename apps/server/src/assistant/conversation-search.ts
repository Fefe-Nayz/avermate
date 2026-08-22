import type { Client } from "@libsql/client";
import type {
  LexicalSearchMode,
  OwnedLexicalQuery,
} from "@avermate/agent-contracts";
import { db } from "../db";
import { newId } from "../lib/id";
import { CoreCorpusStore } from "../search/core-corpus-store";
import {
  hybridCorpusSearch,
  type HybridSearchResult,
} from "../search/hybrid";
import { lexicalCursor } from "../search/lexical";

type SqlClient = Pick<Client, "execute" | "batch" | "transaction">;
type SearchCorpus = Pick<CoreCorpusStore, "createReference">;

export type ConversationSearchInput = {
  ownerId: string;
  query: string;
  mode: LexicalSearchMode;
  limit: number;
  cursor: string | null;
};

function cursorOffset(cursor: string | null) {
  if (!cursor) return 0;
  try {
    const parsed = JSON.parse(
      Buffer.from(cursor, "base64url").toString("utf8"),
    ) as { offset?: unknown };
    const offset = Number(parsed.offset);
    return Number.isSafeInteger(offset) && offset >= 0 ? offset : 0;
  } catch {
    return 0;
  }
}

/**
 * Searches only the current immutable versions of owned conversation text.
 * Deleted threads stay out of model context even during their recovery window;
 * tool payloads never enter the corpus in the first place.
 */
export class ConversationSearchService {
  constructor(
    private readonly client: SqlClient = db.$client,
    private readonly corpus: SearchCorpus = new CoreCorpusStore(client),
    private readonly search: (
      input: OwnedLexicalQuery,
    ) => Promise<HybridSearchResult> = (input) =>
      hybridCorpusSearch(input, { client, runtime: null }),
  ) {}

  async run(input: ConversationSearchInput) {
    const limit = Math.min(Math.max(input.limit, 1), 20);
    const result = await this.search({
      ownerId: input.ownerId,
      query: input.query,
      mode: input.mode,
      projectIds: [],
      yearIds: [],
      subjectIds: [],
      originKinds: ["conversation"],
      limit,
      cursor: input.cursor,
    });
    const threadIds = [
      ...new Set(
        result.candidates.flatMap((candidate) =>
          candidate.locator.kind === "conversation"
            ? [candidate.locator.threadId]
            : [],
        ),
      ),
    ];
    const liveThreads = new Map<string, string>();
    if (threadIds.length > 0) {
      const rows = await this.client.execute({
        sql: `SELECT id, title FROM assistant_threads
          WHERE userId = ? AND deletedAt IS NULL
            AND id IN (${threadIds.map(() => "?").join(",")})`,
        args: [input.ownerId, ...threadIds],
      });
      for (const row of rows.rows) {
        liveThreads.set(String(row.id), String(row.title));
      }
    }

    const searchId = newId("csearch");
    const evidence = [];
    for (const candidate of result.candidates) {
      if (candidate.locator.kind !== "conversation") continue;
      const title = liveThreads.get(candidate.locator.threadId);
      if (!title) continue;
      const reference = await this.corpus.createReference({
        ownerId: input.ownerId,
        ownerKind: "assistant-citation",
        ownerIdWithinKind: searchId,
        sourceVersionId: candidate.versionId,
        chunkId: candidate.chunkId,
        locator: candidate.locator,
        quotedContentHash: candidate.contentHash,
      });
      evidence.push({
        ...candidate,
        citationId: reference.id,
        threadTitle: title,
      });
    }

    return {
      searchId,
      evidence,
      nextCursor:
        result.candidates.length === limit
          ? lexicalCursor(cursorOffset(input.cursor) + result.candidates.length)
          : null,
      retrievalMode: result.vectorUsed
        ? ("hybrid" as const)
        : ("lexical" as const),
      vectorImplementation: result.vectorImplementation,
    };
  }
}

export const coreConversationSearchService = new ConversationSearchService();
