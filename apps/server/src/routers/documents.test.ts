import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createRouterClient } from "@orpc/server";
import { and, eq, inArray } from "drizzle-orm";
import JSZip from "jszip";
import { mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const databaseDirectory = mkdtempSync(
  join(tmpdir(), "avermate-documents-test-"),
);
process.env.DATABASE_URL = `file:${join(databaseDirectory, "documents.db")}`;
process.env.BETTER_AUTH_URL = "http://localhost:3000";
process.env.BETTER_AUTH_SECRET = "test-secret-that-is-at-least-32-chars";
process.env.CLIENT_URL = "http://localhost:3001";
process.env.NODE_ENV = "test";
process.env.DISABLE_EMAIL = "true";
process.env.DISABLE_UPLOADS = "true";
process.env.DISABLE_JOBS = "true";

const migrationDirectory = join(import.meta.dir, "../../drizzle");
const migration = readdirSync(migrationDirectory)
  .filter((file) => /^\d+.*\.sql$/.test(file))
  .sort((left, right) => left.localeCompare(right))
  .map((file) => readFileSync(join(migrationDirectory, file), "utf8"))
  .join("\n");
// Applying the complete migration history through 0060 and releasing its
// relational fixtures can take about 90s on slower Windows/libSQL runners.
const databaseHookTimeout = 120_000;

type AppRouter = typeof import("./index").appRouter;
type Api = ReturnType<
  typeof createRouterClient<AppRouter, Record<never, never>>
>;

let database: typeof import("../db").db;
let schema: typeof import("../db/schema");
let apiA: Api;
let apiB: Api;

const userA = "documents-user-a";
const userB = "documents-user-b";
const yearA = "documents-year-a";
const otherYearA = "documents-year-a-other";
const yearB = "documents-year-b";
const subjectA = "documents-subject-a";
const otherSubjectA = "documents-subject-a-other";
const folderA = "documents-folder-a";
const otherFolderA = "documents-folder-a-other";
const materialA = "documents-material-a";
const gradeA = "documents-grade-a";

function sessionFor(id: string) {
  const now = new Date("2026-08-01T00:00:00.000Z");
  return {
    user: {
      id,
      name: id,
      email: `${id}@example.com`,
      emailVerified: true,
      image: null,
      role: "user",
      banned: false,
      banReason: null,
      banExpires: null,
      createdAt: now,
      updatedAt: now,
    },
    session: {
      id: `session-${id}`,
      token: `token-${id}`,
      userId: id,
      expiresAt: new Date("2027-12-01T00:00:00.000Z"),
      createdAt: now,
      updatedAt: now,
      ipAddress: null,
      userAgent: null,
      impersonatedBy: null,
    },
  };
}

beforeAll(async () => {
  ({ db: database, schema } = await import("../db"));
  const { registerSharedTestDatabaseLifecycle } =
    await import("../testing/database-lifecycle");
  registerSharedTestDatabaseLifecycle(database.$client, {
    directories: [databaseDirectory],
  });
  const migrated = await database.$client.execute(
    "SELECT name FROM sqlite_master WHERE type='table' AND name='users'",
  );
  if (migrated.rows.length === 0) {
    await database.$client.executeMultiple(migration);
  }

  const now = new Date("2026-08-01T00:00:00.000Z");
  await database.insert(schema.users).values([
    {
      id: userA,
      name: "Documents A",
      email: "documents-a@example.com",
      emailVerified: true,
      role: "user",
      banned: false,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: userB,
      name: "Documents B",
      email: "documents-b@example.com",
      emailVerified: true,
      role: "user",
      banned: false,
      createdAt: now,
      updatedAt: now,
    },
  ]);
  await database.insert(schema.years).values([
    {
      id: yearA,
      name: "Documents year",
      startsAt: new Date("2026-09-01T00:00:00.000Z"),
      endsAt: new Date("2027-07-01T00:00:00.000Z"),
      userId: userA,
    },
    {
      id: otherYearA,
      name: "Other documents year",
      startsAt: new Date("2027-09-01T00:00:00.000Z"),
      endsAt: new Date("2028-07-01T00:00:00.000Z"),
      userId: userA,
    },
    {
      id: yearB,
      name: "Private documents year",
      startsAt: new Date("2026-09-01T00:00:00.000Z"),
      endsAt: new Date("2027-07-01T00:00:00.000Z"),
      userId: userB,
    },
  ]);
  await database.insert(schema.subjects).values([
    { id: subjectA, name: "Mathematics", yearId: yearA, userId: userA },
    {
      id: otherSubjectA,
      name: "Physics next year",
      yearId: otherYearA,
      userId: userA,
    },
  ]);
  await database.insert(schema.materialFolders).values([
    {
      id: folderA,
      name: "Chapter 1",
      yearId: yearA,
      userId: userA,
    },
    {
      id: otherFolderA,
      name: "Next year chapter",
      yearId: otherYearA,
      userId: userA,
    },
  ]);
  await database.insert(schema.materialDocuments).values({
    id: materialA,
    title: "Course source",
    sourceType: "text",
    textContent: "A source",
    yearId: yearA,
    userId: userA,
  });
  await database.insert(schema.grades).values({
    id: gradeA,
    name: "Exam",
    value: 16,
    outOf: 20,
    passedAt: now,
    subjectId: subjectA,
    yearId: yearA,
    userId: userA,
  });

  const { appRouter } = await import("./index");
  apiA = createRouterClient(appRouter, {
    context: { headers: new Headers(), session: sessionFor(userA) },
  });
  apiB = createRouterClient(appRouter, {
    context: { headers: new Headers(), session: sessionFor(userB) },
  });
}, databaseHookTimeout);

afterAll(async () => {
  await database
    .delete(schema.studyDocuments)
    .where(inArray(schema.studyDocuments.userId, [userA, userB]));
  await database
    .delete(schema.files)
    .where(inArray(schema.files.userId, [userA, userB]));
  await database
    .delete(schema.users)
    .where(inArray(schema.users.id, [userA, userB]));
}, databaseHookTimeout);

describe("study documents", () => {
  test("creates, lists and gets a fiche in the materials tree", async () => {
    const created = await apiA.documents.create({
      yearId: yearA,
      kind: "fiche",
      title: "Limits",
      folderId: folderA,
      subjectId: subjectA,
    });
    expect(created.document).toMatchObject({
      kind: "fiche",
      title: "Limits",
      bodyMarkdown: "",
      revision: 1,
      folderId: folderA,
      subjectId: subjectA,
      yearId: yearA,
      userId: userA,
    });
    expect(created.sources).toEqual([]);
    expect(
      (await apiA.documents.list({ yearId: yearA, folderId: folderA })).map(
        (document) => document.id,
      ),
    ).toContain(created.document!.id);
    expect(
      await apiA.documents.get({ documentId: created.document!.id }),
    ).toMatchObject({ document: { title: "Limits" }, sources: [] });
  });

  test("adopts front-matter metadata while preserving manually owned tags", async () => {
    const created = await apiA.documents.create({
      yearId: yearA,
      kind: "fiche",
      title: "Fallback title",
      bodyMarkdown: `---
title: Limits from metadata
subject: Mathematics
tags:
  - Analysis
  - Exam
---
# Limits`,
    });
    expect(created.document).toMatchObject({
      title: "Limits from metadata",
      subjectId: subjectA,
    });

    const initialTags = await database
      .select({
        id: schema.materialTags.id,
        name: schema.materialTags.name,
        origin: schema.materialTagLinks.origin,
      })
      .from(schema.materialTagLinks)
      .innerJoin(
        schema.materialTags,
        eq(schema.materialTags.id, schema.materialTagLinks.tagId),
      )
      .where(
        and(
          eq(schema.materialTagLinks.targetKind, "study"),
          eq(schema.materialTagLinks.targetId, created.document!.id),
        ),
      );
    expect(initialTags.map((tag) => [tag.name, tag.origin]).sort()).toEqual([
      ["Analysis", "frontmatter"],
      ["Exam", "frontmatter"],
    ]);

    const analysis = initialTags.find((tag) => tag.name === "Analysis")!;
    expect(
      await apiA.materials.tags.assign({
        tagId: analysis.id,
        targets: [{ kind: "study", id: created.document!.id }],
        assigned: true,
      }),
    ).toEqual({ count: 1 });

    const updated = await apiA.documents.update({
      documentId: created.document!.id,
      revision: created.document!.revision,
      bodyMarkdown: `---
title: Metadata wins again
subject: ${subjectA}
tags: [Exam, Revision]
---
# Limits`,
    });
    expect(updated.document).toMatchObject({
      title: "Metadata wins again",
      subjectId: subjectA,
      revision: 2,
    });
    const refreshedTags = await database
      .select({
        name: schema.materialTags.name,
        origin: schema.materialTagLinks.origin,
      })
      .from(schema.materialTagLinks)
      .innerJoin(
        schema.materialTags,
        eq(schema.materialTags.id, schema.materialTagLinks.tagId),
      )
      .where(
        and(
          eq(schema.materialTagLinks.targetKind, "study"),
          eq(schema.materialTagLinks.targetId, created.document!.id),
        ),
      );
    expect(refreshedTags.map((tag) => [tag.name, tag.origin]).sort()).toEqual([
      ["Analysis", "manual"],
      ["Exam", "frontmatter"],
      ["Revision", "frontmatter"],
    ]);

    await expect(
      apiA.documents.update({
        documentId: created.document!.id,
        revision: updated.document.revision,
        bodyMarkdown: "---\nsubject: Unknown subject\n---\n# Limits",
      }),
    ).rejects.toThrow("does not exist in this year");
  });

  test("transcludes owned sections with dependency, cycle and privacy fences", async () => {
    const source = await apiA.documents.create({
      yearId: yearA,
      title: "Reusable chapter",
      bodyMarkdown:
        "# Recurrence\nInduction content.\n## Detail\nNested detail.\n# Limits\nOther chapter.",
    });
    const composed = await apiA.documents.create({
      yearId: yearA,
      title: "Composed sheet",
      bodyMarkdown: `Before.\n@import "fiche:${source.document!.id}#R%C3%A9currence"\nAfter.`,
    });
    const rendered = await apiA.documents.get({
      documentId: composed.document!.id,
    });
    expect(rendered.renderedMarkdown).toContain("# Recurrence");
    expect(rendered.renderedMarkdown).toContain("Nested detail.");
    expect(rendered.renderedMarkdown).not.toContain("Other chapter.");
    expect(rendered.transclusionDependencies).toEqual([
      { documentId: source.document!.id, revision: 1 },
    ]);

    await apiA.documents.update({
      documentId: source.document!.id,
      revision: 1,
      bodyMarkdown: `# Recurrence\n@import "fiche:${composed.document!.id}"`,
    });
    expect(
      (await apiA.documents.get({ documentId: composed.document!.id }))
        .renderedMarkdown,
    ).toContain("cycle de documents");

    const privateSource = await apiB.documents.create({
      yearId: yearB,
      title: "Private source",
      bodyMarkdown: "Never reveal this sentence.",
    });
    const unauthorized = await apiA.documents.create({
      yearId: yearA,
      title: "Privacy fence",
      bodyMarkdown: `@import "fiche:${privateSource.document!.id}"`,
    });
    expect(unauthorized.renderedMarkdown).toContain(
      "document ou section indisponible",
    );
    expect(unauthorized.renderedMarkdown).not.toContain(
      "Never reveal this sentence",
    );
  });

  test("distinguishes root-folder filtering from the whole-year list", async () => {
    const root = await apiA.documents.create({
      yearId: yearA,
      title: "Root fiche",
    });
    const nested = await apiA.documents.create({
      yearId: yearA,
      title: "Nested fiche",
      folderId: folderA,
    });
    const atRoot = await apiA.documents.list({
      yearId: yearA,
      folderId: null,
    });
    expect(atRoot.some((document) => document.id === root.document!.id)).toBe(
      true,
    );
    expect(atRoot.some((document) => document.id === nested.document!.id)).toBe(
      false,
    );
    expect(
      (await apiA.documents.list({ yearId: yearA })).some(
        (document) => document.id === nested.document!.id,
      ),
    ).toBe(true);
  });

  test("updates content and replaces validated references atomically", async () => {
    const created = await apiA.documents.create({
      yearId: yearA,
      title: "Reference test",
    });
    const first = await apiA.documents.update({
      documentId: created.document!.id,
      revision: 1,
      title: "Reference test updated",
      bodyMarkdown: "# Summary",
      folderId: folderA,
      subjectId: subjectA,
      sources: [
        { kind: "subject", referenceId: subjectA },
        { kind: "materialDocument", referenceId: materialA },
        { kind: "grade", referenceId: gradeA },
      ],
    });
    expect(first.document).toMatchObject({
      title: "Reference test updated",
      bodyMarkdown: "# Summary",
      revision: 2,
    });
    expect(first.sources).toHaveLength(3);

    const second = await apiA.documents.update({
      documentId: created.document!.id,
      revision: 2,
      sources: [{ kind: "grade", referenceId: gradeA }],
    });
    expect(second.document.revision).toBe(3);
    expect(second.sources).toEqual([{ kind: "grade", referenceId: gradeA }]);
  });

  test("rejects stale revisions without changing content or references", async () => {
    const created = await apiA.documents.create({
      yearId: yearA,
      title: "Concurrent fiche",
    });
    await apiA.documents.update({
      documentId: created.document!.id,
      revision: 1,
      bodyMarkdown: "The accepted version",
      sources: [{ kind: "subject", referenceId: subjectA }],
    });
    await expect(
      apiA.documents.update({
        documentId: created.document!.id,
        revision: 1,
        bodyMarkdown: "A stale local version",
        sources: [{ kind: "materialDocument", referenceId: materialA }],
      }),
    ).rejects.toThrow("This fiche changed elsewhere — reload");
    expect(
      await apiA.documents.get({ documentId: created.document!.id }),
    ).toMatchObject({
      document: { bodyMarkdown: "The accepted version", revision: 2 },
      sources: [{ kind: "subject", referenceId: subjectA }],
    });
  });

  test("rejects folders, subjects and sources from another year", async () => {
    await expect(
      apiA.documents.create({
        yearId: yearA,
        title: "Wrong folder",
        folderId: otherFolderA,
      }),
    ).rejects.toThrow("same year");
    await expect(
      apiA.documents.create({
        yearId: yearA,
        title: "Wrong subject",
        subjectId: otherSubjectA,
      }),
    ).rejects.toThrow("same year");

    const created = await apiA.documents.create({
      yearId: yearA,
      title: "Wrong source",
    });
    await expect(
      apiA.documents.update({
        documentId: created.document!.id,
        revision: 1,
        sources: [{ kind: "subject", referenceId: otherSubjectA }],
      }),
    ).rejects.toThrow("same year");
  });

  test("enforces the Markdown limit in UTF-8 bytes", async () => {
    const oversized = "é".repeat(256 * 1024 + 1);
    await expect(
      apiA.documents.create({
        yearId: yearA,
        title: "Oversized at creation",
        bodyMarkdown: oversized,
      }),
    ).rejects.toThrow("512 KiB");
    const created = await apiA.documents.create({
      yearId: yearA,
      title: "Size fence",
    });
    await expect(
      apiA.documents.update({
        documentId: created.document!.id,
        revision: 1,
        bodyMarkdown: oversized,
      }),
    ).rejects.toThrow("512 KiB");
    expect(
      (await apiA.documents.get({ documentId: created.document!.id })).document
        .revision,
    ).toBe(1);
  });

  test("validates bounded, uniquely identified mind-map trees", async () => {
    const created = await apiA.documents.create({
      yearId: yearA,
      kind: "mindmap",
      title: "Sequence map",
      metaJson: {
        version: 1,
        root: {
          id: "sequences",
          label: "Sequences",
          children: [
            { id: "limits", label: "Limits" },
            { id: "monotonicity", label: "Monotonicity" },
          ],
        },
      },
    });
    expect(created.document).toMatchObject({
      kind: "mindmap",
      bodyMarkdown: "",
      metaJson: {
        version: 1,
        root: {
          id: "sequences",
          children: [{ id: "limits" }, { id: "monotonicity" }],
        },
      },
    });
    const updated = await apiA.documents.update({
      documentId: created.document!.id,
      revision: 1,
      metaJson: {
        version: 1,
        root: { id: "sequences", label: "Convergent sequences" },
      },
    });
    expect(updated.document).toMatchObject({
      revision: 2,
      metaJson: {
        version: 1,
        root: { id: "sequences", label: "Convergent sequences" },
      },
    });

    await expect(
      apiA.documents.create({
        yearId: yearA,
        kind: "mindmap",
        title: "Markdown mismatch",
        bodyMarkdown: "# This belongs in metaJson",
        metaJson: {
          version: 1,
          root: { id: "root", label: "Root" },
        },
      }),
    ).rejects.toThrow("Markdown body must be empty");
    await expect(
      apiA.documents.create({
        yearId: yearA,
        kind: "mindmap",
        title: "Duplicate ids",
        metaJson: {
          version: 1,
          root: {
            id: "same",
            label: "Root",
            children: [{ id: "same", label: "Child" }],
          },
        },
      }),
    ).rejects.toThrow("duplicated");
    await expect(
      apiA.documents.create({
        yearId: yearA,
        kind: "mindmap",
        title: "Oversized label",
        metaJson: {
          version: 1,
          root: { id: "root", label: "x".repeat(121) },
        },
      }),
    ).rejects.toThrow();

    type DeepNode = {
      id: string;
      label: string;
      children?: DeepNode[];
    };
    let deepRoot: DeepNode = { id: "depth-9", label: "Depth 9" };
    for (let depth = 8; depth >= 1; depth -= 1) {
      deepRoot = {
        id: `depth-${depth}`,
        label: `Depth ${depth}`,
        children: [deepRoot],
      };
    }
    await expect(
      apiA.documents.create({
        yearId: yearA,
        kind: "mindmap",
        title: "Too deep",
        metaJson: { version: 1, root: deepRoot },
      }),
    ).rejects.toThrow("8 levels");

    // This stays below the metadata byte cap but used to overflow Zod's call
    // stack before the explicit depth validator got a chance to run.
    let adversarialRoot: DeepNode = {
      id: `n${(10_999).toString(36)}`,
      label: "n",
    };
    for (let depth = 10_998; depth >= 0; depth -= 1) {
      adversarialRoot = {
        id: `n${depth.toString(36)}`,
        label: "n",
        children: [adversarialRoot],
      };
    }
    await expect(
      apiA.documents.create({
        yearId: yearA,
        kind: "mindmap",
        title: "Adversarial depth",
        metaJson: { version: 1, root: adversarialRoot },
      }),
    ).rejects.toThrow("8 levels");
    await expect(
      apiA.documents.create({
        yearId: yearA,
        kind: "mindmap",
        title: "Too many nodes",
        metaJson: {
          version: 1,
          root: {
            id: "root",
            label: "Root",
            children: Array.from({ length: 500 }, (_, index) => ({
              id: `child-${index}`,
              label: `Child ${index}`,
            })),
          },
        },
      }),
    ).rejects.toThrow("500 nodes");
    await expect(
      apiA.documents.create({
        yearId: yearA,
        kind: "mindmap",
        title: "Oversized metadata",
        metaJson: {
          version: 1,
          root: {
            id: "root",
            label: "Root",
            children: Array.from({ length: 499 }, (_, index) => ({
              id: `large-child-${index}`,
              label: `Child ${index}`,
              note: "x".repeat(1_100),
            })),
          },
        },
      }),
    ).rejects.toThrow("metadata must be 512 KiB or smaller");
  });

  test("runs revision-snapshotted quizzes without revealing answers early", async () => {
    await expect(
      apiA.documents.create({
        yearId: yearA,
        kind: "quiz",
        title: "Invalid quiz",
        metaJson: {
          version: 1,
          questions: [
            {
              kind: "mcq",
              prompt: "Pick one",
              choices: ["A", "B"],
              answers: [2],
            },
          ],
        },
      }),
    ).rejects.toThrow("Input validation failed");

    const created = await apiA.documents.create({
      yearId: yearA,
      kind: "quiz",
      title: "Retrieval practice",
      subjectId: subjectA,
      metaJson: {
        version: 1,
        questions: [
          {
            kind: "mcq",
            prompt: "Which value is even?",
            choices: ["3", "4", "5"],
            answers: [1],
            why: "Four is divisible by two.",
          },
          { kind: "open", prompt: "Capital of France?", expected: "Paris" },
          {
            kind: "cloze",
            text: "A convergent monotone sequence is … and …",
            blanks: ["monotone", "bounded"],
          },
        ],
      },
    });
    const reader = await apiA.documents.get({
      documentId: created.document!.id,
    });
    const readerQuestions = [
      {
        kind: "mcq" as const,
        prompt: "Which value is even?",
        choices: ["3", "4", "5"],
        answerCount: 1,
      },
      { kind: "open" as const, prompt: "Capital of France?" },
      {
        kind: "cloze" as const,
        text: "A convergent monotone sequence is … and …",
        blankCount: 2,
      },
    ];
    expect(reader.document.metaJson).toEqual({
      version: 1,
      questions: readerQuestions,
    });
    const listed = await apiA.documents.list({ yearId: yearA });
    const listedQuiz = listed.find(
      (document) => document.id === created.document!.id,
    );
    expect(listedQuiz?.metaJson).toEqual(reader.document.metaJson);
    for (const projection of [reader.document, listedQuiz]) {
      const serialized = JSON.stringify(projection);
      expect(serialized).not.toContain('"answers"');
      expect(serialized).not.toContain('"expected"');
      expect(serialized).not.toContain('"blanks"');
      expect(serialized).not.toContain('"why"');
    }

    const authoring = await apiA.documents.getForEdit({
      documentId: created.document!.id,
    });
    expect(JSON.stringify(authoring.document.metaJson)).toContain('"answers"');
    expect(JSON.stringify(authoring.document.metaJson)).toContain('"expected"');
    expect(JSON.stringify(authoring.document.metaJson)).toContain('"blanks"');
    expect(JSON.stringify(authoring.document.metaJson)).toContain('"why"');
    await expect(
      apiB.documents.getForEdit({ documentId: created.document!.id }),
    ).rejects.toThrow("Study document not found");

    const started = await apiA.documents.quiz.start({
      documentId: created.document!.id,
    });
    expect(started.sourceRevision).toBe(1);
    expect(started.questions).toEqual(readerQuestions);
    expect(JSON.stringify(started)).not.toContain('"expected"');
    expect(JSON.stringify(started)).not.toContain('"answers"');
    expect(JSON.stringify(started)).not.toContain('"blanks"');
    expect(JSON.stringify(started)).not.toContain('"why"');

    await apiA.documents.update({
      documentId: created.document!.id,
      revision: 1,
      metaJson: {
        version: 1,
        questions: [
          { kind: "open", prompt: "Capital of France?", expected: "Lyon" },
        ],
      },
    });
    const completed = await apiA.documents.quiz.complete({
      attemptId: started.id,
      answers: [[1], "  PARÍS  ", ["monotone", "bounded"]],
    });
    expect(completed).toMatchObject({ score: 3, outOf: 3 });
    expect(completed.feedback).toEqual([
      {
        correct: true,
        reviewRequired: false,
        reviewKind: null,
        expected: [1],
        why: "Four is divisible by two.",
      },
      {
        correct: true,
        reviewRequired: false,
        reviewKind: null,
        expected: "Paris",
        why: null,
      },
      {
        correct: true,
        reviewRequired: false,
        reviewKind: null,
        expected: ["monotone", "bounded"],
        why: null,
      },
    ]);
    expect(
      await apiA.documents.quiz.list({ documentId: created.document!.id }),
    ).toEqual([
      expect.objectContaining({
        id: started.id,
        sourceRevision: 1,
        score: 3,
        outOf: 3,
      }),
    ]);
    await expect(
      apiA.documents.quiz.complete({
        attemptId: started.id,
        answers: [[1], "Paris", ["monotone", "bounded"]],
      }),
    ).rejects.toThrow("already complete");
    await expect(
      apiB.documents.quiz.start({ documentId: created.document!.id }),
    ).rejects.toThrow();
  });

  test("validates slide metadata and counts separators outside code fences", async () => {
    const { splitMarkdownSlides } =
      await import("../lib/study-document-content");
    const body = [
      "# First",
      "Intro",
      "---",
      "## Code",
      "```md",
      "---",
      "```",
      "---",
      "# Last",
    ].join("\n");
    expect(splitMarkdownSlides(body)).toHaveLength(3);
    expect(
      splitMarkdownSlides(
        [
          "# List fence",
          "- ```md",
          "  # This is code, not a title",
          "  ~~~",
          "  ---",
          "  ```",
          "---",
          "# Second slide",
        ].join("\n"),
      ),
    ).toHaveLength(2);
    const created = await apiA.documents.create({
      yearId: yearA,
      kind: "slides",
      title: "Three slides",
      bodyMarkdown: body,
      metaJson: { version: 1 },
    });
    expect(created.document).toMatchObject({
      kind: "slides",
      metaJson: { version: 1 },
    });
    await expect(
      apiA.documents.create({
        yearId: yearA,
        kind: "slides",
        title: "Missing slides metadata",
        bodyMarkdown: "# One slide",
      }),
    ).rejects.toThrow("requires metaJson");
    await expect(
      apiA.documents.create({
        yearId: yearA,
        kind: "slides",
        title: "Too many slides",
        bodyMarkdown: Array.from(
          { length: 101 },
          (_, index) => `# Slide ${index + 1}`,
        ).join("\n---\n"),
        metaJson: { version: 1 },
      }),
    ).rejects.toThrow("100 slides");
  });

  test("exports real PPTX bytes and fences jobs by slide revision", async () => {
    const { PPTX_MIME_TYPE, runExportDocumentPptxJob } =
      await import("../jobs/export-document-pptx");
    const created = await apiA.documents.create({
      yearId: yearA,
      kind: "slides",
      title: "Convergence lesson",
      bodyMarkdown: [
        "# Convergent sequences",
        "- Definition",
        "- Example",
        "---",
        "## A short proof",
        "```ts",
        "const bounded = true;",
        "```",
        "---",
        "# Apply the theorem",
        "Use the monotone convergence theorem.",
      ].join("\n"),
      metaJson: { version: 1 },
    });
    const first = await apiA.documents.exportPptx({
      documentId: created.document!.id,
    });
    const replay = await apiA.documents.exportPptx({
      documentId: created.document!.id,
    });
    expect(replay.jobId).toBe(first.jobId);

    let generatedBytes = new Uint8Array();
    const result = await runExportDocumentPptxJob(
      { documentId: created.document!.id, revision: 1 },
      {
        storeFile: async ({ userId, purpose, file }) => {
          expect(purpose).toBe("document-export");
          expect(file.type).toBe(PPTX_MIME_TYPE);
          generatedBytes = new Uint8Array(await file.arrayBuffer());
          const [stored] = await database
            .insert(schema.files)
            .values({
              provider: "test",
              storageKey: `document-export-test-${crypto.randomUUID()}`,
              url: "https://example.invalid/convergence.pptx",
              mimeType: file.type,
              byteSize: file.size,
              purpose,
              userId,
            })
            .returning();
          return stored!;
        },
      },
    );
    expect(generatedBytes.byteLength).toBeGreaterThan(10_000);
    expect([...generatedBytes.slice(0, 2)]).toEqual([0x50, 0x4b]);
    expect(result).toMatchObject({
      byteSize: generatedBytes.byteLength,
      revision: 1,
    });
    expect(result).not.toHaveProperty("url");
    expect(
      await apiA.documents.downloadPptx({
        documentId: created.document!.id,
        revision: 1,
      }),
    ).toMatchObject({
      url: "https://example.invalid/convergence.pptx",
      mimeType: PPTX_MIME_TYPE,
      byteSize: generatedBytes.byteLength,
    });
    await expect(
      apiB.documents.downloadPptx({
        documentId: created.document!.id,
        revision: 1,
      }),
    ).rejects.toThrow();
    expect(
      await database
        .select()
        .from(schema.files)
        .where(eq(schema.files.id, result.fileId)),
    ).toHaveLength(1);

    const updated = await apiA.documents.update({
      documentId: created.document!.id,
      revision: 1,
      bodyMarkdown: "# Revised deck",
    });
    const next = await apiA.documents.exportPptx({
      documentId: created.document!.id,
    });
    expect(next.revision).toBe(updated.document.revision);
    expect(next.jobId).not.toBe(first.jobId);
    await expect(
      runExportDocumentPptxJob({
        documentId: created.document!.id,
        revision: 99,
      }),
    ).rejects.toThrow("changed before export");
    expect(
      await runExportDocumentPptxJob({
        documentId: created.document!.id,
        revision: 1,
      }),
    ).toEqual(result);

    const fiche = await apiA.documents.create({
      yearId: yearA,
      title: "Not slides",
    });
    await expect(
      apiA.documents.exportPptx({ documentId: fiche.document!.id }),
    ).rejects.toThrow("Only slide decks");
  });

  test("preserves dense slide content, parses fences and emits XML 1.0 text", async () => {
    const {
      buildDocumentPptxPages,
      generateDocumentPptx,
      sanitizeXmlText,
      wrapPptxLine,
    } = await import("../jobs/export-document-pptx");
    const longTitle = `Readable ${"long title ".repeat(13)}`.trim();
    const bullets = Array.from(
      { length: 14 },
      (_, index) => `Bullet ${String(index + 1).padStart(2, "0")}`,
    );
    const body = [
      `# ${longTitle}`,
      ...bullets.map((bullet) => `- ${bullet}`),
      "- Alpha\u0001Beta\u000bGamma",
      "- ```md",
      "  # Heading inside code",
      "  ~~~",
      "  ---",
      "  ```",
    ].join("\n");

    const pages = buildDocumentPptxPages(body);
    expect(wrapPptxLine(longTitle, 56)).toEqual([
      "Readable long title long title long title long title",
      "long title long title long title long title long title",
      "long title long title long title long title",
    ]);
    expect(pages.length).toBeGreaterThan(1);
    expect(pages[0]?.title).toBe(longTitle);
    expect(pages.every((page) => page.title === longTitle)).toBe(true);
    const visible = pages.flatMap((page) =>
      page.lines.map((line) => line.text),
    );
    for (const bullet of bullets) {
      expect(visible.some((line) => line.includes(bullet))).toBe(true);
    }
    expect(visible.some((line) => line.includes("# Heading inside code"))).toBe(
      true,
    );
    expect(visible).toContain("  ~~~");
    expect(visible).toContain("  ---");
    expect(visible.join("\n")).toContain("AlphaBetaGamma");
    expect(sanitizeXmlText("ok\u0000\u0008\ud800done")).toBe("okdone");

    const pathologicalTitle = `${"heading ".repeat(30)}tail-marker`;
    const titlePages = buildDocumentPptxPages(`# ${pathologicalTitle}`);
    expect(wrapPptxLine(titlePages[0]!.title, 56).length).toBeLessThanOrEqual(
      3,
    );
    expect(
      titlePages.some((page) =>
        page.lines.some((line) => line.text.includes("tail-marker")),
      ),
    ).toBe(true);

    const archive = await JSZip.loadAsync(await generateDocumentPptx(body));
    const slideEntries = Object.entries(archive.files).filter(
      ([name, entry]) =>
        /^ppt\/slides\/slide\d+\.xml$/.test(name) && !entry.dir,
    );
    expect(slideEntries.length).toBe(pages.length);
    const slideXml = (
      await Promise.all(slideEntries.map(([, entry]) => entry.async("string")))
    ).join("\n");
    for (const bullet of bullets) expect(slideXml).toContain(bullet);
    expect(slideXml).toContain("AlphaBetaGamma");
    expect(slideXml).not.toContain("\u0001");
    expect(slideXml).not.toContain("\u000b");
  });

  test("rejects an excessive continuation deck quickly instead of truncating it", async () => {
    const { generateDocumentPptx, PPTX_MAX_GENERATED_SLIDES } =
      await import("../jobs/export-document-pptx");
    const body = `# Dense deck\n${"word ".repeat(100_000)}final-unique-marker`;
    const startedAt = performance.now();
    await expect(generateDocumentPptx(body)).rejects.toThrow(
      `at most ${PPTX_MAX_GENERATED_SLIDES} generated slides`,
    );
    const elapsed = performance.now() - startedAt;
    expect(elapsed).toBeLessThan(3_000);
  });

  test("adopts one export for concurrent executions and cleans up the loser", async () => {
    const { PPTX_MIME_TYPE, runExportDocumentPptxJob } =
      await import("../jobs/export-document-pptx");
    const created = await apiA.documents.create({
      yearId: yearA,
      kind: "slides",
      title: "x".repeat(160),
      bodyMarkdown: "# Idempotent export\n- One result",
      metaJson: { version: 1 },
    });
    const storedIds: string[] = [];
    const deletedIds: string[] = [];
    let arrived = 0;
    let release!: () => void;
    const bothStored = new Promise<void>((resolve) => {
      release = resolve;
    });
    const store: typeof import("../lib/storage").storeFile = async (input) => {
      expect(input.purpose).toBe("document-export");
      expect(input.file.type).toBe(PPTX_MIME_TYPE);
      expect(input.file.name.endsWith(".pptx")).toBe(true);
      expect(input.nameHint?.endsWith(".pptx")).toBe(true);
      expect(input.file.name.length).toBeLessThanOrEqual(160);
      const [stored] = await database
        .insert(schema.files)
        .values({
          storageKey: `concurrent-export-${crypto.randomUUID()}`,
          url: `https://example.invalid/${crypto.randomUUID()}.pptx`,
          mimeType: input.file.type,
          byteSize: input.file.size,
          purpose: input.purpose,
          userId: input.userId,
        })
        .returning();
      storedIds.push(stored!.id);
      arrived += 1;
      if (arrived === 2) release();
      await bothStored;
      return stored!;
    };
    const remove: typeof import("../lib/storage").deleteFile = async (
      ownerId,
      fileId,
    ) => {
      deletedIds.push(fileId);
      const [deleted] = await database
        .update(schema.files)
        .set({ status: "deleted", updatedAt: new Date() })
        .where(
          and(eq(schema.files.id, fileId), eq(schema.files.userId, ownerId)),
        )
        .returning();
      return deleted!;
    };
    const payload = { documentId: created.document!.id, revision: 1 };
    const [left, right] = await Promise.all([
      runExportDocumentPptxJob(payload, {
        storeFile: store,
        deleteFile: remove,
      }),
      runExportDocumentPptxJob(payload, {
        storeFile: store,
        deleteFile: remove,
      }),
    ]);
    expect(left).toEqual(right);
    expect(storedIds).toHaveLength(2);
    expect(deletedIds).toHaveLength(1);
    expect(deletedIds).not.toContain(left.fileId);
    expect(
      await database
        .select()
        .from(schema.studyDocumentExports)
        .where(
          and(
            eq(schema.studyDocumentExports.documentId, created.document!.id),
            eq(schema.studyDocumentExports.revision, 1),
          ),
        ),
    ).toHaveLength(1);
    const storedRows = await database
      .select({ id: schema.files.id, status: schema.files.status })
      .from(schema.files)
      .where(inArray(schema.files.id, storedIds));
    expect(storedRows.filter((file) => file.status === "stored")).toEqual([
      { id: left.fileId, status: "stored" },
    ]);
    expect(storedRows.filter((file) => file.status === "deleted")).toHaveLength(
      1,
    );

    let replayStores = 0;
    expect(
      await runExportDocumentPptxJob(payload, {
        storeFile: async (input) => {
          replayStores += 1;
          return store(input);
        },
      }),
    ).toEqual(left);
    expect(replayStores).toBe(0);
  });

  test("reconciles a lost acknowledgement after adopting an export", async () => {
    const { runExportDocumentPptxJob } =
      await import("../jobs/export-document-pptx");
    const created = await apiA.documents.create({
      yearId: yearA,
      kind: "slides",
      title: "Lost acknowledgement",
      bodyMarkdown: "# Durable result\n- Keep this file",
      metaJson: { version: 1 },
    });
    let storedId = "";
    let cleanupCalls = 0;
    const result = await runExportDocumentPptxJob(
      { documentId: created.document!.id, revision: 1 },
      {
        storeFile: async (input) => {
          const [stored] = await database
            .insert(schema.files)
            .values({
              storageKey: `lost-ack-export-${crypto.randomUUID()}`,
              url: "https://example.invalid/lost-ack.pptx",
              mimeType: input.file.type,
              byteSize: input.file.size,
              purpose: input.purpose,
              userId: input.userId,
            })
            .returning();
          storedId = stored!.id;
          return stored!;
        },
        deleteFile: async () => {
          cleanupCalls += 1;
          throw new Error("An adopted file must never be cleaned up");
        },
        afterAdopt: async () => {
          throw new Error("simulated lost database acknowledgement");
        },
      },
    );
    expect(result.fileId).toBe(storedId);
    expect(cleanupCalls).toBe(0);
    expect(
      await database
        .select()
        .from(schema.studyDocumentExports)
        .where(
          and(
            eq(schema.studyDocumentExports.documentId, created.document!.id),
            eq(schema.studyDocumentExports.revision, 1),
          ),
        ),
    ).toHaveLength(1);
    expect(
      await database
        .select({ status: schema.files.status })
        .from(schema.files)
        .where(eq(schema.files.id, storedId)),
    ).toEqual([{ status: "stored" }]);
  });

  test("honors an already-lost export lease before generating or uploading", async () => {
    const { runExportDocumentPptxJob } =
      await import("../jobs/export-document-pptx");
    const created = await apiA.documents.create({
      yearId: yearA,
      kind: "slides",
      title: "Cancelled export",
      bodyMarkdown: "# Cancelled",
      metaJson: { version: 1 },
    });
    const controller = new AbortController();
    controller.abort();
    let stored = false;
    await expect(
      runExportDocumentPptxJob(
        { documentId: created.document!.id, revision: 1 },
        {
          signal: controller.signal,
          storeFile: async () => {
            stored = true;
            throw new Error("must not upload");
          },
        },
      ),
    ).rejects.toThrow();
    expect(stored).toBe(false);
  });

  test("does not reveal or mutate another account's fiche", async () => {
    const created = await apiA.documents.create({
      yearId: yearA,
      title: "Private fiche",
    });
    await expect(
      apiB.documents.get({ documentId: created.document!.id }),
    ).rejects.toThrow("Study document not found");
    await expect(
      apiB.documents.update({
        documentId: created.document!.id,
        revision: 1,
        title: "Stolen",
      }),
    ).rejects.toThrow("Study document not found");
    await expect(
      apiB.documents.delete({ documentId: created.document!.id }),
    ).rejects.toThrow("Study document not found");
  });

  test("legacy fiche deletion trashes first, then cascades on purge", async () => {
    const created = await apiA.documents.create({
      yearId: yearA,
      title: "Delete fiche",
    });
    await apiA.documents.update({
      documentId: created.document!.id,
      revision: 1,
      sources: [{ kind: "subject", referenceId: subjectA }],
    });
    await apiA.documents.delete({ documentId: created.document!.id });
    const [trashed] = await database
      .select({ deletedAt: schema.studyDocuments.deletedAt })
      .from(schema.studyDocuments)
      .where(eq(schema.studyDocuments.id, created.document!.id));
    expect(trashed?.deletedAt).toBeInstanceOf(Date);
    expect(
      await database
        .select()
        .from(schema.studyDocumentReferences)
        .where(
          eq(schema.studyDocumentReferences.documentId, created.document!.id),
        ),
    ).toHaveLength(1);

    await apiA.documents.delete({ documentId: created.document!.id });
    expect(
      await database
        .select()
        .from(schema.studyDocumentReferences)
        .where(
          eq(schema.studyDocumentReferences.documentId, created.document!.id),
        ),
    ).toHaveLength(0);
    await expect(
      apiA.documents.get({ documentId: created.document!.id }),
    ).rejects.toThrow("Study document not found");
  });

  test("deletes exported PPTX references before strict durable provider cleanup", async () => {
    const created = await apiA.documents.create({
      yearId: yearA,
      kind: "slides",
      title: "Delete exported slides",
      bodyMarkdown: "# Delete me",
      metaJson: { version: 1 },
    });
    const [file] = await database
      .insert(schema.files)
      .values({
        storageKey: `document-delete-${crypto.randomUUID()}`,
        url: `https://example.invalid/${crypto.randomUUID()}.pptx`,
        mimeType:
          "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        byteSize: 42,
        purpose: "document-export",
        provider: "s3",
        userId: userA,
      })
      .returning();
    await database.insert(schema.studyDocumentExports).values({
      documentId: created.document!.id,
      revision: created.document!.revision,
      fileId: file!.id,
      userId: userA,
    });
    const { createDocumentsRouter } = await import("./documents");
    const strictFailures: string[] = [];
    const custom = createRouterClient(
      {
        documents: createDocumentsRouter({
          deleteFile: async (userId, fileId, options) => {
            expect(userId).toBe(userA);
            expect(options?.deferOnProviderFailure).toBe(false);
            strictFailures.push(fileId);
            throw new Error("Storage provider unavailable");
          },
        }),
      },
      { context: { headers: new Headers(), session: sessionFor(userA) } },
    );
    await apiA.documents.delete({ documentId: created.document!.id });
    await expect(
      custom.documents.delete({ documentId: created.document!.id }),
    ).resolves.toEqual({ ok: true });
    expect(strictFailures).toEqual([file!.id]);
    expect(
      await database
        .select()
        .from(schema.studyDocumentExports)
        .where(
          eq(schema.studyDocumentExports.documentId, created.document!.id),
        ),
    ).toHaveLength(0);
    expect(
      (
        await database
          .select()
          .from(schema.files)
          .where(eq(schema.files.id, file!.id))
      )[0]?.status,
    ).toBe("stored");
    const cleanupRows = await database
      .select()
      .from(schema.jobs)
      .where(
        and(
          eq(schema.jobs.kind, "cleanup.unownedFile"),
          eq(schema.jobs.userId, userA),
        ),
      );
    const deleteCleanup = cleanupRows.find(
      (job) =>
        (job.payload as { fileId?: unknown } | null)?.fileId === file!.id,
    );
    expect(deleteCleanup).toMatchObject({
      status: "queued",
      maxAttempts: 6,
      payload: { userId: userA, fileId: file!.id },
    });

    const { runCleanupUnownedFileJob } = await import("../jobs/ingest-link");
    await expect(
      runCleanupUnownedFileJob(deleteCleanup!.payload, {
        deleteFile: async (_userId, _fileId, options) => {
          expect(options?.deferOnProviderFailure).toBe(false);
          throw new Error("provider still unavailable");
        },
      }),
    ).rejects.toThrow("provider still unavailable");
    expect(
      (
        await database
          .select()
          .from(schema.files)
          .where(eq(schema.files.id, file!.id))
      )[0]?.status,
    ).toBe("stored");
    await expect(
      runCleanupUnownedFileJob(deleteCleanup!.payload, {
        deleteFile: async (userId, fileId, options) => {
          expect(options?.deferOnProviderFailure).toBe(false);
          const [deleted] = await database
            .update(schema.files)
            .set({ status: "deleted", updatedAt: new Date() })
            .where(
              and(eq(schema.files.id, fileId), eq(schema.files.userId, userId)),
            )
            .returning();
          return deleted!;
        },
      }),
    ).resolves.toMatchObject({ deleted: true });
    expect(
      (
        await database
          .select()
          .from(schema.files)
          .where(eq(schema.files.id, file!.id))
      )[0]?.status,
    ).toBe("deleted");
  });

  test("retries the atomic delete snapshot when an export adopts concurrently", async () => {
    const created = await apiA.documents.create({
      yearId: yearA,
      kind: "slides",
      title: "Concurrent export delete",
      bodyMarkdown: "# Race",
      metaJson: { version: 1 },
    });
    const [file] = await database
      .insert(schema.files)
      .values({
        storageKey: `document-race-${crypto.randomUUID()}`,
        url: `https://example.invalid/${crypto.randomUUID()}.pptx`,
        mimeType:
          "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        byteSize: 42,
        purpose: "document-export",
        provider: "test",
        userId: userA,
      })
      .returning();
    let adopted = false;
    let snapshotCalls = 0;
    const { createDocumentsRouter } = await import("./documents");
    const custom = createRouterClient(
      {
        documents: createDocumentsRouter({
          afterDeleteSnapshot: async () => {
            snapshotCalls += 1;
            if (adopted) return;
            adopted = true;
            await database.insert(schema.studyDocumentExports).values({
              documentId: created.document!.id,
              revision: created.document!.revision,
              fileId: file!.id,
              userId: userA,
            });
          },
          deleteFile: async (userId, fileId) => {
            const [deleted] = await database
              .update(schema.files)
              .set({ status: "deleted", updatedAt: new Date() })
              .where(
                and(
                  eq(schema.files.id, fileId),
                  eq(schema.files.userId, userId),
                ),
              )
              .returning();
            return deleted!;
          },
        }),
      },
      { context: { headers: new Headers(), session: sessionFor(userA) } },
    );
    await apiA.documents.delete({ documentId: created.document!.id });
    await custom.documents.delete({ documentId: created.document!.id });
    expect(snapshotCalls).toBeGreaterThanOrEqual(2);
    expect(
      (
        await database
          .select()
          .from(schema.files)
          .where(eq(schema.files.id, file!.id))
      )[0]?.status,
    ).toBe("deleted");
    expect(
      await database
        .select()
        .from(schema.studyDocuments)
        .where(eq(schema.studyDocuments.id, created.document!.id)),
    ).toHaveLength(0);
  });

  test("queues a LaTeX revision and exposes its latest PDF and compiler log", async () => {
    const created = await apiA.documents.create({
      yearId: yearA,
      kind: "latex",
      title: "Bounded LaTeX",
      bodyMarkdown:
        "\\documentclass{article}\\begin{document}Hello\\end{document}",
      metaJson: { engine: "xelatex", entry: "main.tex" },
    });
    const queued = await apiA.documents.build({
      documentId: created.document!.id,
      revision: created.document!.revision,
    });
    const [job] = await database
      .select()
      .from(schema.jobs)
      .where(
        and(
          eq(schema.jobs.kind, "build.documentLatex"),
          eq(schema.jobs.idempotencyKey, queued.buildId),
        ),
      );
    expect(job).toMatchObject({
      payload: { buildId: queued.buildId },
      status: "queued",
    });
    expect(
      await apiA.documents.builds.latest({
        documentId: created.document!.id,
      }),
    ).toMatchObject({
      id: queued.buildId,
      status: "queued",
      pdfUrl: null,
    });
    await expect(
      apiB.documents.builds.latest({ documentId: created.document!.id }),
    ).rejects.toThrow();

    const pdfUrl = `https://example.invalid/${crypto.randomUUID()}.pdf`;
    const [pdf] = await database
      .insert(schema.files)
      .values({
        storageKey: `latex-api-${crypto.randomUUID()}`,
        url: pdfUrl,
        mimeType: "application/pdf",
        byteSize: 42,
        purpose: "latex-build",
        provider: "test",
        previewStatus: "unsupported",
        userId: userA,
      })
      .returning();
    await database
      .update(schema.studyDocumentBuilds)
      .set({
        status: "succeeded",
        pdfFileId: pdf!.id,
        log: "Tectonic completed",
        updatedAt: new Date(),
      })
      .where(eq(schema.studyDocumentBuilds.id, queued.buildId));

    expect(
      await apiA.documents.builds.latest({
        documentId: created.document!.id,
      }),
    ).toMatchObject({
      id: queued.buildId,
      status: "succeeded",
      pdfFileId: pdf!.id,
      pdfUrl,
    });
    expect(
      await apiA.documents.builds.log({ buildId: queued.buildId }),
    ).toEqual({ log: "Tectonic completed" });
  });

  test("queues one idempotent podcast artifact for the current fiche revision", async () => {
    const created = await apiA.documents.create({
      yearId: yearA,
      kind: "fiche",
      title: "Podcast source",
      bodyMarkdown: "# Théorème\n\nToute suite croissante majorée converge.",
      metaJson: {},
    });
    const { createDocumentsRouter } = await import("./documents");
    const custom = createRouterClient(
      {
        documents: createDocumentsRouter({
          textToSpeechEnabled: async (userId) => {
            expect(userId).toBe(userA);
            return true;
          },
        }),
      },
      { context: { headers: new Headers(), session: sessionFor(userA) } },
    );
    const first = await custom.documents.artifacts.generate({
      documentId: created.document!.id,
      kind: "audio",
      variant: "default",
    });
    const replay = await custom.documents.artifacts.generate({
      documentId: created.document!.id,
      kind: "audio",
      variant: "default",
    });
    expect(replay.artifactId).toBe(first.artifactId);
    const artifacts = await custom.documents.artifacts.list({
      documentId: created.document!.id,
    });
    expect(artifacts).toHaveLength(1);
    expect(artifacts[0]).toMatchObject({
      id: first.artifactId,
      kind: "audio",
      variant: "default",
      sourceRevision: created.document!.revision,
      status: "queued",
      stale: false,
    });
    const jobs = await database
      .select()
      .from(schema.jobs)
      .where(
        and(
          eq(schema.jobs.kind, "export.documentArtifact"),
          eq(schema.jobs.idempotencyKey, first.artifactId),
        ),
      );
    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toMatchObject({
      payload: { artifactId: first.artifactId },
      status: "queued",
    });
  });

  test("refuses podcast cost before enqueue when TTS is unavailable", async () => {
    const created = await apiA.documents.create({
      yearId: yearA,
      kind: "note",
      title: "Podcast without provider",
      bodyMarkdown: "Narratable note.",
      metaJson: {},
    });
    const { createDocumentsRouter } = await import("./documents");
    const custom = createRouterClient(
      {
        documents: createDocumentsRouter({
          textToSpeechEnabled: async () => false,
        }),
      },
      { context: { headers: new Headers(), session: sessionFor(userA) } },
    );
    await expect(
      custom.documents.artifacts.generate({
        documentId: created.document!.id,
        kind: "audio",
        variant: "default",
      }),
    ).rejects.toThrow("Podcast generation is not configured");
    expect(
      await database
        .select()
        .from(schema.documentArtifacts)
        .where(eq(schema.documentArtifacts.documentId, created.document!.id)),
    ).toHaveLength(0);
  });

  test("marks a podcast stale when a transcluded fiche changes", async () => {
    const dependency = await apiA.documents.create({
      yearId: yearA,
      kind: "fiche",
      title: "Imported chapter",
      bodyMarkdown: "# Chapter\n\nInitial content.",
      metaJson: {},
    });
    const source = await apiA.documents.create({
      yearId: yearA,
      kind: "fiche",
      title: "Composed podcast",
      bodyMarkdown: `@import "fiche:${dependency.document!.id}"`,
      metaJson: {},
    });
    const [artifact] = await database
      .insert(schema.documentArtifacts)
      .values({
        documentId: source.document!.id,
        kind: "audio",
        variant: "default",
        sourceRevision: source.document!.revision,
        status: "succeeded",
        metaJson: {
          dependencies: [
            {
              documentId: dependency.document!.id,
              revision: dependency.document!.revision,
            },
          ],
        },
        userId: userA,
      })
      .returning();
    expect(
      (
        await apiA.documents.artifacts.list({
          documentId: source.document!.id,
        })
      ).find((row) => row.id === artifact!.id)?.stale,
    ).toBe(false);
    await database
      .update(schema.studyDocuments)
      .set({ revision: dependency.document!.revision + 1 })
      .where(eq(schema.studyDocuments.id, dependency.document!.id));
    expect(
      (
        await apiA.documents.artifacts.list({
          documentId: source.document!.id,
        })
      ).find((row) => row.id === artifact!.id)?.stale,
    ).toBe(true);
  });
});
