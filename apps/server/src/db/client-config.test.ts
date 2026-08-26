import { describe, expect, test } from "bun:test";
import { createClient } from "@libsql/client";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { registerSharedTestDatabaseLifecycle } from "../testing/database-lifecycle";
import {
  databaseClientConfig,
  LOCAL_SQLITE_BUSY_TIMEOUT_MS,
} from "./client-config";

const directory = mkdtempSync(join(tmpdir(), "avermate-client-config-test-"));
const client = createClient(
  databaseClientConfig({
    url: `file:${join(directory, "database.db").replaceAll("\\", "/")}`,
  }),
);
registerSharedTestDatabaseLifecycle(client, { directories: [directory] });

describe("local database client configuration", () => {
  test("keeps the busy timeout after libSQL replaces a transaction connection", async () => {
    const before = await client.execute("PRAGMA busy_timeout");
    expect(before.rows[0]?.timeout).toBe(LOCAL_SQLITE_BUSY_TIMEOUT_MS);

    const transaction = await client.transaction("write");
    await transaction.execute("CREATE TABLE concurrency_probe (id INTEGER)");
    await transaction.commit();

    const after = await client.execute("PRAGMA busy_timeout");
    expect(after.rows[0]?.timeout).toBe(LOCAL_SQLITE_BUSY_TIMEOUT_MS);
  });

  test("does not attach a local timeout to remote libSQL configuration", () => {
    expect(
      databaseClientConfig({
        url: "libsql://database.example.test",
        authToken: "operator-token",
      }),
    ).toEqual({
      url: "libsql://database.example.test",
      authToken: "operator-token",
      timeout: undefined,
    });
  });
});
