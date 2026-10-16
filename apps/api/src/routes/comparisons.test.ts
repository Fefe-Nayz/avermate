import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { createClient, type Client } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { migrate } from "drizzle-orm/libsql/migrator";
import { eq } from "drizzle-orm";
import { Hono } from "hono";
import * as schema from "../db/schema";
import type { Session, User } from "../lib/auth";
import { createComparisonsRoutes } from "./comparisons";

type TestSession = { user: User; session: Session } | null;
const ownerSession: TestSession = {
  user: { id: "owner", emailVerified: true } as User,
  session: {} as Session,
};

describe("year comparison API", () => {
  let client: Client;
  let database: ReturnType<typeof drizzle<typeof schema>>;

  beforeEach(async () => {
    client = createClient({ url: "file::memory:" });
    await client.execute("PRAGMA foreign_keys = ON");
    database = drizzle(client, { schema, casing: "snake_case" });
    await migrate(database, {
      migrationsFolder: fileURLToPath(new URL("../../drizzle", import.meta.url)),
    });
    const now = new Date();
    await database.insert(schema.users).values(["owner", "other"].map((id) => ({
      id, name: id, email: `${id}@example.test`, emailVerified: true,
      createdAt: now, updatedAt: now,
    })));
    await database.insert(schema.years).values([
      { id: "current", userId: "owner" },
      { id: "reference", userId: "owner" },
      { id: "older", userId: "owner" },
      { id: "foreign", userId: "other" },
    ].map((year) => ({
      ...year, name: year.id, startDate: now, endDate: now, defaultOutOf: 2000,
    })));
    await database.insert(schema.subjects).values([
      { id: "math-current", yearId: "current", userId: "owner" },
      { id: "physics-current", yearId: "current", userId: "owner" },
      { id: "math-reference", yearId: "reference", userId: "owner" },
      { id: "physics-reference", yearId: "reference", userId: "owner" },
      { id: "math-older", yearId: "older", userId: "owner" },
      { id: "math-foreign", yearId: "foreign", userId: "other" },
    ].map((subject) => ({ ...subject, name: subject.id, coefficient: 100, createdAt: now })));
    await database.insert(schema.periods).values([
      { id: "term-current", yearId: "current", userId: "owner" },
      { id: "term2-current", yearId: "current", userId: "owner" },
      { id: "term-reference", yearId: "reference", userId: "owner" },
      { id: "term-older", yearId: "older", userId: "owner" },
      { id: "term-foreign", yearId: "foreign", userId: "other" },
    ].map((period) => ({ ...period, name: period.id, startAt: now, endAt: now, createdAt: now })));
  });

  afterEach(() => client?.close());

  function app(session: TestSession = ownerSession) {
    const router = new Hono<{ Variables: { session: TestSession } }>();
    router.use("*", async (c, next) => {
      c.set("session", session);
      await next();
    });
    router.route("/comparisons", createComparisonsRoutes(database));
    return router;
  }

  const validMaps = {
    subjectMap: { "math-current": "math-reference", "physics-current": null },
    periodMap: { "term-current": "term-reference" },
  };

  async function put(body: unknown = validMaps, path = "current/reference", session = ownerSession) {
    return app(session).request(`/comparisons/${path}`, {
      method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
    });
  }

  it("requires an authenticated verified account for reads and writes", async () => {
    assert.equal((await app(null).request("/comparisons/current/reference")).status, 401);
    assert.equal((await put(validMaps, "current/reference", null)).status, 401);
    const unverified = { ...ownerSession!, user: { ...ownerSession!.user, emailVerified: false } };
    assert.equal((await app(unverified).request("/comparisons/current/reference")).status, 403);
    assert.equal((await put(validMaps, "current/reference", unverified)).status, 403);
  });

  it("returns null before setup and refuses comparing a year to itself", async () => {
    const response = await app().request("/comparisons/current/reference");
    assert.deepEqual(await response.json(), { comparison: null });
    assert.equal((await app().request("/comparisons/current/current")).status, 400);
    assert.equal((await put(validMaps, "current/current")).status, 400);
  });

  it("does not expose or configure another account's years", async () => {
    for (const path of ["current/foreign", "foreign/reference", "missing/reference"]) {
      assert.equal((await app().request(`/comparisons/${path}`)).status, 404);
      assert.equal((await put(validMaps, path)).status, 404);
    }
    await put();
    const other = { ...ownerSession!, user: { ...ownerSession!.user, id: "other" } };
    assert.equal((await app(other).request("/comparisons/current/reference")).status, 404);
  });

  it("persists null exclusions, updates the pair, and keeps other pairs independent", async () => {
    const saved = await put();
    assert.equal(saved.status, 200);
    const data = await saved.json();
    assert.deepEqual(data.comparison.subjectMap, validMaps.subjectMap);
    assert.deepEqual(data.comparison.periodMap, validMaps.periodMap);
    assert.ok(Number.isFinite(Date.parse(data.comparison.updatedAt)));
    assert.deepEqual(await (await app().request("/comparisons/current/reference")).json(), data);
    assert.equal((await put({
      subjectMap: { "math-current": "math-older" }, periodMap: {},
    }, "current/older")).status, 200);
    assert.equal((await put({ subjectMap: { "physics-current": "physics-reference" }, periodMap: {} })).status, 200);
    const rows = await database.select().from(schema.yearComparisons);
    assert.equal(rows.length, 2);
    const otherPair = await (await app().request("/comparisons/current/older")).json();
    assert.deepEqual(otherPair.comparison.subjectMap, { "math-current": "math-older" });
    const updated = await (await app().request("/comparisons/current/reference")).json();
    assert.deepEqual(updated.comparison.subjectMap, { "physics-current": "physics-reference" });
  });

  it("validates subject and period ownership and the exact side of each mapping", async () => {
    await put();
    for (const [subjectMap, periodMap] of [
      [{ "math-current": "math-foreign" }, {}],
      [{ "math-foreign": null }, {}],
      [{ "math-current": "math-older" }, {}],
      [{ "math-reference": "math-current" }, {}],
      [{ missing: null }, {}],
      [{}, { "term-current": "term-foreign" }],
      [{}, { "term-foreign": null }],
      [{}, { "term-current": "term-older" }],
      [{}, { "term-reference": "term-current" }],
      [{}, { "full-year": "full-year" }],
    ]) {
      assert.equal((await put({ subjectMap, periodMap })).status, 400);
    }
    const saved = await (await app().request("/comparisons/current/reference")).json();
    assert.deepEqual(saved.comparison.subjectMap, validMaps.subjectMap);
    assert.deepEqual(saved.comparison.periodMap, validMaps.periodMap);
  });

  it("rejects duplicate references while allowing several explicit exclusions", async () => {
    assert.equal((await put({
      subjectMap: { "math-current": "math-reference", "physics-current": "math-reference" }, periodMap: {},
    })).status, 400);
    assert.equal((await put({
      subjectMap: {}, periodMap: { "term-current": "term-reference", "term2-current": "term-reference" },
    })).status, 400);
    assert.equal((await put({
      subjectMap: { "math-current": null, "physics-current": null }, periodMap: {},
    })).status, 200);
  });

  it("clears deleted reference IDs and removes deleted source IDs on read", async () => {
    await put();
    await database.delete(schema.subjects).where(eq(schema.subjects.id, "math-reference"));
    await database.delete(schema.subjects).where(eq(schema.subjects.id, "physics-current"));
    await database.delete(schema.periods).where(eq(schema.periods.id, "term-reference"));
    const saved = await (await app().request("/comparisons/current/reference")).json();
    assert.deepEqual(saved.comparison.subjectMap, { "math-current": null });
    assert.deepEqual(saved.comparison.periodMap, { "term-current": null });
  });

  it("removes stored mappings when either year or its account is deleted", async () => {
    await put();
    await database.delete(schema.years).where(eq(schema.years.id, "reference"));
    assert.equal((await database.select().from(schema.yearComparisons)).length, 0);
    await put({ subjectMap: {}, periodMap: {} }, "current/older");
    await database.delete(schema.years).where(eq(schema.years.id, "current"));
    assert.equal((await database.select().from(schema.yearComparisons)).length, 0);
    await database.insert(schema.years).values({
      id: "new-current", userId: "owner", name: "new", startDate: new Date(), endDate: new Date(), defaultOutOf: 2000,
    });
    await put({ subjectMap: {}, periodMap: {} }, "new-current/older");
    await database.delete(schema.users).where(eq(schema.users.id, "owner"));
    assert.equal((await database.select().from(schema.yearComparisons)).length, 0);
  });
});
