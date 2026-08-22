import { createClient, type Client } from "@libsql/client";
import { readFile, rm } from "node:fs/promises";
import { rmSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { tmpdir } from "node:os";

const paths = new WeakMap<Client, string>();
const deferredCleanup = new Set<string>();
process.once("exit", () => {
  for (const path of deferredCleanup) {
    try {
      rmSync(path, { force: true });
    } catch {
      // OS temporary storage is the final fallback after process teardown.
    }
  }
});

/** Minimal isolated database for Plan 034 contract/property tests. */
export async function createManagedTestDatabase(
  userIds: readonly string[] = ["account-a", "account-b"],
): Promise<Client> {
  // libsql transactions may use another connection, so a plain `:memory:` DB
  // would lose its schema at the transaction boundary.
  const path = join(tmpdir(), `avermate-managed-${randomUUID()}.db`);
  const client = createClient({ url: `file:${path}` });
  paths.set(client, path);
  await client.execute("PRAGMA foreign_keys = ON");
  await client.execute("CREATE TABLE users (id text PRIMARY KEY NOT NULL)");
  await client.execute(`CREATE TABLE user_service_keys (
    id text PRIMARY KEY NOT NULL,
    kind text NOT NULL,
    sealedKey text NOT NULL,
    hint text NOT NULL,
    status text DEFAULT 'active' NOT NULL,
    userId text NOT NULL REFERENCES users(id) ON DELETE CASCADE ON UPDATE CASCADE,
    createdAt integer NOT NULL,
    updatedAt integer NOT NULL
  )`);
  const migration = await readFile(
    `${import.meta.dir}/../../drizzle/0060_wild_thanos.sql`,
    "utf8",
  );
  await client.executeMultiple(
    migration.replaceAll("--> statement-breakpoint", ""),
  );
  for (const id of userIds) {
    await client.execute({
      sql: "INSERT INTO users (id) VALUES (?)",
      args: [id],
    });
  }
  return client;
}

export async function closeManagedTestDatabase(client: Client) {
  const path = paths.get(client);
  client.close();
  if (!path) return;
  // The native libsql worker releases Windows file handles asynchronously;
  // attempting immediate removal can block the test runner for many seconds.
  if (process.platform === "win32") {
    deferredCleanup.add(path);
    return;
  }
  try {
    await rm(path, { force: true });
  } catch (error) {
    if (
      !(error instanceof Error) ||
      !("code" in error) ||
      (error as NodeJS.ErrnoException).code !== "EBUSY"
    ) {
      throw error;
    }
    deferredCleanup.add(path);
  }
}
