import { integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import { newId } from "../../lib/id";
import { users } from "./auth";

export type ServiceKeyKind = "mistral" | "transcription" | "inference";
export type ServiceKeyStatus = "active" | "invalid" | "revoked";

const timestamps = {
  createdAt: integer({ mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
  updatedAt: integer({ mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
};

/** Sealed provider credentials owned by one account and never returned raw. */
export const userServiceKeys = sqliteTable(
  "user_service_keys",
  {
    id: text()
      .notNull()
      .primaryKey()
      .$defaultFn(() => newId("ukey")),
    kind: text().$type<ServiceKeyKind>().notNull(),
    provider: text().notNull().default("legacy"),
    sealedKey: text().notNull(),
    keyVersion: integer().notNull().default(1),
    scopesJson: text({ mode: "json" }).$type<string[]>().notNull().default([]),
    lastValidatedAt: integer({ mode: "timestamp" }),
    revokedAt: integer({ mode: "timestamp" }),
    /** At most the final four characters, solely for recognition in settings. */
    hint: text().notNull(),
    status: text().$type<ServiceKeyStatus>().notNull().default("active"),
    userId: text()
      .notNull()
      .references(() => users.id, {
        onDelete: "cascade",
        onUpdate: "cascade",
      }),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("user_service_keys_user_kind_unique").on(
      table.userId,
      table.kind,
    ),
  ],
);
