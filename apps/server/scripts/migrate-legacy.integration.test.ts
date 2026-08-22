import { expect, test } from "bun:test";
import { createClient } from "@libsql/client";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const now = 1_786_406_400;

const legacyFixture = `
  PRAGMA foreign_keys = ON;
  CREATE TABLE users (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL,
    email_verified INTEGER NOT NULL, avatar_url TEXT, role TEXT,
    banned INTEGER, ban_reason TEXT, ban_expires INTEGER,
    created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
  );
  CREATE TABLE years (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, start_date INTEGER NOT NULL,
    end_date INTEGER NOT NULL, default_out_of INTEGER NOT NULL,
    created_at INTEGER NOT NULL, user_id TEXT NOT NULL
  );
  CREATE TABLE periods (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, start_at INTEGER NOT NULL,
    end_at INTEGER NOT NULL, is_cumulative INTEGER NOT NULL,
    created_at INTEGER NOT NULL, user_id TEXT NOT NULL, year_id TEXT NOT NULL
  );
  CREATE TABLE subjects (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, parent_id TEXT,
    coefficient INTEGER NOT NULL, depth INTEGER NOT NULL,
    is_main_subject INTEGER NOT NULL, is_display_subject INTEGER NOT NULL,
    created_at INTEGER NOT NULL, user_id TEXT NOT NULL, year_id TEXT NOT NULL
  );
  CREATE TABLE grades (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, value INTEGER NOT NULL,
    out_of INTEGER NOT NULL, coefficient INTEGER NOT NULL,
    is_composite INTEGER NOT NULL, passed_at INTEGER NOT NULL,
    created_at INTEGER NOT NULL, period_id TEXT, subject_id TEXT NOT NULL,
    user_id TEXT NOT NULL, year_id TEXT NOT NULL
  );
  CREATE TABLE grade_components (
    id TEXT PRIMARY KEY, grade_id TEXT NOT NULL, name TEXT NOT NULL,
    value INTEGER NOT NULL, out_of INTEGER NOT NULL,
    coefficient INTEGER NOT NULL, created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL, user_id TEXT NOT NULL, year_id TEXT NOT NULL
  );
  CREATE TABLE custom_averages (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, subjects TEXT NOT NULL,
    user_id TEXT NOT NULL, is_main_average INTEGER NOT NULL,
    created_at INTEGER NOT NULL, year_id TEXT NOT NULL
  );
  CREATE TABLE user_settings (
    user_id TEXT PRIMARY KEY, theme TEXT NOT NULL, language TEXT NOT NULL,
    chart_settings TEXT NOT NULL, seasonal_themes_enabled INTEGER NOT NULL,
    seasonal_theme TEXT NOT NULL, mokattam_theme_available INTEGER NOT NULL,
    mokattam_theme_enabled INTEGER NOT NULL,
    mokattam_theme_celebration_seen_at INTEGER, haptics_enabled INTEGER NOT NULL,
    custom_theme TEXT NOT NULL, created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE TABLE year_review_views (
    id TEXT PRIMARY KEY, user_id TEXT NOT NULL, year_id TEXT NOT NULL,
    review_key TEXT NOT NULL, clicked_at INTEGER NOT NULL
  );
  CREATE TABLE announcements (
    id TEXT PRIMARY KEY, title TEXT NOT NULL, message TEXT NOT NULL,
    tone TEXT NOT NULL, active INTEGER NOT NULL, starts_at INTEGER,
    ends_at INTEGER, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
    created_by_user_id TEXT NOT NULL
  );
  CREATE TABLE announcement_views (
    id TEXT PRIMARY KEY, announcement_id TEXT NOT NULL, user_id TEXT NOT NULL,
    viewed_at INTEGER NOT NULL
  );

  INSERT INTO users VALUES (
    'legacy-user', 'Legacy Student', 'legacy@example.com', 1, NULL, 'admin',
    0, NULL, NULL, ${now}, ${now}
  );
  INSERT INTO years VALUES (
    'legacy-year', '2025-2026', ${now}, ${now + 31_536_000}, 2000,
    ${now}, 'legacy-user'
  );
  INSERT INTO periods VALUES (
    'legacy-period', 'Semester 1', ${now}, ${now + 15_768_000}, 0,
    ${now}, 'legacy-user', 'legacy-year'
  );
  INSERT INTO subjects VALUES (
    'legacy-subject', 'Mathematics', NULL, 200, 0, 1, 0,
    ${now}, 'legacy-user', 'legacy-year'
  );
  INSERT INTO grades VALUES (
    'legacy-grade', 'Algebra', 1550, 2000, 150, 1,
    ${now + 86_400}, ${now}, 'legacy-period', 'legacy-subject',
    'legacy-user', 'legacy-year'
  );
  INSERT INTO grade_components VALUES (
    'legacy-component', 'legacy-grade', 'Written', 1550, 2000, 100,
    ${now}, ${now}, 'legacy-user', 'legacy-year'
  );
  INSERT INTO custom_averages VALUES (
    'legacy-average', 'Sciences',
    '[{"id":"legacy-subject","customCoefficient":3,"includeChildren":true}]',
    'legacy-user', 1, ${now}, 'legacy-year'
  );
  INSERT INTO user_settings VALUES (
    'legacy-user', 'dark', 'fr',
    '{"autoZoomYAxis":false,"showTrendLine":true,"trendLineSubdivisions":4,"showSubSubjectsInSubjectCharts":false}',
    1, 'none', 1, 0, NULL, 1, '{}', ${now}, ${now}
  );
  INSERT INTO year_review_views VALUES (
    'legacy-review', 'legacy-user', 'legacy-year', 'end-of-year', ${now}
  );
  INSERT INTO announcements VALUES (
    'legacy-announcement', 'Welcome', 'Migration preserved this message',
    'info', 1, NULL, NULL, ${now}, ${now}, 'legacy-user'
  );
  INSERT INTO announcement_views VALUES (
    'legacy-announcement-view', 'legacy-announcement', 'legacy-user', ${now}
  );
`;

