import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { migrate } from "drizzle-orm/libsql/migrator";
import { readMigrationFiles } from "drizzle-orm/migrator";
import { fileURLToPath } from "node:url";

export const migrationsFolder = fileURLToPath(new URL("../drizzle", import.meta.url));

/** Uses the same versioned migration journal for local SQLite and remote libSQL. */
export async function runMigrations(options: {
  url: string;
  authToken?: string;
  migrationsFolder?: string;
}) {
  if (!options.url.trim()) throw new Error("DATABASE_URL is required.");
  const folder = options.migrationsFolder ?? migrationsFolder;
  // Validate the packaged migration files before opening any database connection.
  if (readMigrationFiles({ migrationsFolder: folder }).length === 0) {
    throw new Error("No versioned database migrations were found.");
  }
  const client = createClient({ url: options.url, authToken: options.authToken });
  try {
    // libSQL applies the pending SQL and its journal entries in one migration
    // transaction. A failure leaves them unapplied; a successful restart is a no-op.
    await migrate(drizzle(client), { migrationsFolder: folder });
  } finally {
    client.close();
  }
}

if (import.meta.main) {
  try {
    console.log("[db:migrate] Applying versioned database migrations...");
    await runMigrations({
      url: process.env.DATABASE_URL ?? "",
      authToken: process.env.DATABASE_AUTH_TOKEN || undefined,
    });
    console.log("[db:migrate] Database migrations complete.");
  } catch (error) {
    // Avoid printing connection URLs or tokens if the remote driver includes
    // them in an error. Leave the process unsuccessful so deployment stops.
    let message = error instanceof Error ? error.message : String(error);
    for (const secret of [process.env.DATABASE_URL, process.env.DATABASE_AUTH_TOKEN]) {
      if (secret) message = message.replaceAll(secret, "[redacted]");
    }
    console.error(`[db:migrate] Migration failed; API startup stopped: ${message}`);
    process.exitCode = 1;
  }
}
