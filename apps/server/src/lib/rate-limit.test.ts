import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import * as schema from "../db/schema";

process.env.DATABASE_URL = "file::memory:";
process.env.BETTER_AUTH_URL = "http://localhost:3000";
process.env.BETTER_AUTH_SECRET =
  "rate-limit-test-secret-that-is-at-least-32-characters";
process.env.CLIENT_URL = "http://localhost:3001";
process.env.NODE_ENV = "test";

const { reserveDurableRateLimit } = await import("./rate-limit");

const client = createClient({ url: ":memory:" });
const database = drizzle(client, { schema });

beforeAll(async () => {
  const migration = readFileSync(
    join(import.meta.dir, "../../drizzle/0038_redundant_smasher.sql"),
    "utf8",
  ).split("CREATE TABLE `sync_subject_mappings`")[0]!;
  await client.executeMultiple(
    migration.replaceAll("--> statement-breakpoint", ""),
  );
});

afterAll(() => client.close());

describe("durable rate limiting", () => {
  test("atomically enforces one limit across concurrent reservations", async () => {
    const outcomes = await Promise.allSettled(
      Array.from({ length: 10 }, () =>
        reserveDurableRateLimit({
          subject: "user-1:pronote",
          action: "sync.connections.create",
          limit: 5,
          windowMs: 10 * 60_000,
          now: new Date("2026-08-21T12:00:00.000Z"),
          database,
        }),
      ),
    );
    expect(
      outcomes.filter((result) => result.status === "fulfilled"),
    ).toHaveLength(5);
    expect(
      outcomes.filter((result) => result.status === "rejected"),
    ).toHaveLength(5);
    const [row] = await database.select().from(schema.rateLimits);
    expect(row?.count).toBe(10);
    expect(row?.subjectHash).not.toContain("user-1");
  });

  test("starts a fresh counter in the next fixed window", async () => {
    await expect(
      reserveDurableRateLimit({
        subject: "user-1:pronote",
        action: "sync.connections.create",
        limit: 1,
        windowMs: 10 * 60_000,
        now: new Date("2026-08-21T12:10:00.000Z"),
        database,
      }),
    ).resolves.toBeUndefined();
  });
});
