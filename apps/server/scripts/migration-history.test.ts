import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { defaultMigrationsFolder } from "./migrate";

type Journal = {
  entries: Array<{ idx: number; tag: string; when: number }>;
};

type Snapshot = {
  id: string;
  prevId: string;
  tables: Record<
    string,
    {
      columns: Record<string, { default?: unknown }>;
      indexes: Record<string, { name: string; isUnique: boolean }>;
      foreignKeys: Record<string, { onDelete?: string; onUpdate?: string }>;
    }
  >;
};

type ChecksumManifest = {
  version: number;
  algorithm: "sha256";
  migrations: Record<string, string>;
};

async function readJson<T>(path: string) {
  // SAFETY: these are checked-in Drizzle metadata fixtures whose structure is
  // asserted immediately by the tests that consume them.
  return JSON.parse(await readFile(path, "utf8")) as T;
}

function sha256(source: string) {
  return createHash("sha256").update(source).digest("hex");
}

function migrationChecksumVariants(source: string) {
  // The manifest was introduced after migrations had already been reviewed on
  // both LF and CRLF worktrees. Accept exactly those two whole-source encodings
  // so checkout conversion is non-semantic while every other byte remains
  // covered by the reviewed digest. New checkouts are pinned to LF by
  // .gitattributes.
  const lfSource = source.replaceAll("\r\n", "\n");
  return [sha256(lfSource), sha256(lfSource.replaceAll("\n", "\r\n"))];
}

describe("immutable migration history", () => {
  test("ignores checkout line endings without masking other SQL changes", () => {
    const lfSource = "CREATE TABLE example (id integer);\nSELECT 1;\n";
    const crlfSource = lfSource.replaceAll("\n", "\r\n");
    const lfChecksum = sha256(lfSource);
    const crlfChecksum = sha256(crlfSource);

    expect(migrationChecksumVariants(lfSource)).toContain(lfChecksum);
    expect(migrationChecksumVariants(lfSource)).toContain(crlfChecksum);
    expect(migrationChecksumVariants(crlfSource)).toContain(lfChecksum);
    expect(migrationChecksumVariants(crlfSource)).toContain(crlfChecksum);
    expect(
      migrationChecksumVariants(lfSource.replace("SELECT 1", "SELECT 2")),
    ).not.toContain(lfChecksum);
    expect(
      migrationChecksumVariants(lfSource.replace("SELECT 1", "SELECT 1 ")),
    ).not.toContain(lfChecksum);
  });

  test("keeps SQL, journal, snapshots and reviewed checksums in one continuous chain", async () => {
    const [journal, manifest, files] = await Promise.all([
      readJson<Journal>(`${defaultMigrationsFolder}/meta/_journal.json`),
      readJson<ChecksumManifest>(
        `${defaultMigrationsFolder}/migration-checksums.json`,
      ),
      readdir(defaultMigrationsFolder),
    ]);
    const sqlFiles = files
      .filter((file) => /^\d{4}_.+\.sql$/.test(file))
      .sort();
    const expectedSqlFiles = journal.entries.map((entry) => `${entry.tag}.sql`);

    expect(manifest.version).toBe(1);
    expect(manifest.algorithm).toBe("sha256");
    expect(sqlFiles).toEqual(expectedSqlFiles);
    expect(Object.keys(manifest.migrations)).toEqual(
      journal.entries.map((entry) => entry.tag),
    );
    expect(journal.entries.map((entry) => entry.idx)).toEqual(
      journal.entries.map((_, index) => index),
    );
    expect(
      journal.entries.every(
        (entry, index) =>
          index === 0 || entry.when > journal.entries[index - 1]!.when,
      ),
    ).toBe(true);

    const normalizedSql = new Set<string>();
    let previousSnapshotId = "00000000-0000-0000-0000-000000000000";
    const snapshotIds = new Set<string>();
    for (const entry of journal.entries) {
      const source = await readFile(
        `${defaultMigrationsFolder}/${entry.tag}.sql`,
        "utf8",
      );
      expect(migrationChecksumVariants(source)).toContain(
        manifest.migrations[entry.tag],
      );

      const normalized = source.replace(/\s+/g, " ").trim();
      expect(normalized.length).toBeGreaterThan(0);
      expect(normalizedSql.has(normalized)).toBe(false);
      normalizedSql.add(normalized);

      const snapshot = await readJson<Snapshot>(
        `${defaultMigrationsFolder}/meta/${String(entry.idx).padStart(4, "0")}_snapshot.json`,
      );
      expect(snapshot.prevId).toBe(previousSnapshotId);
      expect(snapshotIds.has(snapshot.id)).toBe(false);
      snapshotIds.add(snapshot.id);
      previousSnapshotId = snapshot.id;
    }
  });

  test("records the schema state produced by the 0026 and 0041 SQL transitions", async () => {
    for (let index = 26; index <= 37; index += 1) {
      const snapshot = await readJson<Snapshot>(
        `${defaultMigrationsFolder}/meta/${String(index).padStart(4, "0")}_snapshot.json`,
      );
      expect(snapshot.tables.files?.columns.provider?.default).toBe("'local'");
    }

    for (let index = 41; index <= 43; index += 1) {
      const snapshot = await readJson<Snapshot>(
        `${defaultMigrationsFolder}/meta/${String(index).padStart(4, "0")}_snapshot.json`,
      );
      expect(snapshot.tables.material_documents?.indexes).toMatchObject({
        material_documents_file_idx: {
          name: "material_documents_file_idx",
          isUnique: false,
        },
      });
      expect(
        snapshot.tables.material_documents?.indexes
          .material_documents_file_unique,
      ).toBeUndefined();
    }
  });

  test("records deployed FK/default behavior until 0054 reconciles it", async () => {
    for (let index = 4; index <= 53; index += 1) {
      const snapshot = await readJson<Snapshot>(
        `${defaultMigrationsFolder}/meta/${String(index).padStart(4, "0")}_snapshot.json`,
      );
      expect(snapshot.tables.feedback?.columns.lastSeenAt?.default).toBe(
        "unixepoch()",
      );
      expect(
        snapshot.tables.feedback?.foreignKeys
          .feedback_assignedToUserId_users_id_fk,
      ).toMatchObject({ onDelete: "no action", onUpdate: "no action" });
      if (index >= 13) {
        expect(
          snapshot.tables.social_groups?.foreignKeys
            .social_groups_sharedSetupYearId_years_id_fk,
        ).toMatchObject({ onDelete: "no action", onUpdate: "no action" });
      }
    }

    const reconciled = await readJson<Snapshot>(
      `${defaultMigrationsFolder}/meta/0054_snapshot.json`,
    );
    expect(reconciled.tables.feedback?.columns.lastSeenAt?.default).toBe(
      undefined,
    );
    expect(
      reconciled.tables.feedback?.foreignKeys
        .feedback_assignedToUserId_users_id_fk,
    ).toMatchObject({ onDelete: "set null", onUpdate: "cascade" });
    expect(
      reconciled.tables.social_groups?.foreignKeys
        .social_groups_sharedSetupYearId_years_id_fk,
    ).toMatchObject({ onDelete: "set null", onUpdate: "cascade" });
  });
});
