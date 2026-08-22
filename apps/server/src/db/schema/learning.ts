import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  primaryKey,
  real,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";
import { newId } from "../../lib/id";
import { grades, periods, subjects, years } from "./app";
import { users } from "./auth";
import { gradeAttachments } from "./grade-attachments";
import { jobs } from "./jobs";
import { files } from "./files";
import { planningTasks } from "./planning";
import { studyDocuments, quizAttempts } from "./documents";
import { studyProjects } from "./corpus";

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

export type LearningConceptNamespace = "local" | "curriculum" | "provider";
export type LearningConceptOperationKind =
  "import" | "merge" | "split" | "archive";
export type LearningEvidenceKind =
  | "school-grade"
  | "copy-region"
  | "teacher-comment"
  | "quiz-question"
  | "exercise"
  | "self-assessment"
  | "manual-observation"
  | "provider-snapshot";
export type LearningEvidenceProducer =
  "human" | "deterministic-parser" | "provider" | "model";
export type LearningErrorTaxonomy =
  | "missing-knowledge"
  | "misunderstood-concept"
  | "method-strategy"
  | "calculation"
  | "notation"
  | "reading-instruction"
  | "justification"
  | "transfer"
  | "time-management"
  | "unclassified";

export interface LearningSourceLocatorV1 {
  kind:
    | "pdf"
    | "image"
    | "markdown"
    | "text"
    | "audio"
    | "video"
    | "grade"
    | "quiz";
  page?: number;
  bbox?: [number, number, number, number];
  headingPath?: string[];
  startOffset?: number;
  endOffset?: number;
  startMs?: number;
  endMs?: number;
  gradeId?: string;
  attemptId?: string;
  questionId?: string;
}

export interface LearningCopyRegionProposalV1 {
  id: string;
  page: number;
  kind:
    | "question"
    | "answer"
    | "teacher-mark"
    | "teacher-comment"
    | "awarded-points";
  text: string;
  bbox?: [number, number, number, number];
  confidence: number;
  suggestedObjectiveIds: string[];
  awarded?: { value: number; outOf: number };
  suggestedError?: {
    taxonomy: LearningErrorTaxonomy;
    explanation: string;
    severity: number;
    confidence: number;
  };
}

export interface LearningCopyProposalV1 {
  version: 1;
  sourceTextKind: "native" | "ocr" | "manual";
  pages: Array<{
    page: number;
    text: string;
    regions: LearningCopyRegionProposalV1[];
  }>;
  unsupportedInferences: string[];
  providerFileId?: string;
}

/** Per-account privacy choices. Provider/model analysis is off until enabled. */
export const learningPreferences = sqliteTable(
  "learning_preferences",
  {
    userId: owner().primaryKey(),
    analysisEnabled: integer({ mode: "boolean" }).notNull().default(false),
    latencyCollectionEnabled: integer({ mode: "boolean" })
      .notNull()
      .default(false),
    trainingExportOptIn: integer({ mode: "boolean" }).notNull().default(false),
    revision: integer().notNull().default(1),
    ...timestamps,
  },
  (table) => [
    check("learning_preferences_revision_check", sql`${table.revision} >= 1`),
  ],
);

/** User-owned, versioned objective namespace for one year/subject scope. */
export const learningConceptSets = sqliteTable(
  "learning_concept_sets",
  {
    id: text()
      .primaryKey()
      .$defaultFn(() => newId("lcset")),
    title: text().notNull(),
    namespace: text()
      .$type<LearningConceptNamespace>()
      .notNull()
      .default("local"),
    source: text(),
    sourceVersion: text(),
    locale: text().notNull().default("fr"),
    importDigest: text(),
    revision: integer().notNull().default(1),
    archivedAt: integer({ mode: "timestamp" }),
    yearId: text()
      .notNull()
      .references(() => years.id, { onDelete: "cascade", onUpdate: "cascade" }),
    subjectId: text().references(() => subjects.id, {
      onDelete: "set null",
      onUpdate: "cascade",
    }),
    userId: owner(),
    ...timestamps,
  },
  (table) => [
    index("learning_concept_sets_scope_idx").on(
      table.userId,
      table.yearId,
      table.subjectId,
    ),
    uniqueIndex("learning_concept_sets_import_unique").on(
      table.userId,
      table.namespace,
      table.importDigest,
    ),
    check(
      "learning_concept_sets_namespace_check",
      sql`${table.namespace} in ('local', 'curriculum', 'provider')`,
    ),
  ],
);

