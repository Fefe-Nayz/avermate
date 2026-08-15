import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import type { WidgetDefinitionV1 } from "@avermate/core/widget-types";
import { newId } from "../../lib/id";
import { users } from "./auth";

const timestamps = {
  createdAt: integer({ mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
  updatedAt: integer({ mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
};

/**
 * The card gallery: admin-curated, preconfigured widget definitions any user
 * can browse and install onto their own dashboard or insights surface.
 *
 * Templates are global (no year, no owner scoping on reads) and installation
 * is the existing `cards.create` with the template's definition — the store
 * never grows a second write path for cards. A published template is
 * immutable, mirroring `presetVersions`: to change one, archive it and
 * publish a successor. Publish-time validation guarantees the definition
 * carries no user-specific references (subjects, custom averages, goals,
 * periods), so there is no shadow-reference table to maintain.
 */
export const cardTemplates = sqliteTable("card_templates", {
  id: text()
    .notNull()
    .primaryKey()
    .$defaultFn(() => newId("ctpl")),
  title: text().notNull(),
  description: text().notNull().default(""),
  /** Which surfaces it fits — a subset of WIDGET_SURFACES. */
  surfaces: text({ mode: "json" }).$type<string[]>().notNull(),
  /** Grouping key in the gallery. */
  category: text().notNull().default("general"),
  definitionVersion: integer().notNull(),
  definitionJson: text({ mode: "json" }).$type<WidgetDefinitionV1>().notNull(),
  status: text()
    .$type<"draft" | "published" | "archived">()
    .notNull()
    .default("draft"),
  sortOrder: integer().notNull().default(0),
  createdByUserId: text()
    .notNull()
    .references(() => users.id, { onDelete: "cascade", onUpdate: "cascade" }),
  ...timestamps,
});
