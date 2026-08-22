import { sql } from "drizzle-orm"
import {
  check,
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core"
import type {
  CustomMcpAuthKind,
  CustomMcpPlacement,
} from "@avermate/agent-contracts"
import { newId } from "../../lib/id"
import { users } from "./auth"

export type CustomMcpSourceStatus =
  | "review-required"
  | "enabled"
  | "disabled"
  | "unavailable"

export type CustomMcpToolClassification =
  | "unreviewed"
  | "read-only"
  | "blocked"

const timestamps = {
  createdAt: integer({ mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
  updatedAt: integer({ mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
}

/** User-configured remote MCP endpoint. Secrets never leave this table. */
export const assistantToolSources = sqliteTable(
  "assistant_tool_sources",
  {
    id: text()
      .notNull()
      .primaryKey()
      .$defaultFn(() => newId("amcp")),
    userId: text()
      .notNull()
      .references(() => users.id, {
        onDelete: "cascade",
        onUpdate: "cascade",
      }),
    name: text().notNull(),
    endpointUrl: text().notNull(),
    endpointOrigin: text().notNull(),
    placement: text().$type<CustomMcpPlacement>().notNull(),
    authKind: text().$type<CustomMcpAuthKind>().notNull(),
    sealedCredential: text(),
    credentialHint: text(),
    status: text()
      .$type<CustomMcpSourceStatus>()
      .notNull()
      .default("review-required"),
    catalogJson: text().notNull(),
    catalogDigest: text().notNull(),
    catalogRevision: integer().notNull().default(1),
    lastCheckedAt: integer({ mode: "timestamp" }).notNull(),
    lastError: text(),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("assistant_tool_sources_user_url_unique").on(
      table.userId,
      table.endpointUrl
    ),
    index("assistant_tool_sources_user_status_idx").on(
      table.userId,
      table.status
    ),
    check(
      "assistant_tool_sources_placement_check",
      sql`${table.placement} in ('hosted-core', 'node')`
    ),
    check(
      "assistant_tool_sources_auth_check",
      sql`${table.authKind} in ('none', 'bearer', 'api-key')`
    ),
    check(
      "assistant_tool_sources_credential_check",
      sql`(${table.authKind} = 'none' and ${table.sealedCredential} is null and ${table.credentialHint} is null) or (${table.authKind} <> 'none' and ${table.sealedCredential} is not null)`
    ),
    check(
      "assistant_tool_sources_status_check",
      sql`${table.status} in ('review-required', 'enabled', 'disabled', 'unavailable')`
    ),
    check(
      "assistant_tool_sources_digest_check",
      sql`length(${table.catalogDigest}) = 64`
    ),
    check(
      "assistant_tool_sources_revision_check",
      sql`${table.catalogRevision} >= 1`
    ),
  ]
)

/** Exact per-tool review bound to one catalogue digest. */
export const assistantToolSourcePolicies = sqliteTable(
  "assistant_tool_source_policies",
  {
    sourceId: text()
      .notNull()
      .references(() => assistantToolSources.id, {
        onDelete: "cascade",
        onUpdate: "cascade",
      }),
    remoteToolId: text().notNull(),
    catalogDigest: text().notNull(),
    classification: text()
      .$type<CustomMcpToolClassification>()
      .notNull()
      .default("unreviewed"),
    enabled: integer({ mode: "boolean" }).notNull().default(false),
    allowedDataCategoriesJson: text().notNull().default("[]"),
    reviewedAt: integer({ mode: "timestamp" }),
    ...timestamps,
  },
  (table) => [
    primaryKey({ columns: [table.sourceId, table.remoteToolId] }),
    index("assistant_tool_source_policies_source_enabled_idx").on(
      table.sourceId,
      table.enabled
    ),
    check(
      "assistant_tool_source_policies_classification_check",
      sql`${table.classification} in ('unreviewed', 'read-only', 'blocked')`
    ),
    check(
      "assistant_tool_source_policies_enabled_check",
      sql`${table.enabled} = 0 or ${table.classification} = 'read-only'`
    ),
    check(
      "assistant_tool_source_policies_digest_check",
      sql`length(${table.catalogDigest}) = 64`
    ),
  ]
)
