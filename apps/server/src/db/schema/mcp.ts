import {
  index,
  integer,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";
import { newId } from "../../lib/id";
import { users } from "./auth";

/**
 * Durable replay fence for destructive MCP tools.
 *
 * A pending row is deliberately never retried automatically: if the process
 * dies after the domain mutation but before recording its result, safety wins
 * over guessing and the caller must inspect the resource before trying again.
 */
export const mcpOperations = sqliteTable(
  "mcp_operations",
  {
    id: text()
      .notNull()
      .primaryKey()
      .$defaultFn(() => newId("mop")),
    userId: text()
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    toolName: text().notNull(),
    idempotencyKey: text().notNull(),
    argumentsHash: text().notNull(),
    status: text({ enum: ["pending", "completed"] })
      .notNull()
      .default("pending"),
    result: text({ mode: "json" }).$type<Record<string, unknown>>(),
    createdAt: integer({ mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
    completedAt: integer({ mode: "timestamp" }),
  },
  (t) => [
    uniqueIndex("mcp_operations_replay_fence").on(
      t.userId,
      t.toolName,
      t.idempotencyKey,
    ),
    index("mcp_operations_user_id_idx").on(t.userId),
  ],
);
