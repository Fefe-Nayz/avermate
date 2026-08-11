import {
  index,
  integer,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";
import { newId } from "../../lib/id";
import { feedback } from "./app";
import { users } from "./auth";

export const feedbackLabels = sqliteTable(
  "feedback_labels",
  {
    id: text()
      .notNull()
      .primaryKey()
      .$defaultFn(() => newId("fbl")),
    feedbackId: text()
      .notNull()
      .references(() => feedback.id, {
        onDelete: "cascade",
        onUpdate: "cascade",
      }),
    label: text().notNull(),
    createdByUserId: text().references(() => users.id, {
      onDelete: "set null",
      onUpdate: "cascade",
    }),
    createdAt: integer({ mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (t) => [
    uniqueIndex("feedback_labels_unique").on(t.feedbackId, t.label),
    index("feedback_labels_label_idx").on(t.label),
  ],
);

export const feedbackComments = sqliteTable(
  "feedback_comments",
  {
    id: text()
      .notNull()
      .primaryKey()
      .$defaultFn(() => newId("fbc")),
    feedbackId: text()
      .notNull()
      .references(() => feedback.id, {
        onDelete: "cascade",
        onUpdate: "cascade",
      }),
    authorUserId: text().references(() => users.id, {
      onDelete: "set null",
      onUpdate: "cascade",
    }),
    body: text().notNull(),
    internal: integer({ mode: "boolean" }).notNull().default(true),
    createdAt: integer({ mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
    updatedAt: integer({ mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (t) => [
    index("feedback_comments_feedback_idx").on(t.feedbackId, t.createdAt),
  ],
);

/** Append-only workflow timeline. Payload contains keys/enums, never secrets. */
export const feedbackEvents = sqliteTable(
  "feedback_events",
  {
    id: text()
      .notNull()
      .primaryKey()
      .$defaultFn(() => newId("fbe")),
    feedbackId: text()
      .notNull()
      .references(() => feedback.id, {
        onDelete: "cascade",
        onUpdate: "cascade",
      }),
    actorUserId: text().references(() => users.id, {
      onDelete: "set null",
      onUpdate: "cascade",
    }),
    kind: text().notNull(),
    changedKeys: text().notNull().default("[]"),
    metadata: text().notNull().default("{}"),
    createdAt: integer({ mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (t) => [index("feedback_events_feedback_idx").on(t.feedbackId, t.createdAt)],
);
