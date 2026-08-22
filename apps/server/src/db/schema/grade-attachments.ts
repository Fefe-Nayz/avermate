import {
  index,
  integer,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";
import { newId } from "../../lib/id";
import { grades } from "./app";
import { users } from "./auth";
import { files } from "./files";

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

/** A scanned or uploaded copy associated with one assessed result. */
export const gradeAttachments = sqliteTable(
  "grade_attachments",
  {
    id: text()
      .notNull()
      .primaryKey()
      .$defaultFn(() => newId("gatt")),
    gradeId: text()
      .notNull()
      .references(() => grades.id, {
        onDelete: "cascade",
        onUpdate: "cascade",
      }),
    fileId: text()
      .notNull()
      .references(() => files.id, {
        onDelete: "restrict",
        onUpdate: "cascade",
      }),
    label: text(),
    sortOrder: integer().notNull().default(0),
    userId: owner(),
    ...timestamps,
  },
  (t) => [
    index("grade_attachments_grade_idx").on(t.gradeId),
    uniqueIndex("grade_attachments_grade_file_unique").on(
      t.gradeId,
      t.fileId,
    ),
  ],
);