function databaseUrl(path: string): string {
  return `file:${path.replaceAll("\\", "/")}`;
}

async function runMigration(legacyUrl: string, targetUrl: string) {
  const child = Bun.spawn(
    [process.execPath, join(import.meta.dir, "migrate-legacy.ts")],
    {
      cwd: join(import.meta.dir, ".."),
      env: {
        ...globalThis.process.env,
        DATABASE_URL: targetUrl,
        LEGACY_DATABASE_URL: legacyUrl,
        BETTER_AUTH_URL: "http://localhost:5000",
        BETTER_AUTH_SECRET:
          "legacy-integration-secret-longer-than-thirty-two-characters",
        CLIENT_URL: "http://localhost:3000",
        NODE_ENV: "test",
        DISABLE_EMAIL: "true",
        DISABLE_UPLOADS: "true",
      },
      stdout: "pipe",
      stderr: "pipe",
    },
  );
  const [exitCode, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  expect(stderr).not.toContain("reconciliation failed");
  expect(exitCode, `${stdout}\n${stderr}`).toBe(0);
  expect(stdout).toContain("Migration complete.");
}

test("migrates a representative v1 database end to end and is idempotent", async () => {
  const harnessDirectory = process.env.AVERMATE_LEGACY_TEST_DIRECTORY;
  if (!harnessDirectory) {
    const directory = mkdtempSync(join(tmpdir(), "avermate-legacy-test-"));
    try {
      const child = Bun.spawn(
        [
          process.execPath,
          "test",
          import.meta.path,
          "--timeout=30000",
          "--max-concurrency=1",
        ],
        {
          cwd: join(import.meta.dir, ".."),
          env: {
            ...process.env,
            AVERMATE_LEGACY_TEST_DIRECTORY: directory,
          },
          stdout: "pipe",
          stderr: "pipe",
        },
      );
      const [exitCode, stdout, stderr] = await Promise.all([
        child.exited,
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
      ]);
      expect(exitCode, `${stdout}\n${stderr}`).toBe(0);
    } finally {
      // The database work happens in the child process so all native SQLite
      // handles are gone before the parent removes its exact temp directory.
      rmSync(directory, {
        recursive: true,
        force: true,
        maxRetries: 10,
        retryDelay: 100,
      });
    }
    return;
  }

  const directory = harnessDirectory;
  const legacyUrl = databaseUrl(join(directory, "legacy.db"));
  const targetUrl = databaseUrl(join(directory, "rewrite.db"));
  const legacy = createClient({ url: legacyUrl });
  const target = createClient({ url: targetUrl });

  try {
    await legacy.executeMultiple(legacyFixture);
    const migrations = readdirSync(join(import.meta.dir, "../drizzle"))
      .filter((file) => /^\d{4}_.+\.sql$/.test(file))
      .sort()
      .map((file) =>
        readFileSync(join(import.meta.dir, "../drizzle", file), "utf8"),
      )
      .join("\n");
    await target.executeMultiple(migrations);
    legacy.close();
    target.close();

    await runMigration(legacyUrl, targetUrl);
    await runMigration(legacyUrl, targetUrl);

    const migrated = createClient({ url: targetUrl });
    try {
      const user = await migrated.execute(
        "select email, emailVerified, role from users where id = 'legacy-user'",
      );
      expect(user.rows[0]).toMatchObject({
        email: "legacy@example.com",
        emailVerified: 1,
        role: "admin",
      });

      const year = await migrated.execute(
        "select defaultOutOf from years where id = 'legacy-year'",
      );
      expect(Number(year.rows[0]?.defaultOutOf)).toBe(20);
      const subject = await migrated.execute(
        "select coefficient, kind, isMain from subjects where id = 'legacy-subject'",
      );
      expect(subject.rows[0]).toMatchObject({
        coefficient: 2,
        kind: "subject",
        isMain: 1,
      });
      const grade = await migrated.execute(
        "select value, outOf, coefficient, periodId from grades where id = 'legacy-grade'",
      );
      expect(grade.rows[0]).toMatchObject({
        value: 15.5,
        outOf: 20,
        coefficient: 1.5,
        periodId: "legacy-period",
      });

      const relations = await migrated.execute(`
          select
            (select count(*) from grade_components) as components,
            (select count(*) from custom_average_entries) as averageEntries,
            (select count(*) from year_review_views) as reviews,
            (select count(*) from announcements) as announcements,
            (select count(*) from announcement_views) as announcementViews,
            (select count(*) from dashboard_cards where yearId = 'legacy-year') as cards
        `);
      expect(relations.rows[0]).toMatchObject({
        components: 1,
        averageEntries: 1,
        reviews: 1,
        announcements: 1,
        announcementViews: 1,
      });
      expect(Number(relations.rows[0]?.cards)).toBeGreaterThan(0);

      const preferences = await migrated.execute(
        "select language, chartSettings from preferences where userId = 'legacy-user'",
      );
      expect(preferences.rows[0]?.language).toBe("fr");
      expect(String(preferences.rows[0]?.chartSettings)).toContain(
        '"trendSubdivisions":4',
      );

      const counts = await migrated.execute(`
          select
            (select count(*) from users where id = 'legacy-user') as users,
            (select count(*) from years where id = 'legacy-year') as years,
            (select count(*) from grades where id = 'legacy-grade') as grades
        `);
      expect(counts.rows[0]).toMatchObject({ users: 1, years: 1, grades: 1 });
    } finally {
      migrated.close();
    }
  } finally {
    try {
      legacy.close();
    } catch {
      // It was already closed before the child process opened the file.
    }
    try {
      target.close();
    } catch {
      // It was already closed before the child process opened the file.
    }
  }
}, 45_000);
