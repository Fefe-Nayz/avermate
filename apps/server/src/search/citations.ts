import type { Client } from "@libsql/client";
import {
  resolvedCitationSchema,
  sourceLocatorV1Schema,
  type CitationResolver,
  type OwnedCitationRef,
  type OwnedOpenTarget,
  type ResolvedCitation,
} from "@avermate/agent-contracts";
import { db } from "../db";
import { jsonValue } from "./values";

type SqlClient = Pick<Client, "execute">;

const TITLE_SQL = {
  material: `SELECT title FROM material_documents WHERE id = ? AND userId = ?`,
  "study-document": `SELECT title FROM study_documents WHERE id = ? AND userId = ?`,
  recording: `SELECT title FROM lecture_recordings WHERE id = ? AND userId = ?`,
  grade: `SELECT name AS title FROM grades WHERE id = ? AND userId = ?`,
  subject: `SELECT name AS title FROM subjects WHERE id = ? AND userId = ?`,
  conversation: `SELECT title FROM assistant_threads WHERE id = ? AND userId = ? AND deletedAt IS NULL`,
  artifact: `
    SELECT documents.title || ' — ' || artifacts.kind AS title
    FROM document_artifacts AS artifacts
    JOIN study_documents AS documents ON documents.id = artifacts.documentId
    WHERE artifacts.id = ? AND artifacts.userId = ?
  `,
} as const;

export class CoreCitationResolver implements CitationResolver {
  constructor(private readonly client: SqlClient = db.$client) {}

  async resolve(input: OwnedCitationRef): Promise<ResolvedCitation> {
    const result = await this.client.execute({
      sql: `
        SELECT refs.id AS referenceId, refs.chunkId, refs.locatorJson,
          refs.quotedContentHash, versions.id AS versionId,
          versions.contentHash AS versionContentHash,
          sources.id AS sourceId, sources.originKind, sources.originId,
          chunks.contentHash AS chunkContentHash
        FROM content_version_references AS refs
        JOIN content_versions AS versions ON versions.id = refs.sourceVersionId
        JOIN content_sources AS sources ON sources.id = versions.sourceId
        LEFT JOIN content_chunks AS chunks
          ON chunks.id = refs.chunkId AND chunks.versionId = versions.id
        WHERE refs.id = ? AND refs.userId = ? AND sources.userId = ?
        LIMIT 1
      `,
      args: [input.referenceId, input.ownerId, input.ownerId],
    });
    const row = result.rows[0];
    if (!row) throw new Error("The owned citation was not found");
    const kind = row.originKind as keyof typeof TITLE_SQL;
    const titleResult = await this.client.execute({
      sql: TITLE_SQL[kind],
      args: [row.originId, input.ownerId],
    });
    const title = titleResult.rows[0]?.title;
    const locator = sourceLocatorV1Schema.parse(jsonValue(row.locatorJson));
    return resolvedCitationSchema.parse({
      referenceId: String(row.referenceId),
      sourceId: String(row.sourceId),
      versionId: String(row.versionId),
      chunkId: row.chunkId === null ? null : String(row.chunkId),
      displayTitle:
        typeof title === "string" && title.trim()
          ? title.trim().slice(0, 1_000)
          : `${kind} ${String(row.originId)}`,
      locator,
      contentHash: String(row.chunkContentHash ?? row.versionContentHash),
      quotedContentHash:
        row.quotedContentHash === null ? null : String(row.quotedContentHash),
      openTarget: {
        kind,
        resourceId: String(row.originId),
        locator,
      },
    });
  }

  async open(input: OwnedCitationRef): Promise<OwnedOpenTarget> {
    return (await this.resolve(input)).openTarget;
  }

  async readChunk(input: OwnedCitationRef) {
    const citation = await this.resolve(input);
    if (!citation.chunkId) return { citation, text: null };
    const result = await this.client.execute({
      sql: `
        SELECT chunks.text
        FROM content_chunks AS chunks
        JOIN content_versions AS versions ON versions.id = chunks.versionId
        JOIN content_sources AS sources ON sources.id = versions.sourceId
        JOIN content_version_references AS refs
          ON refs.chunkId = chunks.id AND refs.sourceVersionId = versions.id
        WHERE refs.id = ? AND refs.userId = ? AND sources.userId = ?
        LIMIT 1
      `,
      args: [input.referenceId, input.ownerId, input.ownerId],
    });
    return {
      citation,
      text:
        result.rows[0]?.text === undefined ? null : String(result.rows[0].text),
    };
  }
}
