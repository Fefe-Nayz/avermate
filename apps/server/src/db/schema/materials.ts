import {
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";
import { newId } from "../../lib/id";
import { subjects, years } from "./app";
import { users } from "./auth";
import { files } from "./files";
import { contentConnections } from "./sync";

const timestamps = {
  createdAt: integer({ mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
  updatedAt: integer({ mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
};

const owner = () =>
  text()
    .notNull()
    .references(() => users.id, { onDelete: "cascade", onUpdate: "cascade" });

export type MaterialOrigin = "manual" | "moodle" | "onedrive" | "googledrive";
export type MaterialSourceType = "file" | "link" | "text";
export type MaterialTargetKind = "document" | "study" | "recording" | "folder";
export type MaterialDeletionActor = "user" | "provider";
export type MaterialTagLinkOrigin = "manual" | "frontmatter";

/** Versioned provider metadata; integrations add optional fields in later versions. */
export interface MaterialMetaV1 {
  externalId?: string;
  /** True only while the title is the URL-derived create fallback. */
  titleWasDerived?: boolean;
  /** Specialized link ingestion keeps the source row a link. */
  kind?: "youtube";
  videoId?: string;
  channel?: string;
  durationSec?: number;
  chapters?: Array<{ at: number; title: string }>;
}

/** A user-owned, year-scoped folder in the course-material tree. */
export const materialFolders = sqliteTable(
  "material_folders",
  {
    id: text()
      .notNull()
      .primaryKey()
      .$defaultFn(() => newId("mfold")),
    name: text().notNull(),
    /** Self-referencing tree; deliberately no self-FK, like subjects. */
    parentId: text(),
    subjectId: text().references(() => subjects.id, {
      onDelete: "set null",
      onUpdate: "cascade",
    }),
    origin: text().$type<MaterialOrigin>().notNull().default("manual"),
    connectionId: text().references(() => contentConnections.id, {
      onDelete: "set null",
      onUpdate: "cascade",
    }),
    externalId: text(),
    sortOrder: integer().notNull().default(0),
    yearId: text()
      .notNull()
      .references(() => years.id, {
        onDelete: "cascade",
        onUpdate: "cascade",
      }),
    userId: owner(),
    starredAt: integer({ mode: "timestamp" }),
    deletedAt: integer({ mode: "timestamp" }),
    deletedFrom: text(),
    deletedBy: text().$type<MaterialDeletionActor>(),
    deletedBatchId: text(),
    ...timestamps,
  },
  (t) => [
    index("material_folders_year_idx").on(t.yearId),
    index("material_folders_parent_idx").on(t.parentId),
    uniqueIndex("material_folders_connection_external_unique").on(
      t.connectionId,
      t.externalId,
    ),
    index("material_folders_deleted_idx").on(t.userId, t.deletedAt),
  ],
);

/** One uploaded, linked, or inline source inside the materials space. */
export const materialDocuments = sqliteTable(
  "material_documents",
  {
    id: text()
      .notNull()
      .primaryKey()
      .$defaultFn(() => newId("mdoc")),
    title: text().notNull(),
    folderId: text().references(() => materialFolders.id, {
      onDelete: "cascade",
      onUpdate: "cascade",
    }),
    sourceType: text().$type<MaterialSourceType>().notNull().default("file"),
    fileId: text().references(() => files.id, {
      onDelete: "restrict",
      onUpdate: "cascade",
    }),
    /**
     * Set only by the upload adoption endpoint. Keeping this separate from
     * fileId preserves legacy documents that intentionally share a file while
     * still giving new direct-upload replays one durable winner.
     */
    adoptionKey: text(),
    sourceUrl: text(),
    textContent: text(),
    origin: text().$type<MaterialOrigin>().notNull().default("manual"),
    connectionId: text().references(() => contentConnections.id, {
      onDelete: "set null",
      onUpdate: "cascade",
    }),
    externalId: text(),
    metaVersion: integer(),
    metaJson: text({ mode: "json" }).$type<MaterialMetaV1>(),
    yearId: text()
      .notNull()
      .references(() => years.id, {
        onDelete: "cascade",
        onUpdate: "cascade",
      }),
    userId: owner(),
    starredAt: integer({ mode: "timestamp" }),
    deletedAt: integer({ mode: "timestamp" }),
    deletedFrom: text(),
    deletedBy: text().$type<MaterialDeletionActor>(),
    deletedBatchId: text(),
    ...timestamps,
  },
  (t) => [
    index("material_documents_folder_idx").on(t.folderId),
    index("material_documents_year_idx").on(t.yearId),
    index("material_documents_file_idx").on(t.fileId),
    uniqueIndex("material_documents_adoption_key_unique").on(t.adoptionKey),
    uniqueIndex("material_documents_connection_external_unique").on(
      t.connectionId,
      t.externalId,
    ),
    index("material_documents_deleted_idx").on(t.userId, t.deletedAt),
  ],
);

export const materialTags = sqliteTable(
  "material_tags",
  {
    id: text()
      .notNull()
      .primaryKey()
      .$defaultFn(() => newId("mtag")),
    name: text().notNull(),
    color: text(),
    subjectId: text().references(() => subjects.id, {
      onDelete: "set null",
      onUpdate: "cascade",
    }),
    yearId: text()
      .notNull()
      .references(() => years.id, {
        onDelete: "cascade",
        onUpdate: "cascade",
      }),
    userId: owner(),
    ...timestamps,
  },
  (t) => [index("material_tags_year_idx").on(t.yearId)],
);

export const materialTagLinks = sqliteTable(
  "material_tag_links",
  {
    tagId: text()
      .notNull()
      .references(() => materialTags.id, {
        onDelete: "cascade",
        onUpdate: "cascade",
      }),
    targetKind: text().$type<MaterialTargetKind>().notNull(),
    targetId: text().notNull(),
    /** Front-matter links can be refreshed without removing manual choices. */
    origin: text().$type<MaterialTagLinkOrigin>().notNull().default("manual"),
    ...timestamps,
  },
  (t) => [
    primaryKey({ columns: [t.tagId, t.targetKind, t.targetId] }),
    index("material_tag_links_target_idx").on(t.targetKind, t.targetId),
  ],
);
