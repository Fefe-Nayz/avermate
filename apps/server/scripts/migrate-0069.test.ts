import { describe, expect, test } from "bun:test";
import { createClient } from "@libsql/client";
import { readFile } from "node:fs/promises";
import { defaultMigrationsFolder, migrateClient } from "./migrate";

type Snapshot = {
  id: string;
  prevId: string;
  tables: Record<string, {
    columns: Record<string, { name: string; type: string; notNull: boolean; primaryKey: boolean }>;
    indexes: Record<string, { columns: string[]; isUnique: boolean }>;
    foreignKeys: Record<string, { tableTo: string; columnsFrom: string[]; columnsTo: string[]; onDelete: string; onUpdate: string }>;
  }>;
};

describe("0069 capability control-plane migration", () => {
  test("upgrades the complete migration chain and matches the nine new snapshot tables", async () => {
    const previous: Snapshot = JSON.parse(await readFile(`${defaultMigrationsFolder}/meta/0068_snapshot.json`, "utf8"));
    const current: Snapshot = JSON.parse(await readFile(`${defaultMigrationsFolder}/meta/0069_snapshot.json`, "utf8"));
    expect(current.prevId).toBe(previous.id);
    for (const [name, table] of Object.entries(previous.tables)) {
      expect(current.tables[name]).toEqual(table);
    }
    const added = Object.keys(current.tables).filter((name) => !(name in previous.tables));
    expect(added).toHaveLength(9);
    expect(added.every((name) => name.startsWith("capability_"))).toBe(true);

    const client = createClient({ url: ":memory:" });
    try {
      await client.execute("PRAGMA foreign_keys = ON");
      await migrateClient(client);
      for (const name of added) {
        const table = current.tables[name]!;
        const columns = (await client.execute(`PRAGMA table_info("${name}")`)).rows;
        expect(columns.map((column) => String(column.name))).toEqual(Object.keys(table.columns));
        for (const column of columns) {
          const expected = table.columns[String(column.name)]!;
          expect(String(column.type).toLowerCase()).toBe(expected.type);
          expect(Boolean(column.notnull)).toBe(expected.notNull);
          expect(Boolean(column.pk)).toBe(expected.primaryKey);
        }
        const indexes = (await client.execute(`PRAGMA index_list("${name}")`)).rows
          .filter((index) => !String(index.name).startsWith("sqlite_"));
        expect(indexes.map((index) => String(index.name)).sort()).toEqual(Object.keys(table.indexes).sort());
        for (const index of indexes) {
          const expected = table.indexes[String(index.name)]!;
          expect(Boolean(index.unique)).toBe(expected.isUnique);
          const indexedColumns = (await client.execute(`PRAGMA index_info("${String(index.name)}")`)).rows;
          expect(indexedColumns.map((column) => String(column.name))).toEqual(expected.columns);
        }
        const foreignKeys = (await client.execute(`PRAGMA foreign_key_list("${name}")`)).rows;
        expect(foreignKeys).toHaveLength(Object.keys(table.foreignKeys).length);
        for (const expected of Object.values(table.foreignKeys)) {
          expect(foreignKeys.some((key) =>
            key.table === expected.tableTo && key.from === expected.columnsFrom[0] &&
            key.to === expected.columnsTo[0] &&
            String(key.on_delete).toLowerCase() === expected.onDelete &&
            String(key.on_update).toLowerCase() === expected.onUpdate,
          )).toBe(true);
        }
      }
      expect((await client.execute("PRAGMA foreign_key_check")).rows).toEqual([]);
      expect((await client.execute("PRAGMA integrity_check")).rows[0]?.integrity_check).toBe("ok");
      // The migration journal makes rerunning the complete chain a no-op.
      await migrateClient(client);
    } finally {
      client.close();
    }
  });
});
