import {
  index,
  integer,
  primaryKey,
  real,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";
import { newId } from "../../lib/id";
import { subjects, years } from "./app";
import { users } from "./auth";
import { files } from "./files";
import { materialFolders, type MaterialDeletionActor } from "./materials";

/** User-authored source formats; generated media live in documentArtifacts. */
export type StudyDocumentKind =
  "fiche" | "note" | "mindmap" | "slides" | "latex" | "quiz";
export type StudyDocumentReferenceKind =
  "subject" | "materialDocument" | "grade";

export interface StudyDocumentMetaV1 {
  emoji?: string;
  color?: string;
}

export interface MindmapNodeV1 {
  id: string;
  label: string;
  children?: MindmapNodeV1[];
  note?: string;
}

export interface MindmapContentV1 {
  version: 1;
  root: MindmapNodeV1;
}

export interface SlidesMetaV1 {
  version: 1;
}

export interface LatexMetaV2 {
  engine: "pdflatex" | "xelatex" | "lualatex";
  entry?: string;
}

export type QuizQuestionV1 =
  | {
      kind: "mcq";
      prompt: string;
      choices: string[];
      answers: number[];
      why?: string;
    }
  | { kind: "open"; prompt: string; expected: string }
  | { kind: "cloze"; text: string; blanks: string[] };

export interface QuizContentV1 {
  version: 1;
  questions: QuizQuestionV1[];
}

export interface QuizSourceProofV2 {
  sourceKind: "material" | "study-document" | "grade-copy";
  sourceId: string;
  sourceVersion: string;
  locator: Record<string, unknown>;
}

/**
 * Versioned, inspectable grading policy for quiz-v2 questions.
 *
 * Unknown keys remain allowed in `QuizQuestionV2.rubric` so older and newer
 * producers can coexist, but the fields below are the only ones the local
 * deterministic scorer is allowed to act on. Model and human review modes are
 * deliberately recorded as pending until a separate reviewed assessment is
 * published.
 */
export interface QuizRubricV2 {
  scoringMode?: "deterministic" | "human-review" | "model-review";
  acceptedVariants?: string[];
  acceptedBlankVariants?: string[][];
  modelDescriptor?: string;
}

export type QuizQuestionV2 = QuizQuestionV1 & {
  id: string;
  objectiveIds: string[];
  difficulty: number | null;
  sourceProofs: QuizSourceProofV2[];
  rubricRevision: string;
  rubric: QuizRubricV2 & Record<string, unknown>;
  generationProvenance?: Record<string, unknown>;
  validationState: "draft" | "reviewed" | "rejected";
};

export interface QuizContentV2 {
  version: 2;
  questions: QuizQuestionV2[];
}

export type StudyDocumentMeta =
  | StudyDocumentMetaV1
  | MindmapContentV1
  | SlidesMetaV1
  | LatexMetaV2
  | QuizContentV1
  | QuizContentV2;
export type StudyDocumentBuildStatus =
  "queued" | "running" | "succeeded" | "failed";
export type DocumentArtifactKind =
  "pdf" | "pptx" | "audio" | "image" | "anki" | "html";
export type DocumentArtifactStatus = StudyDocumentBuildStatus;

const timestamps = {
  createdAt: integer({ mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
  updatedAt: integer({ mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
};

const owner = () =>
  text()
    .notNull()
    .references(() => users.id, { onDelete: "cascade", onUpdate: "cascade" });

/** A user-authored Markdown fiche or note inside the materials tree. */
export const studyDocuments = sqliteTable(
  "study_documents",
  {
    id: text()
      .notNull()
      .primaryKey()
      .$defaultFn(() => newId("sdoc")),
    kind: text().$type<StudyDocumentKind>().notNull().default("fiche"),
    title: text().notNull(),
    /** Markdown, capped at 512 KiB in the router. */
    bodyMarkdown: text().notNull().default(""),
    /** Optimistic autosave fence. */
    revision: integer().notNull().default(1),
    metaVersion: integer().notNull().default(1),
    metaJson: text({ mode: "json" }).$type<StudyDocumentMeta>(),
    folderId: text().references(() => materialFolders.id, {
      onDelete: "set null",
      onUpdate: "cascade",
    }),
    subjectId: text().references(() => subjects.id, {
      onDelete: "set null",
      onUpdate: "cascade",
    }),
    yearId: text()
      .notNull()
      .references(() => years.id, {
        onDelete: "cascade",
        onUpdate: "cascade",
      }),
    userId: owner(),
    starredAt: integer({ mode: "timestamp" }),
    deletedAt: integer({ mode: "timestamp" }),
    deletedFrom: text(),
    deletedBy: text().$type<MaterialDeletionActor>(),
    deletedBatchId: text(),
    ...timestamps,
  },
  (table) => [
    index("study_documents_year_idx").on(table.yearId),
    index("study_documents_folder_idx").on(table.folderId),
    index("study_documents_deleted_idx").on(table.userId, table.deletedAt),
  ],
);

/** Immutable result ledger for an explicit LaTeX build request. */
export const studyDocumentBuilds = sqliteTable(
  "study_document_builds",
  {
    id: text()
      .notNull()
      .primaryKey()
      .$defaultFn(() => newId("sbuild")),
    documentId: text()
      .notNull()
      .references(() => studyDocuments.id, {
        onDelete: "cascade",
        onUpdate: "cascade",
      }),
    revision: integer().notNull(),
    status: text()
      .$type<StudyDocumentBuildStatus>()
      .notNull()
      .default("queued"),
    pdfFileId: text().references(() => files.id, {
      onDelete: "set null",
      onUpdate: "cascade",
    }),
    log: text(),
    userId: owner(),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("study_document_builds_revision_unique").on(
      t.documentId,
      t.revision,
    ),
    index("study_document_builds_document_idx").on(t.documentId, t.createdAt),
    index("study_document_builds_file_idx").on(t.pdfFileId),
  ],
);

/** Relational projection of every academic source cited by a fiche. */
export const studyDocumentReferences = sqliteTable(
  "study_document_references",
  {
    documentId: text()
      .notNull()
      .references(() => studyDocuments.id, {
        onDelete: "cascade",
        onUpdate: "cascade",
      }),
    kind: text().$type<StudyDocumentReferenceKind>().notNull(),
    referenceId: text().notNull(),
  },
  (table) => [
    primaryKey({
      columns: [table.documentId, table.kind, table.referenceId],
    }),
    index("study_document_references_lookup_idx").on(
      table.kind,
      table.referenceId,
    ),
  ],
);

/** The one durable PPTX result adopted for a specific document revision. */
export const studyDocumentExports = sqliteTable(
  "study_document_exports",
  {
    documentId: text()
      .notNull()
      .references(() => studyDocuments.id, {
        onDelete: "cascade",
        onUpdate: "cascade",
      }),
    revision: integer().notNull(),
    fileId: text()
      .notNull()
      .references(() => files.id, {
        onDelete: "restrict",
        onUpdate: "cascade",
      }),
    userId: owner(),
    ...timestamps,
  },
  (table) => [
    primaryKey({ columns: [table.documentId, table.revision] }),
    index("study_document_exports_user_idx").on(table.userId),
    index("study_document_exports_file_idx").on(table.fileId),
  ],
);

/**
 * Canonical ledger for every generated representation of a study document.
 * The two legacy export tables remain readable during the rolling migration,
 * but all new artifact-facing features use this revision-aware model.
 */
export const documentArtifacts = sqliteTable(
  "document_artifacts",
  {
    id: text()
      .notNull()
      .primaryKey()
      .$defaultFn(() => newId("dart")),
    documentId: text()
      .notNull()
      .references(() => studyDocuments.id, {
        onDelete: "cascade",
        onUpdate: "cascade",
      }),
    kind: text().$type<DocumentArtifactKind>().notNull(),
    /** Voice, language or export profile; `default` keeps simple generators simple. */
    variant: text().notNull().default("default"),
    sourceRevision: integer().notNull(),
    status: text().$type<DocumentArtifactStatus>().notNull().default("queued"),
    fileId: text().references(() => files.id, {
      onDelete: "set null",
      onUpdate: "cascade",
    }),
    log: text(),
    metaVersion: integer().notNull().default(1),
    metaJson: text({ mode: "json" }).$type<Record<string, unknown>>(),
    userId: owner(),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("document_artifacts_unique").on(
      table.documentId,
      table.kind,
      table.variant,
      table.sourceRevision,
    ),
    index("document_artifacts_document_idx").on(
      table.documentId,
      table.createdAt,
    ),
    index("document_artifacts_file_idx").on(table.fileId),
  ],
);

/** A durable, owner-scoped result for one quiz session. */
export const quizAttempts = sqliteTable(
  "quiz_attempts",
  {
    id: text()
      .notNull()
      .primaryKey()
      .$defaultFn(() => newId("qatt")),
    documentId: text()
      .notNull()
      .references(() => studyDocuments.id, {
        onDelete: "cascade",
        onUpdate: "cascade",
      }),
    sourceRevision: integer().notNull(),
    questionsJson: text({ mode: "json" }).$type<QuizQuestionV1[]>().notNull(),
    startedAt: integer({ mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
    completedAt: integer({ mode: "timestamp" }),
    score: real(),
    outOf: real(),
    answersJson: text({ mode: "json" }).$type<unknown[]>(),
    subjectId: text().references(() => subjects.id, {
      onDelete: "set null",
      onUpdate: "cascade",
    }),
    yearId: text()
      .notNull()
      .references(() => years.id, {
        onDelete: "cascade",
        onUpdate: "cascade",
      }),
    userId: owner(),
    ...timestamps,
  },
  (table) => [
    index("quiz_attempts_document_idx").on(table.documentId, table.startedAt),
    index("quiz_attempts_subject_idx").on(table.userId, table.subjectId),
    index("quiz_attempts_year_idx").on(table.userId, table.yearId),
  ],
);
