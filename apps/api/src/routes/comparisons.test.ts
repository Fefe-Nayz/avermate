import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
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
    await database.insert(schema.customAverages).values([
      { id: "custom-current", yearId: "current", userId: "owner" },
      { id: "custom2-current", yearId: "current", userId: "owner" },
      { id: "custom-reference", yearId: "reference", userId: "owner" },
      { id: "custom2-reference", yearId: "reference", userId: "owner" },
      { id: "custom-older", yearId: "older", userId: "owner" },
      { id: "custom-foreign", yearId: "foreign", userId: "other" },
      { id: "custom-inconsistent-source", yearId: "current", userId: "other" },
      { id: "custom-inconsistent-reference", yearId: "reference", userId: "other" },
    ].map((customAverage) => ({ ...customAverage, name: customAverage.id, subjects: "[]", createdAt: now })));
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
    assert.deepEqual(data.comparison.customAverageMap, {});
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

  it("persists custom average mappings and explicit exclusions independently for each pair", async () => {
    const customAverageMap = { "custom-current": "custom-reference", "custom2-current": null };
    const saved = await put({ ...validMaps, customAverageMap });
    assert.equal(saved.status, 200);
    assert.deepEqual((await saved.json()).comparison.customAverageMap, customAverageMap);
    assert.deepEqual((await (await app().request("/comparisons/current/reference")).json()).comparison.customAverageMap, customAverageMap);
    const otherPair = await put({ subjectMap: {}, periodMap: {}, customAverageMap: { "custom-current": "custom-older" } }, "current/older");
    assert.equal(otherPair.status, 200);
    assert.deepEqual((await (await app().request("/comparisons/current/reference")).json()).comparison.customAverageMap, customAverageMap);
    assert.deepEqual((await otherPair.json()).comparison.customAverageMap, { "custom-current": "custom-older" });
  });

  it("preserves custom average mappings for old callers and clears them only when explicitly requested", async () => {
    const initial = await put();
    assert.deepEqual((await initial.json()).comparison.customAverageMap, {});
    const customAverageMap = { "custom-current": "custom-reference", "custom2-current": null };
    assert.equal((await put({ ...validMaps, customAverageMap })).status, 200);
    const legacyUpdate = await put({ subjectMap: {}, periodMap: {} });
    assert.equal(legacyUpdate.status, 200);
    assert.deepEqual((await legacyUpdate.json()).comparison.customAverageMap, customAverageMap);
    const row = await database.query.yearComparisons.findFirst();
    assert.deepEqual(JSON.parse(row!.customAverageMap), customAverageMap);
    assert.deepEqual((await (await put({ ...validMaps, customAverageMap: {} })).json()).comparison.customAverageMap, {});
    assert.deepEqual((await (await app().request("/comparisons/current/reference")).json()).comparison.customAverageMap, {});
  });

  it("validates custom average ownership and exact source/reference year membership without overwriting the saved map", async () => {
    const customAverageMap = { "custom-current": "custom-reference" };
    await put({ ...validMaps, customAverageMap });
    for (const invalid of [
      { "custom-current": "custom-foreign" },
      { "custom-foreign": null },
      { "custom-current": "custom-older" },
      { "custom-older": null },
      { "custom-reference": "custom-current" },
      { "custom-current": "custom-current" },
      { "custom-current": "custom-inconsistent-reference" },
      { "custom-inconsistent-source": null },
      { "math-current": "math-reference" },
      { missing: null },
    ]) {
      const response = await put({ ...validMaps, customAverageMap: invalid });
      assert.equal(response.status, 400);
      assert.deepEqual(await response.json(), { code: "INVALID_CUSTOM_AVERAGE_MAPPING" });
    }
    const saved = await (await app().request("/comparisons/current/reference")).json();
    assert.deepEqual(saved.comparison.customAverageMap, customAverageMap);
  });

  it("rejects duplicate custom average references and accepts multiple null exclusions", async () => {
    assert.equal((await put({ ...validMaps, customAverageMap: { "custom-current": "custom-reference", "custom2-current": "custom-reference" } })).status, 400);
    assert.equal((await put({ ...validMaps, customAverageMap: null })).status, 400);
    assert.equal((await put({ ...validMaps, customAverageMap: { "custom-current": null, "custom2-current": null } })).status, 200);
  });

  it("clears deleted custom average references and drops deleted sources, including when an old client saves", async () => {
    await put({ ...validMaps, customAverageMap: { "custom-current": "custom-reference", "custom2-current": "custom2-reference" } });
    await database.delete(schema.customAverages).where(eq(schema.customAverages.id, "custom-reference"));
    await database.delete(schema.customAverages).where(eq(schema.customAverages.id, "custom2-current"));
    const saved = await (await app().request("/comparisons/current/reference")).json();
    assert.deepEqual(saved.comparison.customAverageMap, { "custom-current": null });
    const legacyUpdate = await put();
    assert.equal(legacyUpdate.status, 200);
    assert.deepEqual((await legacyUpdate.json()).comparison.customAverageMap, { "custom-current": null });
  });

  it("adds the custom average map to existing comparison rows without changing their saved mappings", async () => {
    const upgradeClient = createClient({ url: "file::memory:" });
    try {
      await upgradeClient.executeMultiple("CREATE TABLE users (id TEXT PRIMARY KEY); CREATE TABLE years (id TEXT PRIMARY KEY);");
      await upgradeClient.executeMultiple("INSERT INTO users (id) VALUES ('owner'); INSERT INTO years (id) VALUES ('current'),('reference');");
      const oldMigration = await readFile(new URL("../../drizzle/0006_year_comparisons.sql", import.meta.url), "utf8");
      await upgradeClient.executeMultiple(oldMigration);
      await upgradeClient.execute({
        sql: "INSERT INTO year_comparisons (user_id,year_id,reference_year_id,subject_map,period_map,created_at,updated_at) VALUES (?,?,?,?,?,?,?)",
        args: ["owner", "current", "reference", JSON.stringify(validMaps.subjectMap), JSON.stringify(validMaps.periodMap), 100, 200],
      });
      const migration = await readFile(new URL("../../drizzle/0007_year_comparison_custom_averages.sql", import.meta.url), "utf8");
      await upgradeClient.executeMultiple(migration);
      const result = await upgradeClient.execute("SELECT * FROM year_comparisons");
      assert.equal(result.rows.length, 1);
      assert.equal(result.rows[0].custom_average_map, "{}");
      assert.equal(result.rows[0].subject_map, JSON.stringify(validMaps.subjectMap));
      assert.equal(result.rows[0].period_map, JSON.stringify(validMaps.periodMap));
      assert.equal(result.rows[0].created_at, 100);
      assert.equal(result.rows[0].updated_at, 200);
    } finally {
      upgradeClient.close();
    }
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