/** Local labels and hierarchy never mutate a provider's subject identity. */
export const learningConcepts = sqliteTable(
  "learning_concepts",
  {
    id: text()
      .primaryKey()
      .$defaultFn(() => newId("lcon")),
    setId: text()
      .notNull()
      .references(() => learningConceptSets.id, {
        onDelete: "cascade",
        onUpdate: "cascade",
      }),
    /** Validated in the service to keep the hierarchy acyclic and same-set. */
    parentId: text(),
    stableKey: text().notNull(),
    canonicalLabel: text().notNull(),
    localLabel: text(),
    description: text(),
    sortOrder: integer().notNull().default(0),
    revision: integer().notNull().default(1),
    archivedAt: integer({ mode: "timestamp" }),
    yearId: text()
      .notNull()
      .references(() => years.id, { onDelete: "cascade", onUpdate: "cascade" }),
    subjectId: text().references(() => subjects.id, {
      onDelete: "set null",
      onUpdate: "cascade",
    }),
    userId: owner(),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("learning_concepts_set_key_unique").on(
      table.setId,
      table.stableKey,
    ),
    index("learning_concepts_tree_idx").on(
      table.setId,
      table.parentId,
      table.sortOrder,
    ),
    index("learning_concepts_scope_idx").on(
      table.userId,
      table.yearId,
      table.subjectId,
    ),
  ],
);

export const learningObjectives = sqliteTable(
  "learning_objectives",
  {
    id: text()
      .primaryKey()
      .$defaultFn(() => newId("lobj")),
    conceptId: text()
      .notNull()
      .references(() => learningConcepts.id, {
        onDelete: "cascade",
        onUpdate: "cascade",
      }),
    statement: text().notNull(),
    expectedLevel: integer().notNull().default(3),
    curriculumCode: text(),
    activeFrom: integer({ mode: "timestamp" }),
    activeTo: integer({ mode: "timestamp" }),
    revision: integer().notNull().default(1),
    archivedAt: integer({ mode: "timestamp" }),
    yearId: text()
      .notNull()
      .references(() => years.id, { onDelete: "cascade", onUpdate: "cascade" }),
    subjectId: text().references(() => subjects.id, {
      onDelete: "set null",
      onUpdate: "cascade",
    }),
    userId: owner(),
    ...timestamps,
  },
  (table) => [
    index("learning_objectives_concept_idx").on(table.conceptId),
    index("learning_objectives_scope_idx").on(
      table.userId,
      table.yearId,
      table.subjectId,
    ),
    check(
      "learning_objectives_expected_level_check",
      sql`${table.expectedLevel} between 1 and 5`,
    ),
  ],
);

