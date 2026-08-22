import {
  type AnySQLiteColumn,
  index,
  integer,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";
import { newId } from "../../lib/id";
import { users } from "./auth";

export type FilePurpose =
  | "avatar"
  | "feedback-attachment"
  | "course-material"
  | "course-media"
  | "lecture-audio-segment"
  | "grade-copy"
  | "document-export"
  | "document-artifact"
  | "preview"
  | "latex-build";
export type FileStatus = "stored" | "deleted";
export type FilePreviewStatus =
  | "pending"
  | "ready"
  | "unsupported"
  | "failed";

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

/** Provider-backed objects owned by an Avermate account. */
export const files = sqliteTable(
  "files",
  {
    id: text()
      .notNull()
      .primaryKey()
      .$defaultFn(() => newId("file")),
    provider: text().notNull().default("local"),
    /** Provider-native identity; authoritative for deletion. */
    storageKey: text().notNull(),
    url: text().notNull(),
    mimeType: text().notNull(),
    byteSize: integer().notNull(),
    purpose: text().$type<FilePurpose>().notNull(),
    status: text().$type<FileStatus>().notNull().default("stored"),
    previewFileId: text().references((): AnySQLiteColumn => files.id, {
      onDelete: "set null",
      onUpdate: "cascade",
    }),
    previewStatus: text()
      .$type<FilePreviewStatus>()
      .notNull()
      .default("pending"),
    userId: owner(),
    ...timestamps,
  },
  (t) => [
    index("files_user_id_idx").on(t.userId),
    index("files_purpose_idx").on(t.purpose),
    index("files_preview_file_idx").on(t.previewFileId),
    uniqueIndex("files_provider_key_unique").on(t.provider, t.storageKey),
  ],
);
