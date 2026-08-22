import {
  index,
  integer,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";
import { newId } from "../../lib/id";
import { users } from "./auth";
import { materialDocuments } from "./materials";

export type MaterialArtifactKind =
  "ocr-markdown" | "web-markdown" | "media-transcript" | "media-metadata";
export type MaterialArtifactStatus = "pending" | "ready" | "failed";

export interface OcrMetaV1 {
  model: string;
  provider: string;
  pageCount: number;
  providerFileId: string;
  durationMs: number;
  finalUrl?: never;
  fetchedAt?: never;
  title?: never;
  byline?: never;
}

export interface WebMarkdownMetaV1 {
  finalUrl: string;
  fetchedAt: string;
  title: string;
  byline?: string | null;
  site?: string | null;
  publishedAt?: string | null;
  wordCount?: number;
  truncated?: boolean;
  kind?: "web" | "youtube";
  videoId?: string;
  channel?: string;
  durationSec?: number;
  chapters?: Array<{ at: number; title: string }>;
  model?: never;
  pageCount?: never;
  providerFileId?: never;
  durationMs?: never;
}

export interface MediaTranscriptMetaV1 {
  provider: string;
  /** Exact provider model; Node values include the immutable revision. */
  model: string;
  language?: string;
  durationMs?: number;
  segmentCount: number;
}

export interface MediaMetadataMetaV1 {
  kind: "media-metadata";
  modality: "audio" | "video";
  durationMs: number;
  segmentCount: number;
  worker: "corpus-derivatives.v1";
  rendererProfile: string;
  rendererImageDigest: string;
}

const timestamps = {
  createdAt: integer({ mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
  updatedAt: integer({ mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
};

/** Derived, searchable content for one material source. */
export const materialArtifacts = sqliteTable(
  "material_artifacts",
  {
    id: text()
      .notNull()
      .primaryKey()
      .$defaultFn(() => newId("mart")),
    documentId: text()
      .notNull()
      .references(() => materialDocuments.id, {
        onDelete: "cascade",
        onUpdate: "cascade",
      }),
    kind: text().$type<MaterialArtifactKind>().notNull(),
    status: text().$type<MaterialArtifactStatus>().notNull().default("pending"),
    /** Plain markdown for future FTS; the handler caps it at 2 MiB. */
    content: text(),
    metaVersion: integer().notNull().default(1),
    metaJson: text({ mode: "json" }).$type<
      | OcrMetaV1
      | WebMarkdownMetaV1
      | MediaTranscriptMetaV1
      | MediaMetadataMetaV1
    >(),
    error: text(),
    /** Current ingestion/OCR/media generation fence; terminal jobs retain it. */
    runId: text(),
    userId: text()
      .notNull()
      .references(() => users.id, {
        onDelete: "cascade",
        onUpdate: "cascade",
      }),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("material_artifacts_doc_kind_unique").on(
      table.documentId,
      table.kind,
    ),
    index("material_artifacts_user_idx").on(table.userId),
  ],
);