export const learningObjectivePrerequisites = sqliteTable(
  "learning_objective_prerequisites",
  {
    objectiveId: text()
      .notNull()
      .references(() => learningObjectives.id, {
        onDelete: "cascade",
        onUpdate: "cascade",
      }),
    prerequisiteObjectiveId: text()
      .notNull()
      .references(() => learningObjectives.id, {
        onDelete: "cascade",
        onUpdate: "cascade",
      }),
    userId: owner(),
    createdAt: integer({ mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => [
    primaryKey({ columns: [table.objectiveId, table.prerequisiteObjectiveId] }),
    index("learning_objective_prerequisites_reverse_idx").on(
      table.prerequisiteObjectiveId,
    ),
    check(
      "learning_objective_prerequisites_no_self_check",
      sql`${table.objectiveId} <> ${table.prerequisiteObjectiveId}`,
    ),
  ],
);

/**
 * Immutable audit record for structural concept changes. Concepts/objectives
 * remain user-owned and keep their stable IDs; this record preserves the exact
 * before/after mapping used by merge, split, archive and reviewed imports.
 */
export const learningConceptOperations = sqliteTable(
  "learning_concept_operations",
  {
    id: text()
      .primaryKey()
      .$defaultFn(() => newId("lcop")),
    kind: text().$type<LearningConceptOperationKind>().notNull(),
    sourceSetId: text().references(() => learningConceptSets.id, {
      onDelete: "set null",
      onUpdate: "cascade",
    }),
    targetSetId: text().references(() => learningConceptSets.id, {
      onDelete: "set null",
      onUpdate: "cascade",
    }),
    beforeJson: text({ mode: "json" }).$type<unknown>().notNull(),
    afterJson: text({ mode: "json" }).$type<unknown>().notNull(),
    previewDigest: text().notNull(),
    idempotencyKey: text().notNull(),
    yearId: text()
      .notNull()
      .references(() => years.id, { onDelete: "cascade", onUpdate: "cascade" }),
    subjectId: text().references(() => subjects.id, {
      onDelete: "set null",
      onUpdate: "cascade",
    }),
    userId: owner(),
    createdAt: integer({ mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => [
    uniqueIndex("learning_concept_operations_key_unique").on(
      table.userId,
      table.idempotencyKey,
    ),
    index("learning_concept_operations_scope_idx").on(
      table.userId,
      table.yearId,
      table.subjectId,
      table.createdAt,
    ),
    check(
      "learning_concept_operations_kind_check",
      sql`${table.kind} in ('import', 'merge', 'split', 'archive')`,
    ),
  ],
);

/** One immutable source/model attempt; review history is stored separately. */
export const learningCopyAnalyses = sqliteTable(
  "learning_copy_analyses",
  {
    id: text()
      .primaryKey()
      .$defaultFn(() => newId("lcopy")),
    attachmentId: text()
      .notNull()
      .references(() => gradeAttachments.id, {
        onDelete: "cascade",
        onUpdate: "cascade",
      }),
    gradeId: text()
      .notNull()
      .references(() => grades.id, {
        onDelete: "cascade",
        onUpdate: "cascade",
      }),
    sourceFileId: text()
      .notNull()
      .references(() => files.id, {
        onDelete: "restrict",
        onUpdate: "cascade",
      }),
    sourceDigest: text().notNull(),
    provider: text().notNull(),
    model: text().notNull(),
    modelRevision: text().notNull(),
    status: text()
      .$type<
        | "queued"
        | "running"
        | "proposed"
        | "confirmed"
        | "dismissed"
        | "failed"
        | "cancelled"
      >()
      .notNull()
      .default("queued"),
    revision: integer().notNull().default(1),
    jobId: text().references(() => jobs.id, {
      onDelete: "set null",
      onUpdate: "cascade",
    }),
    pageCount: integer(),
    proposalVersion: integer().notNull().default(1),
    proposalJson: text({ mode: "json" }).$type<LearningCopyProposalV1>(),
    safeError: text(),
    yearId: text()
      .notNull()
      .references(() => years.id, { onDelete: "cascade", onUpdate: "cascade" }),
    periodId: text().references(() => periods.id, {
      onDelete: "set null",
      onUpdate: "cascade",
    }),
    subjectId: text()
      .notNull()
      .references(() => subjects.id, {
        onDelete: "cascade",
        onUpdate: "cascade",
      }),
    userId: owner(),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("learning_copy_analyses_revision_unique").on(
      table.userId,
      table.attachmentId,
      table.modelRevision,
      table.sourceDigest,
    ),
    index("learning_copy_analyses_grade_idx").on(table.userId, table.gradeId),
    index("learning_copy_analyses_job_idx").on(table.jobId),
    check(
      "learning_copy_analyses_status_check",
      sql`${table.status} in ('queued', 'running', 'proposed', 'confirmed', 'dismissed', 'failed', 'cancelled')`,
    ),
  ],
);

/** Append-only human decisions; corrections never erase the model proposal. */
export const learningCopyAnalysisReviews = sqliteTable(
  "learning_copy_analysis_reviews",
  {
    id: text()
      .primaryKey()
      .$defaultFn(() => newId("lcrev")),
    analysisId: text()
      .notNull()
      .references(() => learningCopyAnalyses.id, {
        onDelete: "cascade",
        onUpdate: "cascade",
      }),
    kind: text()
      .$type<"confirm" | "correct" | "dismiss" | "unconfirm">()
      .notNull(),
    fromRevision: integer().notNull(),
    toRevision: integer().notNull(),
    selectionJson: text({ mode: "json" }).$type<unknown>().notNull(),
    idempotencyKey: text().notNull(),
    userId: owner(),
    createdAt: integer({ mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => [
    uniqueIndex("learning_copy_analysis_reviews_key_unique").on(
      table.userId,
      table.idempotencyKey,
    ),
    index("learning_copy_analysis_reviews_analysis_idx").on(
      table.analysisId,
      table.createdAt,
    ),
  ],
);

/** Immutable, source-located observation. Inclusion is an append-only decision. */
export const learningEvidence = sqliteTable(
  "learning_evidence",
  {
    id: text()
      .primaryKey()
      .$defaultFn(() => newId("lev")),
    kind: text().$type<LearningEvidenceKind>().notNull(),
    objectiveId: text()
      .notNull()
      .references(() => learningObjectives.id, {
        onDelete: "cascade",
        onUpdate: "cascade",
      }),
    sourceKind: text().notNull(),
    sourceId: text().notNull(),
    sourceVersion: text().notNull(),
    locatorVersion: integer().notNull().default(1),
    locatorJson: text({ mode: "json" })
      .$type<LearningSourceLocatorV1>()
      .notNull(),
    observedOutcome: real(),
    denominator: real(),
    rubricJson: text({ mode: "json" }).$type<unknown>(),
    difficulty: real(),
    reliability: real().notNull(),
    occurredAt: integer({ mode: "timestamp" }).notNull(),
    producerKind: text().$type<LearningEvidenceProducer>().notNull(),
    producerDescriptor: text(),
    algorithmRevision: text().notNull(),
    confidence: real(),
    correctionOfEvidenceId: text(),
    yearId: text()
      .notNull()
      .references(() => years.id, { onDelete: "cascade", onUpdate: "cascade" }),
    periodId: text().references(() => periods.id, {
      onDelete: "set null",
      onUpdate: "cascade",
    }),
    subjectId: text()
      .notNull()
      .references(() => subjects.id, {
        onDelete: "cascade",
        onUpdate: "cascade",
      }),
    userId: owner(),
    createdAt: integer({ mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => [
    index("learning_evidence_objective_cursor_idx").on(
      table.userId,
      table.objectiveId,
      table.createdAt,
      table.id,
    ),
    index("learning_evidence_source_idx").on(
      table.userId,
      table.sourceKind,
      table.sourceId,
    ),
    check(
      "learning_evidence_kind_check",
      sql`${table.kind} in ('school-grade', 'copy-region', 'teacher-comment', 'quiz-question', 'exercise', 'self-assessment', 'manual-observation', 'provider-snapshot')`,
    ),
    check(
      "learning_evidence_reliability_check",
      sql`${table.reliability} >= 0 and ${table.reliability} <= 1`,
    ),
    check(
      "learning_evidence_difficulty_check",
      sql`${table.difficulty} is null or (${table.difficulty} >= 0 and ${table.difficulty} <= 1)`,
    ),
    check(
      "learning_evidence_confidence_check",
      sql`${table.confidence} is null or (${table.confidence} >= 0 and ${table.confidence} <= 1)`,
    ),
  ],
);

export const learningEvidenceDecisions = sqliteTable(
  "learning_evidence_decisions",
  {
    id: text()
      .primaryKey()
      .$defaultFn(() => newId("levd")),
    evidenceId: text()
      .notNull()
      .references(() => learningEvidence.id, {
        onDelete: "cascade",
        onUpdate: "cascade",
      }),
    state: text().$type<"included" | "excluded">().notNull(),
    reason: text(),
    actor: text()
      .$type<"user" | "system-correction">()
      .notNull()
      .default("user"),
    idempotencyKey: text().notNull(),
    userId: owner(),
    createdAt: integer({ mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => [
    index("learning_evidence_decisions_latest_idx").on(
      table.evidenceId,
      table.createdAt,
      table.id,
    ),
    uniqueIndex("learning_evidence_decisions_key_unique").on(
      table.userId,
      table.idempotencyKey,
    ),
    check(
      "learning_evidence_decisions_state_check",
      sql`${table.state} in ('included', 'excluded')`,
    ),
  ],
);

/** Confirmed/corrected/dismissed diagnosis; proposal text remains in the analysis. */
export const learningErrorObservations = sqliteTable(
  "learning_error_observations",
  {
    id: text()
      .primaryKey()
      .$defaultFn(() => newId("lerr")),
    evidenceId: text()
      .notNull()
      .references(() => learningEvidence.id, {
        onDelete: "cascade",
        onUpdate: "cascade",
      }),
    objectiveId: text()
      .notNull()
      .references(() => learningObjectives.id, {
        onDelete: "cascade",
        onUpdate: "cascade",
      }),
    conceptId: text()
      .notNull()
      .references(() => learningConcepts.id, {
        onDelete: "cascade",
        onUpdate: "cascade",
      }),
    taxonomy: text().$type<LearningErrorTaxonomy>().notNull(),
    quotedEvidence: text(),
    locatorVersion: integer().notNull().default(1),
    locatorJson: text({ mode: "json" })
      .$type<LearningSourceLocatorV1>()
      .notNull(),
    explanation: text().notNull(),
    severity: real().notNull(),
    confidence: real().notNull(),
    status: text()
      .$type<"proposed" | "confirmed" | "corrected" | "dismissed">()
      .notNull(),
    correctionOfObservationId: text(),
    userId: owner(),
    createdAt: integer({ mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => [
    index("learning_error_observations_evidence_idx").on(table.evidenceId),
    index("learning_error_observations_objective_idx").on(
      table.userId,
      table.objectiveId,
      table.createdAt,
    ),
    check(
      "learning_error_observations_status_check",
      sql`${table.status} in ('proposed', 'confirmed', 'corrected', 'dismissed')`,
    ),
    check(
      "learning_error_observations_severity_check",
      sql`${table.severity} >= 0 and ${table.severity} <= 1`,
    ),
    check(
      "learning_error_observations_confidence_check",
      sql`${table.confidence} >= 0 and ${table.confidence} <= 1`,
    ),
  ],
);

export interface LearningMasteryExplanationV1 {
  version: 1;
  prior: { alpha: number; beta: number };
  asOf: string;
  contributions: Array<{
    evidenceId: string;
    included: boolean;
    exclusionReason?: string;
    normalizedOutcome?: number;
    reliability: number;
    recencyWeight?: number;
    difficulty: number | null;
    difficultyWeight?: number;
    alphaContribution?: number;
    betaContribution?: number;
  }>;
}

/** Immutable algorithm output. `learningMasteryCurrent` is the only pointer. */
export const learningMasteryProjections = sqliteTable(
  "learning_mastery_projections",
  {
    id: text()
      .primaryKey()
      .$defaultFn(() => newId("lmas")),
    objectiveId: text()
      .notNull()
      .references(() => learningObjectives.id, {
        onDelete: "cascade",
        onUpdate: "cascade",
      }),
    generation: integer().notNull(),
    algorithmRevision: text().notNull(),
    evidenceCursor: text().notNull(),
    asOf: integer({ mode: "timestamp" }).notNull(),
    estimate: real().notNull(),
    low: real().notNull(),
    high: real().notNull(),
    alpha: real().notNull(),
    beta: real().notNull(),
    evidenceCount: integer().notNull(),
    freshnessDays: real(),
    explanationVersion: integer().notNull().default(1),
    explanationJson: text({ mode: "json" })
      .$type<LearningMasteryExplanationV1>()
      .notNull(),
    digest: text().notNull(),
    userId: owner(),
    createdAt: integer({ mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => [
    uniqueIndex("learning_mastery_projection_generation_unique").on(
      table.objectiveId,
      table.generation,
    ),
    uniqueIndex("learning_mastery_projection_replay_unique").on(
      table.objectiveId,
      table.algorithmRevision,
      table.evidenceCursor,
      table.asOf,
    ),
    index("learning_mastery_projection_history_idx").on(
      table.userId,
      table.objectiveId,
      table.createdAt,
    ),
    check(
      "learning_mastery_projection_interval_check",
      sql`${table.low} >= 0 and ${table.low} <= ${table.estimate} and ${table.estimate} <= ${table.high} and ${table.high} <= 1`,
    ),
  ],
);

export const learningMasteryCurrent = sqliteTable(
  "learning_mastery_current",
  {
    objectiveId: text()
      .primaryKey()
      .references(() => learningObjectives.id, {
        onDelete: "cascade",
        onUpdate: "cascade",
      }),
    projectionId: text()
      .notNull()
      .references(() => learningMasteryProjections.id, {
        onDelete: "cascade",
        onUpdate: "cascade",
      }),
    generation: integer().notNull(),
    evidenceCursor: text().notNull(),
    userId: owner(),
    updatedAt: integer({ mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => [index("learning_mastery_current_user_idx").on(table.userId)],
);

export type LearningActivityKind =
  | "review-sheet"
  | "exercise"
  | "quiz"
  | "course-review"
  | "oral-recall"
  | "artifact";

/** Pedagogical link only; planning_tasks remains the due-date/status authority. */
export const learningPlanItems = sqliteTable(
  "learning_plan_items",
  {
    id: text()
      .primaryKey()
      .$defaultFn(() => newId("lplan")),
    objectiveId: text()
      .notNull()
      .references(() => learningObjectives.id, {
        onDelete: "cascade",
        onUpdate: "cascade",
      }),
    rationaleJson: text({ mode: "json" }).$type<unknown>().notNull(),
    evidenceCursor: text().notNull(),
    activityKind: text().$type<LearningActivityKind>().notNull(),
    difficulty: real(),
    estimatedMinutes: integer().notNull(),
    status: text()
      .$type<
        "proposed" | "accepted" | "in-progress" | "completed" | "dismissed"
      >()
      .notNull()
      .default("proposed"),
    planningTaskId: text().references(() => planningTasks.id, {
      onDelete: "set null",
      onUpdate: "cascade",
    }),
    projectId: text().references(() => studyProjects.id, {
      onDelete: "set null",
      onUpdate: "cascade",
    }),
    documentId: text().references(() => studyDocuments.id, {
      onDelete: "set null",
      onUpdate: "cascade",
    }),
    artifactId: text(),
    revision: integer().notNull().default(1),
    yearId: text()
      .notNull()
      .references(() => years.id, { onDelete: "cascade", onUpdate: "cascade" }),
    subjectId: text().references(() => subjects.id, {
      onDelete: "set null",
      onUpdate: "cascade",
    }),
    userId: owner(),
    ...timestamps,
  },
  (table) => [
    index("learning_plan_items_status_idx").on(
      table.userId,
      table.yearId,
      table.status,
    ),
    index("learning_plan_items_objective_idx").on(table.objectiveId),
    check(
      "learning_plan_items_status_check",
      sql`${table.status} in ('proposed', 'accepted', 'in-progress', 'completed', 'dismissed')`,
    ),
    check(
      "learning_plan_items_duration_check",
      sql`${table.estimatedMinutes} between 5 and 480`,
    ),
  ],
);

/** V2 question snapshot, lazily materialized per immutable document revision. */
export const learningQuizQuestionVersions = sqliteTable(
  "learning_quiz_question_versions",
  {
    id: text()
      .primaryKey()
      .$defaultFn(() => newId("lqq")),
    documentId: text()
      .notNull()
      .references(() => studyDocuments.id, {
        onDelete: "cascade",
        onUpdate: "cascade",
      }),
    documentRevision: integer().notNull(),
    questionId: text().notNull(),
    kind: text().notNull(),
    prompt: text().notNull(),
    objectiveIdsJson: text({ mode: "json" }).$type<string[]>().notNull(),
    difficulty: real(),
    sourceProofsJson: text({ mode: "json" }).$type<unknown[]>().notNull(),
    rubricRevision: text().notNull(),
    rubricJson: text({ mode: "json" }).$type<unknown>().notNull(),
    generationProvenanceJson: text({ mode: "json" }).$type<unknown>(),
    validationState: text()
      .$type<"draft" | "reviewed" | "rejected">()
      .notNull(),
    userId: owner(),
    createdAt: integer({ mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => [
    uniqueIndex("learning_quiz_question_version_unique").on(
      table.documentId,
      table.documentRevision,
      table.questionId,
    ),
    index("learning_quiz_question_objective_idx").on(
      table.userId,
      table.documentId,
    ),
  ],
);

export const learningQuizAttemptModes = sqliteTable(
  "learning_quiz_attempt_modes",
  {
    attemptId: text()
      .primaryKey()
      .references(() => quizAttempts.id, {
        onDelete: "cascade",
        onUpdate: "cascade",
      }),
    mode: text().$type<"practice" | "progress">().notNull(),
    latencyConsent: integer({ mode: "boolean" }).notNull().default(false),
    userId: owner(),
    createdAt: integer({ mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => [
    check(
      "learning_quiz_attempt_modes_mode_check",
      sql`${table.mode} in ('practice', 'progress')`,
    ),
  ],
);

export const learningQuizAttemptItems = sqliteTable(
  "learning_quiz_attempt_items",
  {
    id: text()
      .primaryKey()
      .$defaultFn(() => newId("lqitem")),
    attemptId: text()
      .notNull()
      .references(() => quizAttempts.id, {
        onDelete: "cascade",
        onUpdate: "cascade",
      }),
    questionVersionId: text()
      .notNull()
      .references(() => learningQuizQuestionVersions.id, {
        onDelete: "restrict",
        onUpdate: "cascade",
      }),
    questionId: text().notNull(),
    answerJson: text({ mode: "json" }).$type<unknown>().notNull(),
    /** Null means the answer is waiting for an explicit human/model review. */
    normalizedOutcome: real(),
    feedback: text(),
    latencyMs: integer(),
    hintsUsed: integer().notNull().default(0),
    evidenceId: text().references(() => learningEvidence.id, {
      onDelete: "set null",
      onUpdate: "cascade",
    }),
    userId: owner(),
    createdAt: integer({ mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => [
    uniqueIndex("learning_quiz_attempt_item_unique").on(
      table.attemptId,
      table.questionId,
    ),
    index("learning_quiz_attempt_items_evidence_idx").on(table.evidenceId),
    check(
      "learning_quiz_attempt_items_outcome_check",
      sql`${table.normalizedOutcome} >= 0 and ${table.normalizedOutcome} <= 1`,
    ),
    check(
      "learning_quiz_attempt_items_latency_check",
      sql`${table.latencyMs} is null or ${table.latencyMs} >= 0`,
    ),
  ],
);
