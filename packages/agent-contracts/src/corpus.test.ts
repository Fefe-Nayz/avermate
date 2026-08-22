import { describe, expect, test } from "bun:test";
import {
  contentSourceRecordSchema,
  ownedLexicalQuerySchema,
  sourceLocatorV1Schema,
  stagedContentVersionSchema,
} from "./corpus";

const hash = "a".repeat(64);

describe("corpus contracts", () => {
  test("round-trips exact page, heading, time and spreadsheet locators", () => {
    const locators = [
      { kind: "pdf", page: 4, bbox: [0.1, 0.2, 0.8, 0.9] },
      {
        kind: "markdown",
        headingPath: ["Dérivation", "Règle de chaîne"],
        startLine: 12,
        endLine: 18,
      },
      { kind: "audio", startMs: 12_000, endMs: 18_500 },
      { kind: "spreadsheet", sheet: "Notes", range: "B2:D8" },
      {
        kind: "conversation",
        threadId: "thread-1",
        messageId: "message-4",
        partId: "part-text",
        startOffset: 0,
        endOffset: 18,
      },
    ];
    for (const locator of locators) {
      const parsed = sourceLocatorV1Schema.parse(locator);
      expect(JSON.parse(JSON.stringify(parsed))).toEqual(locator);
    }
  });

  test("rejects guessed or impossible locator ranges", () => {
    expect(() =>
      sourceLocatorV1Schema.parse({ kind: "pdf", page: 0 }),
    ).toThrow();
    expect(() =>
      sourceLocatorV1Schema.parse({
        kind: "text",
        startOffset: 50,
        endOffset: 10,
      }),
    ).toThrow();
    expect(() =>
      sourceLocatorV1Schema.parse({
        kind: "conversation",
        threadId: "thread-1",
        messageId: "message-1",
        partId: "part-1",
        startOffset: 10,
      }),
    ).toThrow();
    expect(() =>
      sourceLocatorV1Schema.parse({
        kind: "pdf",
        page: 1,
        bbox: [0, 0, 2, 1],
      }),
    ).toThrow();
  });

  test("keeps node placement explicit and never accepts a fake local body", () => {
    const source = contentSourceRecordSchema.parse({
      ownerId: "owner-1",
      originKind: "material",
      originId: "material-1",
      id: "source-1",
      yearId: "year-1",
      subjectId: null,
      currentVersionId: null,
      status: "registered",
      coverage: "metadata-and-locators-only",
      placement: { kind: "node", nodeId: "node-1" },
      placementRef: "remote-source-1",
      createdAt: "2026-08-22T00:00:00.000Z",
      updatedAt: "2026-08-22T00:00:00.000Z",
    });
    expect(source.placement).toEqual({ kind: "node", nodeId: "node-1" });
    expect(() =>
      contentSourceRecordSchema.parse({ ...source, body: "not allowed" }),
    ).toThrow();
  });

  test("bounds staged chunks and lexical queries before storage", () => {
    const version = stagedContentVersionSchema.parse({
      identity: {
        ownerId: "owner-1",
        originKind: "material",
        originId: "material-1",
      },
      sourceId: "source-1",
      versionKey: "material-1:revision-2",
      contentHash: hash,
      extractorId: "material-inline",
      extractorVersion: "1",
      mimeType: "text/markdown",
      language: "fr",
      byteSize: 12,
      locatorSchemaVersion: 1,
      metadata: {},
      chunks: [
        {
          ordinal: 0,
          text: "La dérivée composée.",
          normalizedText: "la derivee composee.",
          tokenEstimate: 6,
          contentHash: hash,
          locator: {
            kind: "markdown",
            headingPath: ["Dérivation"],
            startLine: 1,
            endLine: 1,
          },
          headingPath: ["Dérivation"],
          evidenceKind: "native-text",
        },
      ],
    });
    expect(version.chunks).toHaveLength(1);
    expect(() =>
      ownedLexicalQuerySchema.parse({
        ownerId: "owner-1",
        query: "x".repeat(2_001),
        mode: "terms",
        projectIds: [],
        yearIds: [],
        subjectIds: [],
        originKinds: [],
        limit: 10,
        cursor: null,
      }),
    ).toThrow();
  });
});
