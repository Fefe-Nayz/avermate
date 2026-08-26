import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { env } from "../lib/env";
import { databaseClientConfig, isLocalSqliteUrl } from "./client-config";
import * as schema from "./schema";

const isLocalFile = isLocalSqliteUrl(env.DATABASE_URL);
const client = createClient(
  databaseClientConfig({
    url: env.DATABASE_URL,
    authToken: env.DATABASE_AUTH_TOKEN,
  }),
);

/*
 * Let writers wait for each other instead of failing.
 *
 * The job runner opens four lanes and every HTTP request writes too, so this
 * process is concurrent with itself. SQLite's default rollback journal admits
 * one writer and blocks readers for the duration, and libsql does not wait by
 * default — so a second writer gets `SQLITE_BUSY: database is locked`
 * immediately. That is what "[jobs] runner lane N failed" was, on every lane,
 * on a plain `bun dev`.
 *
 * WAL lets readers carry on during a write and is recorded in the file header,
 * so it survives restarts. The client's local `timeout` option supplies
 * `busy_timeout` to every connection libSQL creates, including the replacement
 * connection opened after transaction(). A one-shot PRAGMA here would be lost
 * at that boundary. Neither setting applies to a remote libSQL URL, which has
 * its own concurrency.
 */
if (isLocalFile) {
  await client.execute("pragma journal_mode = WAL");
}

export const db = drizzle(client, { schema });
export { schema };
