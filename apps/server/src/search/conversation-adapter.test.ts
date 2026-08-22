import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { Client } from "@libsql/client";
import { ConversationSearchService } from "../assistant/conversation-search";
import { CoreConversationStore } from "../assistant/core-conversation-store";
import { CoreCitationResolver } from "./citations";
import { CorpusIndexService } from "./index-service";
import { createCorpusTestDatabase } from "./test-helpers";

const ownerId = "corpus-user-a";
const otherOwnerId = "corpus-user-b";

let client: Client;
let conversations: CoreConversationStore;
let corpus: CorpusIndexService;
// Applying the complete migration history through 0060 and releasing its
// relational fixtures can take about 90s on slower Windows/libSQL runners.
const databaseHookTimeout = 120_000;

beforeAll(async () => {
  client = await createCorpusTestDatabase();
  conversations = new CoreConversationStore(client);
  corpus = new CorpusIndexService(client);
}, databaseHookTimeout);

afterAll(() => client.close(), databaseHookTimeout);

function usage() {
  return {
    providerKey: "mock",
    modelKey: "mock-readonly",
    inputTokens: 4,
    outputTokens: 8,
    reasoningTokens: null,
    cachedReadTokens: null,
    cachedWriteTokens: null,
    estimatedCost: "0",
    currency: "EUR",
  };
}

async function completedConversation(searchTerm: string) {
  const created = await conversations.createThread({
    ownerId,
    title: "Méthodes de révision",
  });
  const reservation = await conversations.reserveTurn({
    ownerId,
    threadId: created.thread.id,
    branchId: created.branch.id,
    expectedHeadMessageId: null,
    clientRequestId: "conversation-index-fixture",
    markdown: `Comment retenir la méthode ${searchTerm} ?`,
    modelKey: "mock-readonly",
  });
  await conversations.startRun(ownerId, reservation.runId);
  const finalized = await conversations.finalizeRun({
    ownerId,
    runId: reservation.runId,
    expectedInputHeadId: reservation.userMessageId,
    outputMessageId: reservation.reservedOutputMessageId,
    finalParts: [
      {
        type: "text",
        id: "answer-text",
        markdown: `Utilise une répétition espacée pour ${searchTerm}.`,
      },
      {
        type: "tool",
        id: "private-tool-part",
        toolCallId: "private-tool-call",
        toolId: "fixture.private",
        state: "complete",
        safeResult: { payload: "outil-interne-non-indexable" },
      },
    ],
    citations: [],
    usage: usage(),
    terminal: "complete",
    siblingPolicy: "create-explicit-sibling-on-head-conflict",
  });
  return { ...created, reservation, finalized };
}

describe("ConversationSourceAdapter", () => {
  test("indexes only completed user/model text with exact message-part locators", async () => {
    const searchTerm = "orbitalalpha";
    const fixture = await completedConversation(searchTerm);
    const identity = {
      ownerId,
      originKind: "conversation" as const,
      originId: fixture.thread.id,
    };

    const committed = await corpus.indexSource(identity);
    const chunks = await client.execute({
      sql: `SELECT text, locatorJson FROM content_chunks
        WHERE versionId = ? ORDER BY ordinal`,
      args: [committed.versionId],
    });

    expect(chunks.rows).toHaveLength(2);
    expect(new Set(chunks.rows.map((row) => String(row.text)))).toEqual(
      new Set([
        `Comment retenir la méthode ${searchTerm} ?`,
        `Utilise une répétition espacée pour ${searchTerm}.`,
      ]),
    );
    expect(JSON.stringify(chunks.rows)).not.toContain(
      "outil-interne-non-indexable",
    );

    const located = new Map(
      chunks.rows.map((row) => [
        String(row.text),
        JSON.parse(String(row.locatorJson)),
      ]),
    );
    const userLocator = located.get(
      `Comment retenir la méthode ${searchTerm} ?`,
    );
    expect(userLocator).toMatchObject({
      kind: "conversation",
      threadId: fixture.thread.id,
      messageId: fixture.reservation.userMessageId,
      startOffset: 0,
      endOffset: `Comment retenir la méthode ${searchTerm} ?`.length,
    });
    expect(userLocator?.partId).toBeString();
    expect(
      located.get(`Utilise une répétition espacée pour ${searchTerm}.`),
    ).toEqual(
      {
        kind: "conversation",
        threadId: fixture.thread.id,
        messageId: fixture.finalized.output.id,
        partId: "answer-text",
        startOffset: 0,
        endOffset: `Utilise une répétition espacée pour ${searchTerm}.`.length,
      },
    );

    const threadMatches = await conversations.listThreads({
      ownerId,
      query: searchTerm,
    });
    expect(threadMatches.items).toHaveLength(1);
    expect(threadMatches.items[0]?.matchedMessagePreview).toContain(searchTerm);
    expect(
      (
        await conversations.listThreads({
          ownerId,
          query: "outil-interne-non-indexable",
        })
      ).items,
    ).toEqual([]);
  });

  test("searches owned conversation text, round-trips citations and hides it after purge", async () => {
    const searchTerm = "orbitalbeta";
    const fixture = await completedConversation(searchTerm);
    const identity = {
      ownerId,
      originKind: "conversation" as const,
      originId: fixture.thread.id,
    };
    await corpus.indexSource(identity);
    const search = new ConversationSearchService(client, corpus.store);
    const query = {
      query: searchTerm,
      mode: "terms" as const,
      limit: 10,
      cursor: null,
    };

    const owned = await search.run({ ownerId, ...query });
    expect(owned.evidence).toHaveLength(2);
    const userEvidence = owned.evidence.find(
      (candidate) =>
        candidate.locator.kind === "conversation" &&
        candidate.locator.messageId === fixture.reservation.userMessageId,
    );
    expect(userEvidence?.locator).toMatchObject({
      kind: "conversation",
      threadId: fixture.thread.id,
      messageId: fixture.reservation.userMessageId,
    });
    expect(
      (await search.run({ ownerId: otherOwnerId, ...query })).evidence,
    ).toEqual([]);

    const referenceId = userEvidence!.citationId;
    const opened = await new CoreCitationResolver(client).readChunk({
      ownerId,
      referenceId,
    });
    expect(opened.text).toBe(`Comment retenir la méthode ${searchTerm} ?`);
    expect(opened.citation.locator).toEqual(userEvidence!.locator);

    const currentThread = await conversations.thread(ownerId, fixture.thread.id);
    const trashed = await conversations.trashThread({
      ownerId,
      threadId: fixture.thread.id,
      expectedRevision: currentThread.revision,
      retentionDays: 0,
    });
    expect(trashed.deletedAt).not.toBeNull();
    await client.execute({
      sql: `UPDATE assistant_threads SET purgeAfter = ?
        WHERE id = ? AND userId = ?`,
      args: [Math.floor(Date.now() / 1_000) - 1, fixture.thread.id, ownerId],
    });
    expect(await conversations.purgeExpired(ownerId)).toContain(
      fixture.thread.id,
    );
    expect((await search.run({ ownerId, ...query })).evidence).toEqual([]);
    expect(
      (
        await new CoreCitationResolver(client).readChunk({
          ownerId,
          referenceId,
        })
      ).text,
    ).toBe(`Comment retenir la méthode ${searchTerm} ?`);
  });
});
