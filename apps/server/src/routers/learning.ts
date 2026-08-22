import { and, asc, desc, eq, inArray, isNull, or } from "drizzle-orm";
import { z } from "zod";
import { PersonalTaskCommandError } from "../actions/personal-task-command";
import { db } from "../db";
import {
  academicAssignments,
  files,
  gradeAttachments,
  grades,
  jobRuntimeMetadata,
  jobs,
  learningConceptOperations,
  learningConcepts,
  learningConceptSets,
  learningCopyAnalyses,
  learningCopyAnalysisReviews,
  learningErrorObservations,
  learningEvidence,
  learningEvidenceDecisions,
  learningMasteryCurrent,
  learningMasteryProjections,
  learningObjectivePrerequisites,
  learningObjectives,
  learningPlanItems,
  learningPreferences,
  planningTasks,
  subjects,
} from "../db/schema";
import { enqueueJob } from "../lib/jobs";
import {
  badRequest,
  conflict,
  notFound,
  protectedProcedure,
} from "../lib/orpc";
import { newId } from "../lib/id";
import { fileAccessUrl } from "../lib/storage";
import { requireYear } from "../lib/ownership";
import {
  GRADE_COPY_ANALYSIS_JOB_KIND,
  GRADE_COPY_ANALYSIS_MODEL_REVISION,
  gradeCopyAnalysisJobPayloadSchema,
  type GradeCopyAnalysisJobPayload,
} from "../learning/copy-analysis";
import { projectObjectiveMastery } from "../learning/mastery";
import { learningPlanPolicy } from "../learning/planning-policy";
import {
  applyLearningPlanItemCommand,
  LearningPlanApplyError,
} from "../learning/plan-apply";
import {
  deleteAllLearningData,
  deleteLearningDerivatives,
  exportLearningData,
  learningExportMarkdown,
} from "../learning/privacy";
import { canonicalJson, sha256 } from "../search/values";

const id = z.string().trim().min(1).max(256);
const idempotencyKey = z.string().trim().min(8).max(256);
const errorTaxonomy = z.enum([
  "missing-knowledge",
  "misunderstood-concept",
  "method-strategy",
  "calculation",
  "notation",
  "reading-instruction",
  "justification",
  "transfer",
  "time-management",
  "unclassified",
]);

const importedObjectiveSchema = z.object({
  stableKey: z.string().trim().min(1).max(160),
  conceptStableKey: z.string().trim().min(1).max(160),
  statement: z.string().trim().min(1).max(1_000),
  expectedLevel: z.number().int().min(1).max(5).default(3),
  curriculumCode: z.string().trim().max(160).nullable().default(null),
  prerequisiteStableKeys: z
    .array(z.string().trim().min(1).max(160))
    .max(50)
    .default([]),
});

const conceptPackSchema = z.object({
  yearId: id,
  subjectId: id.nullable().default(null),
  namespace: z.enum(["curriculum", "provider"]).default("curriculum"),
  source: z.string().trim().min(1).max(256),
  sourceVersion: z.string().trim().min(1).max(160),
  title: z.string().trim().min(1).max(160),
  locale: z.string().trim().min(2).max(20).default("fr"),
  concepts: z
    .array(
      z.object({
        stableKey: z.string().trim().min(1).max(160),
        parentStableKey: z
          .string()
          .trim()
          .min(1)
          .max(160)
          .nullable()
          .default(null),
        canonicalLabel: z.string().trim().min(1).max(160),
        localLabel: z.string().trim().max(160).nullable().default(null),
        description: z.string().trim().max(4_000).nullable().default(null),
        sortOrder: z.number().int().min(-100_000).max(100_000).default(0),
      }),
    )
    .min(1)
    .max(2_000),
  objectives: z.array(importedObjectiveSchema).max(10_000).default([]),
  idempotencyKey,
});

function ensureUnique(values: readonly string[], label: string) {
  if (new Set(values).size !== values.length) {
    badRequest(`${label} must be unique`);
  }
}

export function conceptHierarchyHasCycle(
  nodes: readonly { id: string; parentId: string | null }[],
) {
  const parentById = new Map(nodes.map((node) => [node.id, node.parentId]));
  for (const node of nodes) {
    const seen = new Set<string>();
    let current: string | null = node.id;
    while (current) {
      if (seen.has(current)) return true;
      seen.add(current);
      current = parentById.get(current) ?? null;
    }
  }
  return false;
}

async function ownedConcept(userId: string, conceptId: string) {
  const [row] = await db
    .select()
    .from(learningConcepts)
    .where(
      and(
        eq(learningConcepts.id, conceptId),
        eq(learningConcepts.userId, userId),
      ),
    )
    .limit(1);
  if (!row) notFound("Learning concept");
  return row;
}

async function ownedConceptSet(userId: string, setId: string) {
  const [row] = await db
    .select()
    .from(learningConceptSets)
    .where(
      and(
        eq(learningConceptSets.id, setId),
        eq(learningConceptSets.userId, userId),
      ),
    )
    .limit(1);
  if (!row) notFound("Learning concept set");
  return row;
}

async function conceptImpact(userId: string, conceptIds: string[]) {
  const objectives = conceptIds.length
    ? await db
        .select({ id: learningObjectives.id })
        .from(learningObjectives)
        .where(
          and(
            eq(learningObjectives.userId, userId),
            inArray(learningObjectives.conceptId, conceptIds),
          ),
        )
    : [];
  const objectiveIds = objectives.map((row) => row.id);
  const evidence = objectiveIds.length
    ? await db
        .select({ id: learningEvidence.id })
        .from(learningEvidence)
        .where(
          and(
            eq(learningEvidence.userId, userId),
            inArray(learningEvidence.objectiveId, objectiveIds),
          ),
        )
    : [];
  const projections = objectiveIds.length
    ? await db
        .select({ id: learningMasteryProjections.id })
        .from(learningMasteryProjections)
        .where(
          and(
            eq(learningMasteryProjections.userId, userId),
            inArray(learningMasteryProjections.objectiveId, objectiveIds),
          ),
        )
    : [];
  return {
    objectiveIds,
    objectiveCount: objectiveIds.length,
    evidenceCount: evidence.length,
    projectionCount: projections.length,
  };
}

async function mergeConceptPreview(
  userId: string,
  targetConceptId: string,
  sourceConceptIds: string[],
) {
  ensureUnique(sourceConceptIds, "Source concepts");
  if (!sourceConceptIds.length || sourceConceptIds.includes(targetConceptId))
    badRequest("Choose one target and at least one different source concept");
  const conceptIds = [targetConceptId, ...sourceConceptIds];
  const concepts = await db
    .select()
    .from(learningConcepts)
    .where(
      and(
        eq(learningConcepts.userId, userId),
        inArray(learningConcepts.id, conceptIds),
      ),
    );
  if (concepts.length !== conceptIds.length)
    badRequest("Every merged concept must be owned by this account");
  const target = concepts.find((row) => row.id === targetConceptId)!;
  const sources = concepts.filter((row) => row.id !== targetConceptId);
  if (
    target.archivedAt ||
    sources.some(
      (row) =>
        row.archivedAt ||
        row.setId !== target.setId ||
        row.yearId !== target.yearId ||
        row.subjectId !== target.subjectId,
    )
  )
    badRequest("Merged concepts must be active and belong to the same set");
  const hierarchy = await db
    .select()
    .from(learningConcepts)
    .where(
      and(
        eq(learningConcepts.userId, userId),
        eq(learningConcepts.setId, target.setId),
      ),
    );
  const parentById = new Map(hierarchy.map((row) => [row.id, row.parentId]));
  let ancestor = target.parentId;
  while (ancestor) {
    if (sourceConceptIds.includes(ancestor))
      badRequest("The merge target cannot be inside a source subtree");
    ancestor = parentById.get(ancestor) ?? null;
  }
  const children = hierarchy.filter(
    (row) =>
      row.parentId &&
      sourceConceptIds.includes(row.parentId) &&
      row.id !== targetConceptId &&
      !sourceConceptIds.includes(row.id),
  );
  const impact = await conceptImpact(userId, sourceConceptIds);
  const preview = {
    version: 1 as const,
    kind: "merge" as const,
    setId: target.setId,
    target: { id: target.id, revision: target.revision },
    sources: sources.map((row) => ({ id: row.id, revision: row.revision })),
    reparentedChildren: children.map((row) => ({
      id: row.id,
      revision: row.revision,
      fromParentId: row.parentId,
      toParentId: target.id,
    })),
    movedObjectiveIds: impact.objectiveIds,
    impact,
    yearId: target.yearId,
    subjectId: target.subjectId,
  };
  return { ...preview, previewDigest: sha256(canonicalJson(preview)) };
}

async function splitConceptPreview(
  userId: string,
  sourceConceptId: string,
  targets: Array<{ label: string; objectiveIds: string[] }>,
  archiveSource: boolean,
) {
  if (targets.length < 2) badRequest("A split requires at least two targets");
  const source = await ownedConcept(userId, sourceConceptId);
  if (source.archivedAt) badRequest("An archived concept cannot be split");
  ensureUnique(
    targets.flatMap((target) => target.objectiveIds),
    "Allocated objectives",
  );
  const objectives = await db
    .select({
      id: learningObjectives.id,
      revision: learningObjectives.revision,
    })
    .from(learningObjectives)
    .where(
      and(
        eq(learningObjectives.userId, userId),
        eq(learningObjectives.conceptId, source.id),
        isNull(learningObjectives.archivedAt),
      ),
    );
  const ownedObjectiveIds = new Set(objectives.map((row) => row.id));
  if (
    targets.some((target) =>
      target.objectiveIds.some(
        (objectiveId) => !ownedObjectiveIds.has(objectiveId),
      ),
    )
  )
    badRequest("Every allocated objective must belong to the split concept");
  const allocated = new Set(targets.flatMap((target) => target.objectiveIds));
  if (archiveSource && allocated.size !== objectives.length)
    badRequest("Archive requires allocating every active objective");
  const children = await db
    .select({ id: learningConcepts.id, revision: learningConcepts.revision })
    .from(learningConcepts)
    .where(
      and(
        eq(learningConcepts.userId, userId),
        eq(learningConcepts.parentId, source.id),
        isNull(learningConcepts.archivedAt),
      ),
    );
  const impact = await conceptImpact(userId, [source.id]);
  const preview = {
    version: 1 as const,
    kind: "split" as const,
    setId: source.setId,
    source: { id: source.id, revision: source.revision },
    targets: targets.map((target, index) => ({
      index,
      label: target.label,
      objectiveIds: target.objectiveIds,
    })),
    retainedObjectiveIds: objectives
      .map((row) => row.id)
      .filter((objectiveId) => !allocated.has(objectiveId)),
    reparentedChildren: archiveSource ? children : [],
    archiveSource,
    impact,
    yearId: source.yearId,
    subjectId: source.subjectId,
  };
  return { ...preview, previewDigest: sha256(canonicalJson(preview)) };
}

async function archiveConceptPreview(
  userId: string,
  conceptId: string,
  cascade: boolean,
) {
  const source = await ownedConcept(userId, conceptId);
  if (source.archivedAt) badRequest("This concept is already archived");
  const hierarchy = await db
    .select()
    .from(learningConcepts)
    .where(
      and(
        eq(learningConcepts.userId, userId),
        eq(learningConcepts.setId, source.setId),
        isNull(learningConcepts.archivedAt),
      ),
    );
  const selected = new Set([source.id]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const row of hierarchy) {
      if (row.parentId && selected.has(row.parentId) && !selected.has(row.id)) {
        if (!cascade)
          badRequest(
            "Archive this concept with its active children or move them first",
          );
        selected.add(row.id);
        changed = true;
      }
    }
  }
  const concepts = hierarchy
    .filter((row) => selected.has(row.id))
    .map((row) => ({ id: row.id, revision: row.revision }));
  const impact = await conceptImpact(
    userId,
    concepts.map((row) => row.id),
  );
  const preview = {
    version: 1 as const,
    kind: "archive" as const,
    setId: source.setId,
    concepts,
    cascade,
    impact,
    yearId: source.yearId,
    subjectId: source.subjectId,
  };
  return { ...preview, previewDigest: sha256(canonicalJson(preview)) };
}

async function ownedObjective(userId: string, objectiveId: string) {
  const [row] = await db
    .select()
    .from(learningObjectives)
    .where(
      and(
        eq(learningObjectives.id, objectiveId),
        eq(learningObjectives.userId, userId),
      ),
    )
    .limit(1);
  if (!row) notFound("Learning objective");
  return row;
}

async function ownedAnalysis(userId: string, analysisId: string) {
  const [row] = await db
    .select()
    .from(learningCopyAnalyses)
    .where(
      and(
        eq(learningCopyAnalyses.id, analysisId),
        eq(learningCopyAnalyses.userId, userId),
      ),
    )
    .limit(1);
  if (!row) notFound("Copy analysis");
  return row;
}

type OwnedCopyAnalysis = Awaited<ReturnType<typeof ownedAnalysis>>;

function copyAnalysisJobPayload(
  analysis: OwnedCopyAnalysis,
): GradeCopyAnalysisJobPayload {
  return {
    analysisId: analysis.id,
    expectedRevision: analysis.revision,
    sourceDigest: analysis.sourceDigest,
    modelRevision: analysis.modelRevision,
  };
}

/**
 * Attach exactly one durable job to a reserved queued revision.
 *
 * The queue key intentionally ignores the HTTP idempotency key: two browsers
 * requesting the same immutable source/model revision must converge on the
 * same provider operation instead of paying for duplicate OCR.
 */
async function attachCopyAnalysisJob(
  userId: string,
  analysis: OwnedCopyAnalysis,
) {
  if (analysis.status !== "queued") return analysis;
  if (analysis.jobId) return analysis;
  const payload = copyAnalysisJobPayload(analysis);
  const job = await enqueueJob({
    kind: GRADE_COPY_ANALYSIS_JOB_KIND,
    payload,
    payloadVersion: 2,
    userId,
    idempotencyKey: `copy:${analysis.id}:attempt:${analysis.revision}`,
    maxAttempts: 3,
  });
  const persistedPayload = gradeCopyAnalysisJobPayloadSchema.safeParse(
    job.payload,
  );
  if (
    !persistedPayload.success ||
    canonicalJson(persistedPayload.data) !== canonicalJson(payload)
  ) {
    conflict("The queued copy-analysis job does not match this revision");
  }
  const [attached] = await db
    .update(learningCopyAnalyses)
    .set({
      jobId: job.id,
      safeError: null,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(learningCopyAnalyses.id, analysis.id),
        eq(learningCopyAnalyses.userId, userId),
        eq(learningCopyAnalyses.status, "queued"),
        eq(learningCopyAnalyses.revision, analysis.revision),
        eq(learningCopyAnalyses.sourceDigest, analysis.sourceDigest),
        eq(learningCopyAnalyses.modelRevision, analysis.modelRevision),
        or(
          isNull(learningCopyAnalyses.jobId),
          eq(learningCopyAnalyses.jobId, job.id),
        ),
      ),
    )
    .returning();
  return attached ?? ownedAnalysis(userId, analysis.id);
}

async function reserveNextCopyAnalysisAttempt(
  userId: string,
  analysis: OwnedCopyAnalysis,
  allowedStatuses: ReadonlySet<OwnedCopyAnalysis["status"]>,
) {
  if (!allowedStatuses.has(analysis.status)) return null;
  const [reserved] = await db
    .update(learningCopyAnalyses)
    .set({
      status: "queued",
      revision: analysis.revision + 1,
      jobId: null,
      provider: "pending",
      model: "pending",
      pageCount: null,
      proposalJson: null,
      safeError: null,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(learningCopyAnalyses.id, analysis.id),
        eq(learningCopyAnalyses.userId, userId),
        eq(learningCopyAnalyses.status, analysis.status),
        eq(learningCopyAnalyses.revision, analysis.revision),
        eq(learningCopyAnalyses.sourceDigest, analysis.sourceDigest),
        eq(learningCopyAnalyses.modelRevision, analysis.modelRevision),
      ),
    )
    .returning();
  if (reserved) return attachCopyAnalysisJob(userId, reserved);
  const raced = await ownedAnalysis(userId, analysis.id);
  if (raced.status === "queued") return attachCopyAnalysisJob(userId, raced);
  if (raced.status === "running") return raced;
  return null;
}

export function objectiveDagHasCycle(edges: Array<[string, string]>) {
  const outgoing = new Map<string, string[]>();
  for (const [objective, prerequisite] of edges) {
    const values = outgoing.get(objective) ?? [];
    values.push(prerequisite);
    outgoing.set(objective, values);
  }
  const visiting = new Set<string>();
  const visited = new Set<string>();
  function visit(node: string): boolean {
    if (visiting.has(node)) return true;
    if (visited.has(node)) return false;
    visiting.add(node);
    if ((outgoing.get(node) ?? []).some(visit)) return true;
    visiting.delete(node);
    visited.add(node);
    return false;
  }
  return [...outgoing.keys()].some(visit);
}

async function latestEvidenceStates(userId: string, evidenceIds: string[]) {
  if (evidenceIds.length === 0)
    return new Map<
      string,
      { state: "included" | "excluded"; reason: string | null }
    >();
  const rows = await db
    .select()
    .from(learningEvidenceDecisions)
    .where(
      and(
        eq(learningEvidenceDecisions.userId, userId),
        inArray(learningEvidenceDecisions.evidenceId, evidenceIds),
      ),
    )
    .orderBy(
      desc(learningEvidenceDecisions.createdAt),
      desc(learningEvidenceDecisions.id),
    );
  const states = new Map<
    string,
    { state: "included" | "excluded"; reason: string | null }
  >();
  for (const row of rows)
    if (!states.has(row.evidenceId))
      states.set(row.evidenceId, { state: row.state, reason: row.reason });
  return states;
}

export async function recomputeObjectiveMastery(
  userId: string,
  objectiveId: string,
  asOf = new Date(),
) {
  await ownedObjective(userId, objectiveId);
  const rows = await db
    .select()
    .from(learningEvidence)
    .where(
      and(
        eq(learningEvidence.userId, userId),
        eq(learningEvidence.objectiveId, objectiveId),
      ),
    )
    .orderBy(asc(learningEvidence.createdAt), asc(learningEvidence.id));
  const states = await latestEvidenceStates(
    userId,
    rows.map((row) => row.id),
  );
  const calculated = projectObjectiveMastery({
    asOf,
    evidence: rows.map((row) => {
      const decision = states.get(row.id);
      return {
        id: row.id,
        observedOutcome: row.observedOutcome,
        denominator: row.denominator,
        reliability: row.reliability,
        difficulty: row.difficulty,
        occurredAt: row.occurredAt,
        included: decision?.state !== "excluded",
        exclusionReason: decision?.reason ?? undefined,
      };
    }),
  });
  return db.transaction(async (transaction) => {
    const [current] = await transaction
      .select()
      .from(learningMasteryCurrent)
      .where(eq(learningMasteryCurrent.objectiveId, objectiveId))
      .limit(1);
    if (current?.evidenceCursor === calculated.evidenceCursor) {
      const [existing] = await transaction
        .select()
        .from(learningMasteryProjections)
        .where(eq(learningMasteryProjections.id, current.projectionId))
        .limit(1);
      if (existing) return existing;
    }
    const generation = (current?.generation ?? 0) + 1;
    const [projection] = await transaction
      .insert(learningMasteryProjections)
      .values({
        objectiveId,
        generation,
        algorithmRevision: calculated.algorithmRevision,
        evidenceCursor: calculated.evidenceCursor,
        asOf,
        estimate: calculated.estimate,
        low: calculated.low,
        high: calculated.high,
        alpha: calculated.alpha,
        beta: calculated.beta,
        evidenceCount: calculated.evidenceCount,
        freshnessDays: calculated.freshnessDays,
        explanationJson: calculated.explanation,
        digest: calculated.digest,
        userId,
      })
      .returning();
    if (!projection)
      throw new Error("Mastery projection could not be published");
    if (!current) {
      await transaction.insert(learningMasteryCurrent).values({
        objectiveId,
        projectionId: projection.id,
        generation,
        evidenceCursor: calculated.evidenceCursor,
        userId,
      });
    } else {
      const [published] = await transaction
        .update(learningMasteryCurrent)
        .set({
          projectionId: projection.id,
          generation,
          evidenceCursor: calculated.evidenceCursor,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(learningMasteryCurrent.objectiveId, objectiveId),
            eq(learningMasteryCurrent.generation, current.generation),
          ),
        )
        .returning({ id: learningMasteryCurrent.objectiveId });
      if (!published)
        conflict("Newer evidence was published while mastery was recomputed");
    }
    return projection;
  });
}

const reviewedRegionSchema = z
  .object({
    regionId: id,
    objectiveIds: z.array(id).min(1).max(12),
    observedOutcome: z.number().nonnegative().nullable().default(null),
    denominator: z.number().positive().nullable().default(null),
    difficulty: z.number().min(0).max(1).nullable().default(null),
    error: z
      .object({
        taxonomy: errorTaxonomy,
        explanation: z.string().trim().min(1).max(2_000),
        severity: z.number().min(0).max(1),
        confidence: z.number().min(0).max(1),
      })
      .nullable()
      .default(null),
  })
  .refine(
    (value) =>
      (value.observedOutcome === null) === (value.denominator === null),
    {
      message: "Outcome and denominator must be provided together",
    },
  );

export const learningRouter = {
  settings: {
    get: protectedProcedure.handler(async ({ context }) => {
      const userId = context.session.user.id;
      const [row] = await db
        .select()
        .from(learningPreferences)
        .where(eq(learningPreferences.userId, userId))
        .limit(1);
      return (
        row ?? {
          userId,
          analysisEnabled: false,
          latencyCollectionEnabled: false,
          trainingExportOptIn: false,
          revision: 0,
        }
      );
    }),
    update: protectedProcedure
      .input(
        z.object({
          analysisEnabled: z.boolean().optional(),
          latencyCollectionEnabled: z.boolean().optional(),
          expectedRevision: z.number().int().nonnegative(),
        }),
      )
      .handler(async ({ context, input }) => {
        const userId = context.session.user.id;
        const [existing] = await db
          .select()
          .from(learningPreferences)
          .where(eq(learningPreferences.userId, userId))
          .limit(1);
        if ((existing?.revision ?? 0) !== input.expectedRevision)
          conflict("Learning privacy settings changed; reload before saving");
        const values = {
          analysisEnabled:
            input.analysisEnabled ?? existing?.analysisEnabled ?? false,
          latencyCollectionEnabled:
            input.latencyCollectionEnabled ??
            existing?.latencyCollectionEnabled ??
            false,
          trainingExportOptIn: false,
          revision: input.expectedRevision + 1,
          updatedAt: new Date(),
        };
        const [row] = await db
          .insert(learningPreferences)
          .values({ userId, ...values })
          .onConflictDoUpdate({
            target: learningPreferences.userId,
            set: values,
          })
          .returning();
        return row!;
      }),
  },
  concepts: {
    get: protectedProcedure
      .input(z.object({ conceptId: id }))
      .handler(async ({ context, input }) => {
        const userId = context.session.user.id;
        const concept = await ownedConcept(userId, input.conceptId);
        const [set, objectives, operations] = await Promise.all([
          db
            .select()
            .from(learningConceptSets)
            .where(
              and(
                eq(learningConceptSets.id, concept.setId),
                eq(learningConceptSets.userId, userId),
              ),
            )
            .limit(1)
            .then((rows) => rows[0] ?? null),
          db
            .select()
            .from(learningObjectives)
            .where(
              and(
                eq(learningObjectives.userId, userId),
                eq(learningObjectives.conceptId, concept.id),
              ),
            )
            .orderBy(asc(learningObjectives.statement)),
          db
            .select()
            .from(learningConceptOperations)
            .where(
              and(
                eq(learningConceptOperations.userId, userId),
                or(
                  eq(learningConceptOperations.sourceSetId, concept.setId),
                  eq(learningConceptOperations.targetSetId, concept.setId),
                ),
              ),
            )
            .orderBy(desc(learningConceptOperations.createdAt))
            .limit(100),
        ]);
        const prerequisites = objectives.length
          ? await db
              .select()
              .from(learningObjectivePrerequisites)
              .where(
                and(
                  eq(learningObjectivePrerequisites.userId, userId),
                  inArray(
                    learningObjectivePrerequisites.objectiveId,
                    objectives.map((objective) => objective.id),
                  ),
                ),
              )
          : [];
        return { concept, set, objectives, prerequisites, operations };
      }),
    list: protectedProcedure
      .input(z.object({ yearId: id, subjectId: id.nullable().optional() }))
      .handler(async ({ context, input }) => {
        const userId = context.session.user.id;
        await requireYear(userId, input.yearId);
        const concepts = await db
          .select({
            concept: learningConcepts,
            setTitle: learningConceptSets.title,
          })
          .from(learningConcepts)
          .innerJoin(
            learningConceptSets,
            eq(learningConceptSets.id, learningConcepts.setId),
          )
          .where(
            and(
              eq(learningConcepts.userId, userId),
              eq(learningConcepts.yearId, input.yearId),
              input.subjectId
                ? eq(learningConcepts.subjectId, input.subjectId)
                : undefined,
              isNull(learningConcepts.archivedAt),
            ),
          )
          .orderBy(
            asc(learningConcepts.sortOrder),
            asc(learningConcepts.canonicalLabel),
          );
        const objectives = await db
          .select()
          .from(learningObjectives)
          .where(
            and(
              eq(learningObjectives.userId, userId),
              eq(learningObjectives.yearId, input.yearId),
              input.subjectId
                ? eq(learningObjectives.subjectId, input.subjectId)
                : undefined,
              isNull(learningObjectives.archivedAt),
            ),
          )
          .orderBy(asc(learningObjectives.statement));
        const prerequisites = objectives.length
          ? await db
              .select({
                objectiveId: learningObjectivePrerequisites.objectiveId,
                prerequisiteObjectiveId:
                  learningObjectivePrerequisites.prerequisiteObjectiveId,
              })
              .from(learningObjectivePrerequisites)
              .where(
                and(
                  eq(learningObjectivePrerequisites.userId, userId),
                  inArray(
                    learningObjectivePrerequisites.objectiveId,
                    objectives.map((objective) => objective.id),
                  ),
                ),
              )
          : [];
        return { concepts, objectives, prerequisites };
      }),
    createSet: protectedProcedure
      .input(
        z.object({
          yearId: id,
          subjectId: id.nullable().default(null),
          title: z.string().trim().min(1).max(120),
          locale: z.string().trim().min(2).max(20).default("fr"),
        }),
      )
      .handler(async ({ context, input }) => {
        const userId = context.session.user.id;
        await requireYear(userId, input.yearId);
        const [row] = await db
          .insert(learningConceptSets)
          .values({ ...input, userId, namespace: "local" })
          .returning();
        return row!;
      }),
    importPack: protectedProcedure
      .input(conceptPackSchema)
      .handler(async ({ context, input }) => {
        const userId = context.session.user.id;
        await requireYear(userId, input.yearId);
        if (input.subjectId) {
          const [subject] = await db
            .select({ id: subjects.id })
            .from(subjects)
            .where(
              and(
                eq(subjects.id, input.subjectId),
                eq(subjects.userId, userId),
                eq(subjects.yearId, input.yearId),
              ),
            )
            .limit(1);
          if (!subject)
            badRequest("The imported subject must belong to this year");
        }
        const { idempotencyKey: operationKey, ...pack } = input;
        const importDigest = sha256(canonicalJson(pack));
        const [priorOperation] = await db
          .select()
          .from(learningConceptOperations)
          .where(
            and(
              eq(learningConceptOperations.userId, userId),
              eq(learningConceptOperations.idempotencyKey, operationKey),
            ),
          )
          .limit(1);
        if (priorOperation) {
          if (priorOperation.previewDigest !== importDigest)
            conflict("This import key was already used for another pack");
          if (!priorOperation.targetSetId)
            conflict("The previous import has no target set");
          return {
            set: await ownedConceptSet(userId, priorOperation.targetSetId),
            conceptCount: input.concepts.length,
            objectiveCount: input.objectives.length,
            reused: true,
          };
        }
        ensureUnique(
          input.concepts.map((concept) => concept.stableKey),
          "Concept stable keys",
        );
        ensureUnique(
          input.objectives.map((objective) => objective.stableKey),
          "Objective stable keys",
        );
        const conceptKeys = new Set(
          input.concepts.map((concept) => concept.stableKey),
        );
        if (
          input.concepts.some(
            (concept) =>
              concept.parentStableKey === concept.stableKey ||
              (concept.parentStableKey &&
                !conceptKeys.has(concept.parentStableKey)),
          )
        )
          badRequest(
            "Every imported parent must be another concept in the pack",
          );
        if (
          conceptHierarchyHasCycle(
            input.concepts.map((concept) => ({
              id: concept.stableKey,
              parentId: concept.parentStableKey,
            })),
          )
        )
          badRequest("The imported concept hierarchy must remain acyclic");
        const objectiveKeys = new Set(
          input.objectives.map((objective) => objective.stableKey),
        );
        if (
          input.objectives.some(
            (objective) =>
              !conceptKeys.has(objective.conceptStableKey) ||
              objective.prerequisiteStableKeys.some(
                (key) => key === objective.stableKey || !objectiveKeys.has(key),
              ),
          )
        )
          badRequest(
            "Imported objectives and prerequisites must reference this pack",
          );
        if (
          objectiveDagHasCycle(
            input.objectives.flatMap((objective) =>
              objective.prerequisiteStableKeys.map(
                (prerequisite) =>
                  [objective.stableKey, prerequisite] as [string, string],
              ),
            ),
          )
        )
          badRequest("Imported objective prerequisites must remain acyclic");

        const [existing] = await db
          .select()
          .from(learningConceptSets)
          .where(
            and(
              eq(learningConceptSets.userId, userId),
              eq(learningConceptSets.namespace, input.namespace),
              eq(learningConceptSets.importDigest, importDigest),
            ),
          )
          .limit(1);
        if (existing) {
          await db.insert(learningConceptOperations).values({
            kind: "import",
            targetSetId: existing.id,
            beforeJson: { reusedSetId: existing.id },
            afterJson: { importedSetId: existing.id },
            previewDigest: importDigest,
            idempotencyKey: operationKey,
            yearId: existing.yearId,
            subjectId: existing.subjectId,
            userId,
          });
          return {
            set: existing,
            conceptCount: input.concepts.length,
            objectiveCount: input.objectives.length,
            reused: true,
          };
        }

        return db.transaction(async (transaction) => {
          const setId = newId("lcset");
          const conceptIds = new Map(
            input.concepts.map((concept) => [concept.stableKey, newId("lcon")]),
          );
          const objectiveIds = new Map(
            input.objectives.map((objective) => [
              objective.stableKey,
              newId("lobj"),
            ]),
          );
          const [set] = await transaction
            .insert(learningConceptSets)
            .values({
              id: setId,
              title: input.title,
              namespace: input.namespace,
              source: input.source,
              sourceVersion: input.sourceVersion,
              locale: input.locale,
              importDigest,
              yearId: input.yearId,
              subjectId: input.subjectId,
              userId,
            })
            .returning();
          await transaction.insert(learningConcepts).values(
            input.concepts.map((concept) => ({
              id: conceptIds.get(concept.stableKey)!,
              setId,
              parentId: concept.parentStableKey
                ? conceptIds.get(concept.parentStableKey)!
                : null,
              stableKey: concept.stableKey,
              canonicalLabel: concept.canonicalLabel,
              localLabel: concept.localLabel,
              description: concept.description,
              sortOrder: concept.sortOrder,
              yearId: input.yearId,
              subjectId: input.subjectId,
              userId,
            })),
          );
          if (input.objectives.length) {
            await transaction.insert(learningObjectives).values(
              input.objectives.map((objective) => ({
                id: objectiveIds.get(objective.stableKey)!,
                conceptId: conceptIds.get(objective.conceptStableKey)!,
                statement: objective.statement,
                expectedLevel: objective.expectedLevel,
                curriculumCode: objective.curriculumCode,
                yearId: input.yearId,
                subjectId: input.subjectId,
                userId,
              })),
            );
            const prerequisiteRows = input.objectives.flatMap((objective) =>
              objective.prerequisiteStableKeys.map((prerequisite) => ({
                objectiveId: objectiveIds.get(objective.stableKey)!,
                prerequisiteObjectiveId: objectiveIds.get(prerequisite)!,
                userId,
              })),
            );
            if (prerequisiteRows.length)
              await transaction
                .insert(learningObjectivePrerequisites)
                .values(prerequisiteRows);
          }
          await transaction.insert(learningConceptOperations).values({
            kind: "import",
            targetSetId: setId,
            beforeJson: {
              source: input.source,
              sourceVersion: input.sourceVersion,
            },
            afterJson: {
              setId,
              conceptIds: Object.fromEntries(conceptIds),
              objectiveIds: Object.fromEntries(objectiveIds),
            },
            previewDigest: importDigest,
            idempotencyKey: operationKey,
            yearId: input.yearId,
            subjectId: input.subjectId,
            userId,
          });
          return {
            set: set!,
            conceptCount: input.concepts.length,
            objectiveCount: input.objectives.length,
            reused: false,
          };
        });
      }),
    create: protectedProcedure
      .input(
        z.object({
          setId: id,
          parentId: id.nullable().default(null),
          label: z.string().trim().min(1).max(160),
          description: z.string().trim().max(4_000).nullable().default(null),
        }),
      )
      .handler(async ({ context, input }) => {
        const userId = context.session.user.id;
        const [set] = await db
          .select()
          .from(learningConceptSets)
          .where(
            and(
              eq(learningConceptSets.id, input.setId),
              eq(learningConceptSets.userId, userId),
            ),
          )
          .limit(1);
        if (!set) notFound("Learning concept set");
        if (input.parentId) {
          const parent = await ownedConcept(userId, input.parentId);
          if (parent.setId !== set.id)
            badRequest("A parent concept must belong to the same set");
        }
        const [row] = await db
          .insert(learningConcepts)
          .values({
            setId: set.id,
            parentId: input.parentId,
            stableKey: newId("key"),
            canonicalLabel: input.label,
            description: input.description,
            yearId: set.yearId,
            subjectId: set.subjectId,
            userId,
          })
          .returning();
        return row!;
      }),
    update: protectedProcedure
      .input(
        z.object({
          conceptId: id,
          parentId: id.nullable().optional(),
          localLabel: z.string().trim().max(160).nullable().optional(),
          description: z.string().trim().max(4_000).nullable().optional(),
          sortOrder: z.number().int().min(-100_000).max(100_000).optional(),
          expectedRevision: z.number().int().positive(),
        }),
      )
      .handler(async ({ context, input }) => {
        const userId = context.session.user.id;
        const concept = await ownedConcept(userId, input.conceptId);
        if (concept.revision !== input.expectedRevision)
          conflict("The concept changed; reload before editing it");
        const parentId =
          input.parentId === undefined ? concept.parentId : input.parentId;
        if (parentId === concept.id)
          badRequest("A concept cannot be its own parent");
        if (parentId) {
          const parent = await ownedConcept(userId, parentId);
          if (parent.setId !== concept.setId)
            badRequest("A parent concept must belong to the same set");
        }
        const hierarchy = await db
          .select({
            id: learningConcepts.id,
            parentId: learningConcepts.parentId,
          })
          .from(learningConcepts)
          .where(eq(learningConcepts.setId, concept.setId));
        if (
          conceptHierarchyHasCycle(
            hierarchy.map((node) =>
              node.id === concept.id ? { ...node, parentId } : node,
            ),
          )
        )
          badRequest("The concept hierarchy must remain acyclic");
        const [updated] = await db
          .update(learningConcepts)
          .set({
            parentId,
            localLabel:
              input.localLabel === undefined
                ? concept.localLabel
                : input.localLabel,
            description:
              input.description === undefined
                ? concept.description
                : input.description,
            sortOrder: input.sortOrder ?? concept.sortOrder,
            revision: concept.revision + 1,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(learningConcepts.id, concept.id),
              eq(learningConcepts.userId, userId),
              eq(learningConcepts.revision, input.expectedRevision),
            ),
          )
          .returning();
        if (!updated) conflict("The concept changed while it was being saved");
        return updated;
      }),
    createObjective: protectedProcedure
      .input(
        z.object({
          conceptId: id,
          statement: z.string().trim().min(1).max(1_000),
          expectedLevel: z.number().int().min(1).max(5).default(3),
          prerequisiteIds: z.array(id).max(30).default([]),
        }),
      )
      .handler(async ({ context, input }) => {
        const userId = context.session.user.id;
        const concept = await ownedConcept(userId, input.conceptId);
        const prerequisites = input.prerequisiteIds.length
          ? await db
              .select()
              .from(learningObjectives)
              .where(
                and(
                  eq(learningObjectives.userId, userId),
                  inArray(learningObjectives.id, input.prerequisiteIds),
                ),
              )
          : [];
        if (
          prerequisites.length !== new Set(input.prerequisiteIds).size ||
          prerequisites.some(
            (row) =>
              row.yearId !== concept.yearId ||
              row.subjectId !== concept.subjectId,
          )
        )
          badRequest(
            "Prerequisites must be owned objectives in the same learning scope",
          );
        const objectiveId = newId("lobj");
        const existingEdges = await db
          .select()
          .from(learningObjectivePrerequisites)
          .where(eq(learningObjectivePrerequisites.userId, userId));
        const edges: Array<[string, string]> = [
          ...existingEdges.map(
            (row) =>
              [row.objectiveId, row.prerequisiteObjectiveId] as [
                string,
                string,
              ],
          ),
          ...input.prerequisiteIds.map(
            (value) => [objectiveId, value] as [string, string],
          ),
        ];
        if (objectiveDagHasCycle(edges))
          badRequest("Objective prerequisites must remain acyclic");
        return db.transaction(async (transaction) => {
          const [row] = await transaction
            .insert(learningObjectives)
            .values({
              id: objectiveId,
              conceptId: concept.id,
              statement: input.statement,
              expectedLevel: input.expectedLevel,
              yearId: concept.yearId,
              subjectId: concept.subjectId,
              userId,
            })
            .returning();
          if (input.prerequisiteIds.length)
            await transaction.insert(learningObjectivePrerequisites).values(
              input.prerequisiteIds.map((prerequisiteObjectiveId) => ({
                objectiveId,
                prerequisiteObjectiveId,
                userId,
              })),
            );
          return row!;
        });
      }),
    updateObjective: protectedProcedure
      .input(
        z.object({
          objectiveId: id,
          statement: z.string().trim().min(1).max(1_000).optional(),
          expectedLevel: z.number().int().min(1).max(5).optional(),
          activeFrom: z.coerce.date().nullable().optional(),
          activeTo: z.coerce.date().nullable().optional(),
          prerequisiteIds: z.array(id).max(50).optional(),
          expectedRevision: z.number().int().positive(),
        }),
      )
      .handler(async ({ context, input }) => {
        const userId = context.session.user.id;
        const objective = await ownedObjective(userId, input.objectiveId);
        if (objective.revision !== input.expectedRevision)
          conflict("The objective changed; reload before editing it");
        const activeFrom =
          input.activeFrom === undefined
            ? objective.activeFrom
            : input.activeFrom;
        const activeTo =
          input.activeTo === undefined ? objective.activeTo : input.activeTo;
        if (activeFrom && activeTo && activeFrom >= activeTo)
          badRequest("The objective active period must end after it starts");
        const prerequisiteIds = input.prerequisiteIds;
        if (prerequisiteIds) {
          ensureUnique(prerequisiteIds, "Objective prerequisites");
          if (prerequisiteIds.includes(objective.id))
            badRequest("An objective cannot depend on itself");
          const prerequisites = prerequisiteIds.length
            ? await db
                .select()
                .from(learningObjectives)
                .where(
                  and(
                    eq(learningObjectives.userId, userId),
                    inArray(learningObjectives.id, prerequisiteIds),
                  ),
                )
            : [];
          if (
            prerequisites.length !== prerequisiteIds.length ||
            prerequisites.some(
              (row) =>
                row.yearId !== objective.yearId ||
                row.subjectId !== objective.subjectId,
            )
          )
            badRequest(
              "Prerequisites must be owned objectives in the same learning scope",
            );
          const existingEdges = await db
            .select()
            .from(learningObjectivePrerequisites)
            .where(eq(learningObjectivePrerequisites.userId, userId));
          const edges: Array<[string, string]> = [
            ...existingEdges
              .filter((row) => row.objectiveId !== objective.id)
              .map(
                (row) =>
                  [row.objectiveId, row.prerequisiteObjectiveId] as [
                    string,
                    string,
                  ],
              ),
            ...prerequisiteIds.map(
              (prerequisiteId) =>
                [objective.id, prerequisiteId] as [string, string],
            ),
          ];
          if (objectiveDagHasCycle(edges))
            badRequest("Objective prerequisites must remain acyclic");
        }
        return db.transaction(async (transaction) => {
          const [updated] = await transaction
            .update(learningObjectives)
            .set({
              statement: input.statement ?? objective.statement,
              expectedLevel: input.expectedLevel ?? objective.expectedLevel,
              activeFrom,
              activeTo,
              revision: objective.revision + 1,
              updatedAt: new Date(),
            })
            .where(
              and(
                eq(learningObjectives.id, objective.id),
                eq(learningObjectives.userId, userId),
                eq(learningObjectives.revision, input.expectedRevision),
              ),
            )
            .returning();
          if (!updated)
            conflict("The objective changed while it was being saved");
          if (prerequisiteIds) {
            await transaction
              .delete(learningObjectivePrerequisites)
              .where(
                eq(learningObjectivePrerequisites.objectiveId, objective.id),
              );
            if (prerequisiteIds.length)
              await transaction.insert(learningObjectivePrerequisites).values(
                prerequisiteIds.map((prerequisiteObjectiveId) => ({
                  objectiveId: objective.id,
                  prerequisiteObjectiveId,
                  userId,
                })),
              );
          }
          return updated;
        });
      }),
    operations: protectedProcedure
      .input(
        z.object({
          yearId: id,
          subjectId: id.nullable().optional(),
          limit: z.number().int().min(1).max(100).default(30),
        }),
      )
      .handler(async ({ context, input }) => {
        await requireYear(context.session.user.id, input.yearId);
        return db
          .select()
          .from(learningConceptOperations)
          .where(
            and(
              eq(learningConceptOperations.userId, context.session.user.id),
              eq(learningConceptOperations.yearId, input.yearId),
              input.subjectId === undefined
                ? undefined
                : input.subjectId === null
                  ? isNull(learningConceptOperations.subjectId)
                  : eq(learningConceptOperations.subjectId, input.subjectId),
            ),
          )
          .orderBy(desc(learningConceptOperations.createdAt))
          .limit(input.limit);
      }),
    previewMerge: protectedProcedure
      .input(
        z.object({
          targetConceptId: id,
          sourceConceptIds: z.array(id).min(1).max(50),
        }),
      )
      .handler(({ context, input }) =>
        mergeConceptPreview(
          context.session.user.id,
          input.targetConceptId,
          input.sourceConceptIds,
        ),
      ),
    merge: protectedProcedure
      .input(
        z.object({
          targetConceptId: id,
          sourceConceptIds: z.array(id).min(1).max(50),
          previewDigest: z.string().length(64),
          idempotencyKey,
        }),
      )
      .handler(async ({ context, input }) => {
        const userId = context.session.user.id;
        const preview = await mergeConceptPreview(
          userId,
          input.targetConceptId,
          input.sourceConceptIds,
        );
        if (preview.previewDigest !== input.previewDigest)
          conflict("The merge preview changed; review it again");
        const [prior] = await db
          .select()
          .from(learningConceptOperations)
          .where(
            and(
              eq(learningConceptOperations.userId, userId),
              eq(
                learningConceptOperations.idempotencyKey,
                input.idempotencyKey,
              ),
            ),
          )
          .limit(1);
        if (prior) {
          if (prior.previewDigest !== input.previewDigest)
            conflict("This operation key was already used for another merge");
          return { operation: prior, preview, reused: true };
        }
        const now = new Date();
        const operation = await db.transaction(async (transaction) => {
          for (const child of preview.reparentedChildren) {
            const [moved] = await transaction
              .update(learningConcepts)
              .set({
                parentId: preview.target.id,
                revision: child.revision + 1,
                updatedAt: now,
              })
              .where(
                and(
                  eq(learningConcepts.id, child.id),
                  eq(learningConcepts.userId, userId),
                  eq(learningConcepts.revision, child.revision),
                ),
              )
              .returning({ id: learningConcepts.id });
            if (!moved) conflict("A child concept changed during the merge");
          }
          if (preview.movedObjectiveIds.length)
            await transaction
              .update(learningObjectives)
              .set({ conceptId: preview.target.id, updatedAt: now })
              .where(
                and(
                  eq(learningObjectives.userId, userId),
                  inArray(learningObjectives.id, preview.movedObjectiveIds),
                ),
              );
          for (const source of preview.sources) {
            const [archived] = await transaction
              .update(learningConcepts)
              .set({
                archivedAt: now,
                revision: source.revision + 1,
                updatedAt: now,
              })
              .where(
                and(
                  eq(learningConcepts.id, source.id),
                  eq(learningConcepts.userId, userId),
                  eq(learningConcepts.revision, source.revision),
                ),
              )
              .returning({ id: learningConcepts.id });
            if (!archived)
              conflict("A source concept changed during the merge");
          }
          const [created] = await transaction
            .insert(learningConceptOperations)
            .values({
              kind: "merge",
              sourceSetId: preview.setId,
              targetSetId: preview.setId,
              beforeJson: preview,
              afterJson: {
                targetConceptId: preview.target.id,
                archivedConceptIds: preview.sources.map((row) => row.id),
                movedObjectiveIds: preview.movedObjectiveIds,
                reparentedChildIds: preview.reparentedChildren.map(
                  (row) => row.id,
                ),
              },
              previewDigest: input.previewDigest,
              idempotencyKey: input.idempotencyKey,
              yearId: preview.yearId,
              subjectId: preview.subjectId,
              userId,
            })
            .returning();
          return created!;
        });
        return { operation, preview, reused: false };
      }),
    previewSplit: protectedProcedure
      .input(
        z.object({
          sourceConceptId: id,
          targets: z
            .array(
              z.object({
                label: z.string().trim().min(1).max(160),
                objectiveIds: z.array(id).max(500),
              }),
            )
            .min(2)
            .max(20),
          archiveSource: z.boolean().default(false),
        }),
      )
      .handler(({ context, input }) =>
        splitConceptPreview(
          context.session.user.id,
          input.sourceConceptId,
          input.targets,
          input.archiveSource,
        ),
      ),
    split: protectedProcedure
      .input(
        z.object({
          sourceConceptId: id,
          targets: z
            .array(
              z.object({
                label: z.string().trim().min(1).max(160),
                objectiveIds: z.array(id).max(500),
              }),
            )
            .min(2)
            .max(20),
          archiveSource: z.boolean().default(false),
          previewDigest: z.string().length(64),
          idempotencyKey,
        }),
      )
      .handler(async ({ context, input }) => {
        const userId = context.session.user.id;
        const preview = await splitConceptPreview(
          userId,
          input.sourceConceptId,
          input.targets,
          input.archiveSource,
        );
        if (preview.previewDigest !== input.previewDigest)
          conflict("The split preview changed; review it again");
        const [prior] = await db
          .select()
          .from(learningConceptOperations)
          .where(
            and(
              eq(learningConceptOperations.userId, userId),
              eq(
                learningConceptOperations.idempotencyKey,
                input.idempotencyKey,
              ),
            ),
          )
          .limit(1);
        if (prior) {
          if (prior.previewDigest !== input.previewDigest)
            conflict("This operation key was already used for another split");
          return { operation: prior, preview, reused: true };
        }
        const source = await ownedConcept(userId, input.sourceConceptId);
        const targetIds = input.targets.map(() => newId("lcon"));
        const now = new Date();
        const operation = await db.transaction(async (transaction) => {
          await transaction.insert(learningConcepts).values(
            input.targets.map((target, index) => ({
              id: targetIds[index]!,
              setId: source.setId,
              parentId: source.parentId,
              stableKey: `split-${sha256(`${input.idempotencyKey}:${index}`)}`,
              canonicalLabel: target.label,
              sortOrder: source.sortOrder + index,
              yearId: source.yearId,
              subjectId: source.subjectId,
              userId,
            })),
          );
          for (const [index, target] of input.targets.entries()) {
            if (!target.objectiveIds.length) continue;
            await transaction
              .update(learningObjectives)
              .set({ conceptId: targetIds[index]!, updatedAt: now })
              .where(
                and(
                  eq(learningObjectives.userId, userId),
                  inArray(learningObjectives.id, target.objectiveIds),
                  eq(learningObjectives.conceptId, source.id),
                ),
              );
          }
          if (input.archiveSource) {
            for (const child of preview.reparentedChildren) {
              const [moved] = await transaction
                .update(learningConcepts)
                .set({
                  parentId: targetIds[0]!,
                  revision: child.revision + 1,
                  updatedAt: now,
                })
                .where(
                  and(
                    eq(learningConcepts.id, child.id),
                    eq(learningConcepts.revision, child.revision),
                    eq(learningConcepts.userId, userId),
                  ),
                )
                .returning({ id: learningConcepts.id });
              if (!moved) conflict("A child concept changed during the split");
            }
          }
          const [changedSource] = await transaction
            .update(learningConcepts)
            .set({
              archivedAt: input.archiveSource ? now : source.archivedAt,
              revision: source.revision + 1,
              updatedAt: now,
            })
            .where(
              and(
                eq(learningConcepts.id, source.id),
                eq(learningConcepts.userId, userId),
                eq(learningConcepts.revision, preview.source.revision),
              ),
            )
            .returning({ id: learningConcepts.id });
          if (!changedSource)
            conflict("The split source changed while applying");
          const [created] = await transaction
            .insert(learningConceptOperations)
            .values({
              kind: "split",
              sourceSetId: preview.setId,
              targetSetId: preview.setId,
              beforeJson: preview,
              afterJson: {
                sourceConceptId: source.id,
                targetConceptIds: targetIds,
                archivedSource: input.archiveSource,
              },
              previewDigest: input.previewDigest,
              idempotencyKey: input.idempotencyKey,
              yearId: preview.yearId,
              subjectId: preview.subjectId,
              userId,
            })
            .returning();
          return created!;
        });
        return {
          operation,
          targetConceptIds: targetIds,
          preview,
          reused: false,
        };
      }),
    previewArchive: protectedProcedure
      .input(z.object({ conceptId: id, cascade: z.boolean().default(false) }))
      .handler(({ context, input }) =>
        archiveConceptPreview(
          context.session.user.id,
          input.conceptId,
          input.cascade,
        ),
      ),
    archive: protectedProcedure
      .input(
        z.object({
          conceptId: id,
          cascade: z.boolean().default(false),
          previewDigest: z.string().length(64),
          idempotencyKey,
        }),
      )
      .handler(async ({ context, input }) => {
        const userId = context.session.user.id;
        const preview = await archiveConceptPreview(
          userId,
          input.conceptId,
          input.cascade,
        );
        if (preview.previewDigest !== input.previewDigest)
          conflict("The archive preview changed; review it again");
        const [prior] = await db
          .select()
          .from(learningConceptOperations)
          .where(
            and(
              eq(learningConceptOperations.userId, userId),
              eq(
                learningConceptOperations.idempotencyKey,
                input.idempotencyKey,
              ),
            ),
          )
          .limit(1);
        if (prior) {
          if (prior.previewDigest !== input.previewDigest)
            conflict("This operation key was already used for another archive");
          return { operation: prior, preview, reused: true };
        }
        const now = new Date();
        const operation = await db.transaction(async (transaction) => {
          for (const concept of preview.concepts) {
            const [archived] = await transaction
              .update(learningConcepts)
              .set({
                archivedAt: now,
                revision: concept.revision + 1,
                updatedAt: now,
              })
              .where(
                and(
                  eq(learningConcepts.id, concept.id),
                  eq(learningConcepts.userId, userId),
                  eq(learningConcepts.revision, concept.revision),
                ),
              )
              .returning({ id: learningConcepts.id });
            if (!archived) conflict("A concept changed during the archive");
          }
          if (preview.impact.objectiveIds.length)
            await transaction
              .update(learningObjectives)
              .set({ archivedAt: now, updatedAt: now })
              .where(
                and(
                  eq(learningObjectives.userId, userId),
                  inArray(learningObjectives.id, preview.impact.objectiveIds),
                ),
              );
          const [created] = await transaction
            .insert(learningConceptOperations)
            .values({
              kind: "archive",
              sourceSetId: preview.setId,
              targetSetId: preview.setId,
              beforeJson: preview,
              afterJson: {
                archivedConceptIds: preview.concepts.map((row) => row.id),
                archivedObjectiveIds: preview.impact.objectiveIds,
              },
              previewDigest: input.previewDigest,
              idempotencyKey: input.idempotencyKey,
              yearId: preview.yearId,
              subjectId: preview.subjectId,
              userId,
            })
            .returning();
          return created!;
        });
        return { operation, preview, reused: false };
      }),
  },
  copies: {
    list: protectedProcedure
      .input(z.object({ yearId: id }))
      .handler(async ({ context, input }) => {
        await requireYear(context.session.user.id, input.yearId);
        return db
          .select({
            analysis: learningCopyAnalyses,
            gradeName: grades.name,
            subjectName: subjects.name,
          })
          .from(learningCopyAnalyses)
          .innerJoin(grades, eq(grades.id, learningCopyAnalyses.gradeId))
          .innerJoin(subjects, eq(subjects.id, learningCopyAnalyses.subjectId))
          .where(
            and(
              eq(learningCopyAnalyses.userId, context.session.user.id),
              eq(learningCopyAnalyses.yearId, input.yearId),
            ),
          )
          .orderBy(desc(learningCopyAnalyses.createdAt));
      }),
    get: protectedProcedure
      .input(z.object({ analysisId: id }))
      .handler(async ({ context, input }) => {
        const analysis = await ownedAnalysis(
          context.session.user.id,
          input.analysisId,
        );
        const [source] = await db
          .select({
            file: files,
            gradeName: grades.name,
            subjectName: subjects.name,
          })
          .from(gradeAttachments)
          .innerJoin(files, eq(files.id, gradeAttachments.fileId))
          .innerJoin(grades, eq(grades.id, gradeAttachments.gradeId))
          .innerJoin(subjects, eq(subjects.id, grades.subjectId))
          .where(
            and(
              eq(gradeAttachments.id, analysis.attachmentId),
              eq(gradeAttachments.userId, context.session.user.id),
              eq(files.status, "stored"),
            ),
          )
          .limit(1);
        if (!source) notFound("Copy source");
        const reviews = await db
          .select()
          .from(learningCopyAnalysisReviews)
          .where(
            and(
              eq(learningCopyAnalysisReviews.analysisId, analysis.id),
              eq(learningCopyAnalysisReviews.userId, context.session.user.id),
            ),
          )
          .orderBy(desc(learningCopyAnalysisReviews.createdAt));
        return {
          analysis,
          gradeName: source.gradeName,
          subjectName: source.subjectName,
          file: {
            id: source.file.id,
            mimeType: source.file.mimeType,
            byteSize: source.file.byteSize,
            url: await fileAccessUrl(source.file, { expiresIn: "1h" }),
          },
          reviews,
        };
      }),
    request: protectedProcedure
      .input(
        z.object({
          attachmentId: id,
          idempotencyKey,
        }),
      )
      .handler(async ({ context, input }) => {
        const userId = context.session.user.id;
        const [preference] = await db
          .select()
          .from(learningPreferences)
          .where(eq(learningPreferences.userId, userId))
          .limit(1);
        if (!preference?.analysisEnabled)
          badRequest("Enable copy analysis in learning privacy settings first");
        const [source] = await db
          .select({ attachment: gradeAttachments, file: files, grade: grades })
          .from(gradeAttachments)
          .innerJoin(
            files,
            and(
              eq(files.id, gradeAttachments.fileId),
              eq(files.status, "stored"),
            ),
          )
          .innerJoin(grades, eq(grades.id, gradeAttachments.gradeId))
          .where(
            and(
              eq(gradeAttachments.id, input.attachmentId),
              eq(gradeAttachments.userId, userId),
              eq(files.userId, userId),
              eq(grades.userId, userId),
            ),
          )
          .limit(1);
        if (!source) notFound("Grade attachment");
        const sourceDigest = sha256(
          `${source.file.provider}:${source.file.storageKey}:${source.file.byteSize}`,
        );
        const [existing] = await db
          .select()
          .from(learningCopyAnalyses)
          .where(
            and(
              eq(learningCopyAnalyses.userId, userId),
              eq(learningCopyAnalyses.attachmentId, input.attachmentId),
              eq(
                learningCopyAnalyses.modelRevision,
                GRADE_COPY_ANALYSIS_MODEL_REVISION,
              ),
              eq(learningCopyAnalyses.sourceDigest, sourceDigest),
            ),
          )
          .limit(1);
        const [created] = existing
          ? []
          : await db
              .insert(learningCopyAnalyses)
              .values({
                attachmentId: source.attachment.id,
                gradeId: source.grade.id,
                sourceFileId: source.file.id,
                sourceDigest,
                provider: "pending",
                model: "pending",
                modelRevision: GRADE_COPY_ANALYSIS_MODEL_REVISION,
                yearId: source.grade.yearId,
                periodId: source.grade.periodId,
                subjectId: source.grade.subjectId,
                userId,
              })
              .onConflictDoNothing()
              .returning();
        const analysis =
          existing ??
          created ??
          (
            await db
              .select()
              .from(learningCopyAnalyses)
              .where(
                and(
                  eq(learningCopyAnalyses.userId, userId),
                  eq(
                    learningCopyAnalyses.attachmentId,
                    input.attachmentId,
                  ),
                  eq(
                    learningCopyAnalyses.modelRevision,
                    GRADE_COPY_ANALYSIS_MODEL_REVISION,
                  ),
                  eq(learningCopyAnalyses.sourceDigest, sourceDigest),
                ),
              )
              .limit(1)
          )[0];
        if (!analysis)
          conflict("The concurrent copy analysis could not be resolved");
        if (analysis.status === "proposed" || analysis.status === "confirmed")
          return analysis;
        if (analysis.status === "queued")
          return attachCopyAnalysisJob(userId, analysis);
        if (analysis.status === "running") return analysis;
        const restarted = await reserveNextCopyAnalysisAttempt(
          userId,
          analysis,
          new Set(["failed", "cancelled", "dismissed"]),
        );
        if (!restarted)
          conflict("The copy analysis changed while it was being requested");
        return restarted;
      }),
    cancel: protectedProcedure
      .input(
        z.object({
          analysisId: id,
          expectedRevision: z.number().int().positive(),
        }),
      )
      .handler(async ({ context, input }) => {
        const userId = context.session.user.id;
        const analysis = await ownedAnalysis(userId, input.analysisId);
        if (analysis.revision !== input.expectedRevision)
          conflict("The copy analysis changed; reload before cancelling it");
        if (!analysis.jobId || !["queued", "running"].includes(analysis.status))
          badRequest("Only queued or running copy analysis can be cancelled");
        const [job] = await db
          .select()
          .from(jobs)
          .where(
            and(
              eq(jobs.id, analysis.jobId),
              eq(jobs.userId, userId),
              eq(jobs.kind, GRADE_COPY_ANALYSIS_JOB_KIND),
            ),
          )
          .limit(1);
        if (!job) notFound("Copy analysis job");
        const now = new Date();
        if (job.status === "queued") {
          return db.transaction(async (transaction) => {
            const [cancelledJob] = await transaction
              .update(jobs)
              .set({ status: "cancelled", updatedAt: now })
              .where(
                and(
                  eq(jobs.id, job.id),
                  eq(jobs.userId, userId),
                  eq(jobs.status, "queued"),
                ),
              )
              .returning({ id: jobs.id });
            if (!cancelledJob)
              conflict("The analysis started before it could be cancelled");
            const [cancelledAnalysis] = await transaction
              .update(learningCopyAnalyses)
              .set({
                status: "cancelled",
                revision: analysis.revision + 1,
                safeError: null,
                updatedAt: now,
              })
              .where(
                and(
                  eq(learningCopyAnalyses.id, analysis.id),
                  eq(learningCopyAnalyses.userId, userId),
                  eq(learningCopyAnalyses.jobId, job.id),
                  eq(learningCopyAnalyses.status, "queued"),
                  eq(learningCopyAnalyses.revision, input.expectedRevision),
                ),
              )
              .returning();
            if (!cancelledAnalysis)
              conflict("The analysis changed while it was being cancelled");
            return {
              analysis: cancelledAnalysis,
              cancellationRequested: false,
            };
          });
        }
        if (job.status !== "running")
          badRequest("This analysis job is already terminal");
        return db.transaction(async (transaction) => {
          await transaction
            .insert(jobRuntimeMetadata)
            .values({
              jobId: job.id,
              stage: "running",
              cancellation: "requested",
              updatedAt: now,
            })
            .onConflictDoUpdate({
              target: jobRuntimeMetadata.jobId,
              set: { cancellation: "requested", updatedAt: now },
            });
          const [cancelledAnalysis] = await transaction
            .update(learningCopyAnalyses)
            .set({
              status: "cancelled",
              revision: analysis.revision + 1,
              safeError: null,
              updatedAt: now,
            })
            .where(
              and(
                eq(learningCopyAnalyses.id, analysis.id),
                eq(learningCopyAnalyses.userId, userId),
                eq(learningCopyAnalyses.jobId, job.id),
                eq(learningCopyAnalyses.status, "running"),
                eq(learningCopyAnalyses.revision, input.expectedRevision),
              ),
            )
            .returning();
          if (!cancelledAnalysis)
            conflict("The analysis finished while cancellation was requested");
          return {
            analysis: cancelledAnalysis,
            cancellationRequested: true,
          };
        });
      }),
    retry: protectedProcedure
      .input(
        z.object({
          analysisId: id,
          expectedRevision: z.number().int().positive(),
          idempotencyKey,
        }),
      )
      .handler(async ({ context, input }) => {
        const userId = context.session.user.id;
        const analysis = await ownedAnalysis(userId, input.analysisId);
        if (analysis.revision !== input.expectedRevision)
          conflict("The copy analysis changed; reload before retrying it");
        if (!["failed", "cancelled"].includes(analysis.status))
          badRequest("Only failed or cancelled analysis can be retried");
        const queued = await reserveNextCopyAnalysisAttempt(
          userId,
          analysis,
          new Set(["failed", "cancelled"]),
        );
        if (!queued)
          conflict("The analysis changed while it was being retried");
        return queued;
      }),
    reanalyze: protectedProcedure
      .input(
        z.object({
          analysisId: id,
          idempotencyKey,
        }),
      )
      .handler(async ({ context, input }) => {
        const userId = context.session.user.id;
        const previous = await ownedAnalysis(userId, input.analysisId);
        const nextModelRevision = GRADE_COPY_ANALYSIS_MODEL_REVISION;
        if (previous.modelRevision === nextModelRevision)
          badRequest("Use retry when the model revision has not changed");
        const [existing] = await db
          .select()
          .from(learningCopyAnalyses)
          .where(
            and(
              eq(learningCopyAnalyses.userId, userId),
              eq(learningCopyAnalyses.attachmentId, previous.attachmentId),
              eq(learningCopyAnalyses.sourceDigest, previous.sourceDigest),
              eq(learningCopyAnalyses.modelRevision, nextModelRevision),
            ),
          )
          .limit(1);
        const [created] = existing
          ? []
          : await db
              .insert(learningCopyAnalyses)
              .values({
                attachmentId: previous.attachmentId,
                gradeId: previous.gradeId,
                sourceFileId: previous.sourceFileId,
                sourceDigest: previous.sourceDigest,
                provider: "pending",
                model: "pending",
                modelRevision: nextModelRevision,
                yearId: previous.yearId,
                periodId: previous.periodId,
                subjectId: previous.subjectId,
                userId,
              })
              .onConflictDoNothing()
              .returning();
        const analysis =
          existing ??
          created ??
          (
            await db
              .select()
              .from(learningCopyAnalyses)
              .where(
                and(
                  eq(learningCopyAnalyses.userId, userId),
                  eq(
                    learningCopyAnalyses.attachmentId,
                    previous.attachmentId,
                  ),
                  eq(
                    learningCopyAnalyses.sourceDigest,
                    previous.sourceDigest,
                  ),
                  eq(
                    learningCopyAnalyses.modelRevision,
                    nextModelRevision,
                  ),
                ),
              )
              .limit(1)
          )[0];
        if (!analysis)
          conflict("The concurrent reanalysis could not be resolved");
        if (
          ["proposed", "confirmed", "queued", "running"].includes(
            analysis.status,
          )
        )
          return analysis.status === "queued"
            ? attachCopyAnalysisJob(userId, analysis)
            : analysis;
        const queued = await reserveNextCopyAnalysisAttempt(
          userId,
          analysis,
          new Set(["failed", "cancelled", "dismissed"]),
        );
        if (!queued)
          conflict("The new analysis changed while it was being queued");
        return queued;
      }),
    review: protectedProcedure
      .input(
        z.object({
          analysisId: id,
          kind: z.enum(["confirm", "correct", "dismiss", "unconfirm"]),
          expectedRevision: z.number().int().positive(),
          regions: z.array(reviewedRegionSchema).max(250).default([]),
          idempotencyKey,
        }),
      )
      .handler(async ({ context, input }) => {
        const userId = context.session.user.id;
        const [existingReview] = await db
          .select()
          .from(learningCopyAnalysisReviews)
          .where(
            and(
              eq(learningCopyAnalysisReviews.userId, userId),
              eq(
                learningCopyAnalysisReviews.idempotencyKey,
                input.idempotencyKey,
              ),
            ),
          )
          .limit(1);
        const exactReplay = (review: typeof existingReview) =>
          Boolean(
            review &&
            review.analysisId === input.analysisId &&
            review.kind === input.kind &&
            review.fromRevision === input.expectedRevision &&
            canonicalJson(review.selectionJson) ===
              canonicalJson(input.regions),
          );
        if (existingReview) {
          if (!exactReplay(existingReview))
            conflict(
              "This review key was already used for another copy decision",
            );
          return ownedAnalysis(userId, input.analysisId);
        }
        const analysis = await ownedAnalysis(userId, input.analysisId);
        if (analysis.revision !== input.expectedRevision)
          conflict("The copy proposal changed; reload before reviewing it");
        if (
          (input.kind === "confirm" || input.kind === "correct") &&
          analysis.status !== "proposed"
        )
          badRequest("Only a proposed analysis can be confirmed");
        if (
          input.kind === "dismiss" &&
          !["proposed", "failed"].includes(analysis.status)
        )
          badRequest("This analysis cannot be dismissed now");
        if (input.kind === "unconfirm" && analysis.status !== "confirmed")
          badRequest("Only a confirmed analysis can be unconfirmed");
        const proposalRegions = new Map(
          (analysis.proposalJson?.pages ?? [])
            .flatMap((page) => page.regions)
            .map((region) => [region.id, region]),
        );
        if (
          input.regions.some((region) => !proposalRegions.has(region.regionId))
        )
          badRequest(
            "Every reviewed region must belong to the stored proposal",
          );
        const objectiveIds = [
          ...new Set(input.regions.flatMap((region) => region.objectiveIds)),
        ];
        const objectives = objectiveIds.length
          ? await db
              .select()
              .from(learningObjectives)
              .where(
                and(
                  eq(learningObjectives.userId, userId),
                  inArray(learningObjectives.id, objectiveIds),
                ),
              )
          : [];
        if (
          objectives.length !== objectiveIds.length ||
          objectives.some(
            (objective) =>
              objective.yearId !== analysis.yearId ||
              objective.subjectId !== analysis.subjectId,
          )
        )
          badRequest(
            "Every selected objective must belong to this subject and year",
          );
        const byId = new Map(
          objectives.map((objective) => [objective.id, objective]),
        );
        const nextRevision = analysis.revision + 1;
        const affected = new Set<string>();
        const reviewResult = await db.transaction(async (transaction) => {
          const [moved] = await transaction
            .update(learningCopyAnalyses)
            .set({
              status:
                input.kind === "dismiss"
                  ? "dismissed"
                  : input.kind === "unconfirm"
                    ? "proposed"
                    : "confirmed",
              revision: nextRevision,
              updatedAt: new Date(),
            })
            .where(
              and(
                eq(learningCopyAnalyses.id, analysis.id),
                eq(learningCopyAnalyses.userId, userId),
                eq(learningCopyAnalyses.revision, input.expectedRevision),
              ),
            )
            .returning({ id: learningCopyAnalyses.id });
          if (!moved) {
            const [concurrentReview] = await transaction
              .select()
              .from(learningCopyAnalysisReviews)
              .where(
                and(
                  eq(learningCopyAnalysisReviews.userId, userId),
                  eq(
                    learningCopyAnalysisReviews.idempotencyKey,
                    input.idempotencyKey,
                  ),
                ),
              )
              .limit(1);
            if (exactReplay(concurrentReview)) return { replayed: true };
            conflict("The copy proposal changed while it was being reviewed");
          }
          await transaction.insert(learningCopyAnalysisReviews).values({
            analysisId: analysis.id,
            kind: input.kind,
            fromRevision: input.expectedRevision,
            toRevision: nextRevision,
            selectionJson: input.regions,
            idempotencyKey: input.idempotencyKey,
            userId,
          });
          if (input.kind === "confirm" || input.kind === "correct") {
            for (const reviewed of input.regions) {
              const proposed = proposalRegions.get(reviewed.regionId)!;
              for (const objectiveId of reviewed.objectiveIds) {
                const objective = byId.get(objectiveId)!;
                const evidenceId = newId("lev");
                await transaction.insert(learningEvidence).values({
                  id: evidenceId,
                  kind:
                    proposed.kind === "teacher-comment"
                      ? "teacher-comment"
                      : "copy-region",
                  objectiveId,
                  sourceKind: "grade-copy-analysis",
                  sourceId: analysis.id,
                  sourceVersion: String(input.expectedRevision),
                  locatorJson: {
                    kind:
                      analysis.proposalJson?.sourceTextKind === "ocr" &&
                      analysis.pageCount
                        ? "pdf"
                        : "image",
                    page: proposed.page,
                    ...(proposed.bbox ? { bbox: proposed.bbox } : {}),
                  },
                  observedOutcome: reviewed.observedOutcome,
                  denominator: reviewed.denominator,
                  difficulty: reviewed.difficulty,
                  reliability: proposed.kind === "teacher-comment" ? 0.7 : 0.85,
                  occurredAt: analysis.createdAt,
                  producerKind: "human",
                  producerDescriptor: `review:${input.kind}`,
                  algorithmRevision: "copy-review-v1",
                  confidence: proposed.confidence,
                  yearId: analysis.yearId,
                  periodId: analysis.periodId,
                  subjectId: analysis.subjectId,
                  userId,
                });
                await transaction.insert(learningEvidenceDecisions).values({
                  evidenceId,
                  state: "included",
                  reason: "confirmed copy review",
                  actor: "user",
                  idempotencyKey: `${input.idempotencyKey}:${evidenceId}`,
                  userId,
                });
                if (reviewed.error)
                  await transaction.insert(learningErrorObservations).values({
                    evidenceId,
                    objectiveId,
                    conceptId: objective.conceptId,
                    taxonomy: reviewed.error.taxonomy,
                    quotedEvidence: proposed.text.slice(0, 2_000),
                    locatorJson: {
                      kind: "pdf",
                      page: proposed.page,
                      ...(proposed.bbox ? { bbox: proposed.bbox } : {}),
                    },
                    explanation: reviewed.error.explanation,
                    severity: reviewed.error.severity,
                    confidence: reviewed.error.confidence,
                    status: "confirmed",
                    userId,
                  });
                affected.add(objectiveId);
              }
            }
          } else if (input.kind === "unconfirm") {
            const prior = await transaction
              .select({
                id: learningEvidence.id,
                objectiveId: learningEvidence.objectiveId,
              })
              .from(learningEvidence)
              .where(
                and(
                  eq(learningEvidence.userId, userId),
                  eq(learningEvidence.sourceKind, "grade-copy-analysis"),
                  eq(learningEvidence.sourceId, analysis.id),
                ),
              );
            for (const row of prior) {
              await transaction.insert(learningEvidenceDecisions).values({
                evidenceId: row.id,
                state: "excluded",
                reason: "copy review was undone",
                actor: "system-correction",
                idempotencyKey: `${input.idempotencyKey}:${row.id}`,
                userId,
              });
              affected.add(row.objectiveId);
            }
          }
          return { replayed: false };
        });
        if (reviewResult.replayed) return ownedAnalysis(userId, analysis.id);
        await Promise.all(
          [...affected].map((objectiveId) =>
            recomputeObjectiveMastery(userId, objectiveId),
          ),
        );
        return ownedAnalysis(userId, analysis.id);
      }),
  },
  evidence: {
    get: protectedProcedure
      .input(z.object({ evidenceId: id }))
      .handler(async ({ context, input }) => {
        const userId = context.session.user.id;
        const [row] = await db
          .select({
            evidence: learningEvidence,
            objective: learningObjectives,
            concept: learningConcepts,
          })
          .from(learningEvidence)
          .innerJoin(
            learningObjectives,
            eq(learningObjectives.id, learningEvidence.objectiveId),
          )
          .innerJoin(
            learningConcepts,
            eq(learningConcepts.id, learningObjectives.conceptId),
          )
          .where(
            and(
              eq(learningEvidence.id, input.evidenceId),
              eq(learningEvidence.userId, userId),
              eq(learningObjectives.userId, userId),
              eq(learningConcepts.userId, userId),
            ),
          )
          .limit(1);
        if (!row) notFound("Learning evidence");
        const [decision, errors] = await Promise.all([
          db
            .select()
            .from(learningEvidenceDecisions)
            .where(
              and(
                eq(learningEvidenceDecisions.evidenceId, row.evidence.id),
                eq(learningEvidenceDecisions.userId, userId),
              ),
            )
            .orderBy(
              desc(learningEvidenceDecisions.createdAt),
              desc(learningEvidenceDecisions.id),
            )
            .limit(1)
            .then((rows) => rows[0] ?? null),
          db
            .select()
            .from(learningErrorObservations)
            .where(
              and(
                eq(learningErrorObservations.evidenceId, row.evidence.id),
                eq(learningErrorObservations.userId, userId),
              ),
            )
            .orderBy(desc(learningErrorObservations.createdAt)),
        ]);
        return {
          ...row,
          decision: decision ?? {
            state: "included" as const,
            reason: null,
          },
          errors,
        };
      }),
    list: protectedProcedure
      .input(z.object({ objectiveId: id }))
      .handler(async ({ context, input }) => {
        await ownedObjective(context.session.user.id, input.objectiveId);
        const rows = await db
          .select()
          .from(learningEvidence)
          .where(
            and(
              eq(learningEvidence.userId, context.session.user.id),
              eq(learningEvidence.objectiveId, input.objectiveId),
            ),
          )
          .orderBy(desc(learningEvidence.occurredAt));
        const states = await latestEvidenceStates(
          context.session.user.id,
          rows.map((row) => row.id),
        );
        return rows.map((row) => ({
          ...row,
          decision: states.get(row.id) ?? {
            state: "included" as const,
            reason: null,
          },
        }));
      }),
    decide: protectedProcedure
      .input(
        z.object({
          evidenceId: id,
          state: z.enum(["included", "excluded"]),
          reason: z.string().trim().max(1_000).nullable().default(null),
          idempotencyKey,
        }),
      )
      .handler(async ({ context, input }) => {
        const userId = context.session.user.id;
        const [evidence] = await db
          .select()
          .from(learningEvidence)
          .where(
            and(
              eq(learningEvidence.id, input.evidenceId),
              eq(learningEvidence.userId, userId),
            ),
          )
          .limit(1);
        if (!evidence) notFound("Learning evidence");
        const { effectiveDecision, previousDecision } = await db.transaction(
          async (transaction) => {
            const [previousDecision] = await transaction
              .select()
              .from(learningEvidenceDecisions)
              .where(
                and(
                  eq(learningEvidenceDecisions.evidenceId, evidence.id),
                  eq(learningEvidenceDecisions.userId, userId),
                ),
              )
              .orderBy(
                desc(learningEvidenceDecisions.createdAt),
                desc(learningEvidenceDecisions.id),
              )
              .limit(1);
            const [decision] = await transaction
              .insert(learningEvidenceDecisions)
              .values({
                evidenceId: evidence.id,
                state: input.state,
                reason: input.reason,
                actor: "user",
                idempotencyKey: input.idempotencyKey,
                userId,
              })
              .onConflictDoNothing()
              .returning();
            const effectiveDecision =
              decision ??
              (await transaction
                .select()
                .from(learningEvidenceDecisions)
                .where(
                  and(
                    eq(learningEvidenceDecisions.userId, userId),
                    eq(
                      learningEvidenceDecisions.idempotencyKey,
                      input.idempotencyKey,
                    ),
                  ),
                )
                .limit(1)
                .then((rows) => rows[0]));
            if (!effectiveDecision) {
              throw new Error(
                "The learning evidence decision was not persisted",
              );
            }
            return { effectiveDecision, previousDecision };
          },
        );
        await recomputeObjectiveMastery(userId, evidence.objectiveId);
        return {
          decision: effectiveDecision,
          previousDecision:
            previousDecision ??
            ({ id: null, state: "included", reason: null } as const),
        };
      }),
  },
  mastery: {
    get: protectedProcedure
      .input(z.object({ objectiveId: id }))
      .handler(async ({ context, input }) => {
        const userId = context.session.user.id;
        const objective = await ownedObjective(userId, input.objectiveId);
        const [row] = await db
          .select({
            concept: learningConcepts,
            projection: learningMasteryProjections,
          })
          .from(learningConcepts)
          .leftJoin(
            learningMasteryCurrent,
            and(
              eq(learningMasteryCurrent.objectiveId, objective.id),
              eq(learningMasteryCurrent.userId, userId),
            ),
          )
          .leftJoin(
            learningMasteryProjections,
            eq(
              learningMasteryProjections.id,
              learningMasteryCurrent.projectionId,
            ),
          )
          .where(
            and(
              eq(learningConcepts.id, objective.conceptId),
              eq(learningConcepts.userId, userId),
            ),
          )
          .limit(1);
        if (!row) notFound("Learning concept");
        return { objective, concept: row.concept, projection: row.projection };
      }),
    list: protectedProcedure
      .input(z.object({ yearId: id, subjectId: id.nullable().optional() }))
      .handler(async ({ context, input }) => {
        await requireYear(context.session.user.id, input.yearId);
        return db
          .select({
            objective: learningObjectives,
            concept: learningConcepts,
            projection: learningMasteryProjections,
          })
          .from(learningObjectives)
          .innerJoin(
            learningConcepts,
            eq(learningConcepts.id, learningObjectives.conceptId),
          )
          .leftJoin(
            learningMasteryCurrent,
            eq(learningMasteryCurrent.objectiveId, learningObjectives.id),
          )
          .leftJoin(
            learningMasteryProjections,
            eq(
              learningMasteryProjections.id,
              learningMasteryCurrent.projectionId,
            ),
          )
          .where(
            and(
              eq(learningObjectives.userId, context.session.user.id),
              eq(learningObjectives.yearId, input.yearId),
              input.subjectId
                ? eq(learningObjectives.subjectId, input.subjectId)
                : undefined,
              isNull(learningObjectives.archivedAt),
            ),
          )
          .orderBy(
            asc(learningConcepts.sortOrder),
            asc(learningObjectives.statement),
          );
      }),
    explain: protectedProcedure
      .input(z.object({ objectiveId: id }))
      .handler(async ({ context, input }) => {
        const objective = await ownedObjective(
          context.session.user.id,
          input.objectiveId,
        );
        const [projection] = await db
          .select({ projection: learningMasteryProjections })
          .from(learningMasteryCurrent)
          .innerJoin(
            learningMasteryProjections,
            eq(
              learningMasteryProjections.id,
              learningMasteryCurrent.projectionId,
            ),
          )
          .where(
            and(
              eq(learningMasteryCurrent.objectiveId, objective.id),
              eq(learningMasteryCurrent.userId, context.session.user.id),
            ),
          )
          .limit(1);
        return { objective, projection: projection?.projection ?? null };
      }),
    recompute: protectedProcedure
      .input(z.object({ objectiveId: id }))
      .handler(({ context, input }) =>
        recomputeObjectiveMastery(context.session.user.id, input.objectiveId),
      ),
  },
  plan: {
    list: protectedProcedure
      .input(z.object({ yearId: id }))
      .handler(async ({ context, input }) => {
        await requireYear(context.session.user.id, input.yearId);
        return db
          .select({
            item: learningPlanItems,
            objective: learningObjectives,
            concept: learningConcepts,
            planningTask: planningTasks,
          })
          .from(learningPlanItems)
          .innerJoin(
            learningObjectives,
            eq(learningObjectives.id, learningPlanItems.objectiveId),
          )
          .innerJoin(
            learningConcepts,
            eq(learningConcepts.id, learningObjectives.conceptId),
          )
          .leftJoin(
            planningTasks,
            and(
              eq(planningTasks.id, learningPlanItems.planningTaskId),
              eq(planningTasks.userId, context.session.user.id),
              isNull(planningTasks.trashedAt),
            ),
          )
          .where(
            and(
              eq(learningPlanItems.userId, context.session.user.id),
              eq(learningPlanItems.yearId, input.yearId),
            ),
          )
          .orderBy(desc(learningPlanItems.createdAt));
      }),
    propose: protectedProcedure
      .input(
        z.object({
          yearId: id,
          subjectId: id.nullable().optional(),
          limit: z.number().int().min(1).max(20).default(5),
          availableMinutes: z.number().int().min(5).max(240).default(30),
        }),
      )
      .handler(async ({ context, input }) => {
        const userId = context.session.user.id;
        await requireYear(userId, input.yearId);
        const candidates = await db
          .select({
            objective: learningObjectives,
            concept: learningConcepts,
            projection: learningMasteryProjections,
          })
          .from(learningObjectives)
          .innerJoin(
            learningConcepts,
            eq(learningConcepts.id, learningObjectives.conceptId),
          )
          .leftJoin(
            learningMasteryCurrent,
            eq(learningMasteryCurrent.objectiveId, learningObjectives.id),
          )
          .leftJoin(
            learningMasteryProjections,
            eq(
              learningMasteryProjections.id,
              learningMasteryCurrent.projectionId,
            ),
          )
          .where(
            and(
              eq(learningObjectives.userId, userId),
              eq(learningObjectives.yearId, input.yearId),
              input.subjectId
                ? eq(learningObjectives.subjectId, input.subjectId)
                : undefined,
              isNull(learningObjectives.archivedAt),
            ),
          );
        const objectiveIds = candidates.map((row) => row.objective.id);
        const [prerequisites, personalTasks, assignments] = await Promise.all([
          objectiveIds.length
            ? db
                .select({
                  objectiveId: learningObjectivePrerequisites.objectiveId,
                  prerequisiteObjectiveId:
                    learningObjectivePrerequisites.prerequisiteObjectiveId,
                })
                .from(learningObjectivePrerequisites)
                .where(
                  and(
                    eq(learningObjectivePrerequisites.userId, userId),
                    inArray(
                      learningObjectivePrerequisites.objectiveId,
                      objectiveIds,
                    ),
                  ),
                )
            : [],
          db
            .select({
              subjectId: planningTasks.subjectId,
              dueAt: planningTasks.dueAt,
            })
            .from(planningTasks)
            .where(
              and(
                eq(planningTasks.userId, userId),
                eq(planningTasks.yearId, input.yearId),
                or(
                  eq(planningTasks.status, "todo"),
                  eq(planningTasks.status, "doing"),
                ),
                isNull(planningTasks.trashedAt),
              ),
            ),
          db
            .select({
              subjectId: academicAssignments.subjectId,
              dueAt: academicAssignments.dueAt,
            })
            .from(academicAssignments)
            .where(
              and(
                eq(academicAssignments.userId, userId),
                eq(academicAssignments.yearId, input.yearId),
                isNull(academicAssignments.completedAt),
              ),
            ),
        ]);
        const projectionByObjective = new Map(
          candidates.map((row) => [row.objective.id, row.projection]),
        );
        const prerequisitesByObjective = new Map<string, string[]>();
        const requiredBy = new Map<string, string[]>();
        for (const edge of prerequisites) {
          const values = prerequisitesByObjective.get(edge.objectiveId) ?? [];
          values.push(edge.prerequisiteObjectiveId);
          prerequisitesByObjective.set(edge.objectiveId, values);
          const reverse = requiredBy.get(edge.prerequisiteObjectiveId) ?? [];
          reverse.push(edge.objectiveId);
          requiredBy.set(edge.prerequisiteObjectiveId, reverse);
        }
        const dueBySubject = new Map<string, Date>();
        for (const task of [...personalTasks, ...assignments]) {
          if (!task.subjectId || !task.dueAt) continue;
          const current = dueBySubject.get(task.subjectId);
          if (!current || task.dueAt < current)
            dueBySubject.set(task.subjectId, task.dueAt);
        }
        const now = Date.now();
        const scored = candidates.map((row) => {
          const dueAt = row.objective.subjectId
            ? (dueBySubject.get(row.objective.subjectId) ?? null)
            : null;
          const prerequisiteIds =
            prerequisitesByObjective.get(row.objective.id) ?? [];
          const neededByObjectiveIds = requiredBy.get(row.objective.id) ?? [];
          return {
            ...row,
            policy: learningPlanPolicy({
              estimate: row.projection?.estimate ?? null,
              low: row.projection?.low ?? null,
              high: row.projection?.high ?? null,
              freshnessDays: row.projection?.freshnessDays ?? null,
              dueAt,
              prerequisiteEstimates: prerequisiteIds.map((objectiveId) => ({
                id: objectiveId,
                estimate:
                  projectionByObjective.get(objectiveId)?.estimate ?? null,
              })),
              dependentEstimates: neededByObjectiveIds.map((objectiveId) => ({
                id: objectiveId,
                estimate:
                  projectionByObjective.get(objectiveId)?.estimate ?? null,
              })),
              availableMinutes: input.availableMinutes,
              now: new Date(now),
            }),
          };
        });
        const ranked = scored
          .sort(
            (left, right) =>
              right.policy.score - left.policy.score ||
              left.objective.id.localeCompare(right.objective.id),
          )
          .slice(0, input.limit);
        const created = [];
        for (const row of ranked) {
          const cursor = row.projection?.evidenceCursor ?? "no-evidence";
          const [existing] = await db
            .select()
            .from(learningPlanItems)
            .where(
              and(
                eq(learningPlanItems.userId, userId),
                eq(learningPlanItems.objectiveId, row.objective.id),
                eq(learningPlanItems.evidenceCursor, cursor),
                or(
                  eq(learningPlanItems.status, "proposed"),
                  eq(learningPlanItems.status, "accepted"),
                ),
              ),
            )
            .limit(1);
          if (existing) {
            created.push(existing);
            continue;
          }
          const [item] = await db
            .insert(learningPlanItems)
            .values({
              objectiveId: row.objective.id,
              rationaleJson: {
                ...row.policy,
                reason: row.projection
                  ? "low-or-uncertain-mastery"
                  : "objective-without-evidence",
              },
              evidenceCursor: cursor,
              activityKind:
                row.projection && row.projection.evidenceCount >= 2
                  ? "quiz"
                  : "course-review",
              difficulty: row.projection?.estimate ?? null,
              estimatedMinutes: row.policy.estimatedMinutes,
              yearId: row.objective.yearId,
              subjectId: row.objective.subjectId,
              userId,
            })
            .returning();
          if (item) created.push(item);
        }
        return created;
      }),
    apply: protectedProcedure
      .input(
        z.object({
          itemId: id,
          expectedRevision: z.number().int().positive(),
          scheduledAt: z.coerce.date().nullable().default(null),
          dueAt: z.coerce.date().nullable().default(null),
        }),
      )
      .handler(async ({ context, input }) => {
        const userId = context.session.user.id;
        let result;
        try {
          result = await applyLearningPlanItemCommand(db.$client, {
            userId,
            itemId: input.itemId,
            expectedRevision: input.expectedRevision,
            scheduledAt: input.scheduledAt,
            dueAt: input.dueAt,
          });
        } catch (error) {
          if (error instanceof LearningPlanApplyError) {
            if (error.code === "not-found") notFound("Learning plan item");
            if (error.code === "invalid-state" || error.code === "invalid-task")
              badRequest(error.message);
            conflict(error.message);
          }
          if (error instanceof PersonalTaskCommandError) {
            if (error.code === "not-found") notFound(error.message);
            if (error.code === "invalid") badRequest(error.message);
            conflict(error.message);
          }
          throw error;
        }
        const [updated] = await db
          .select()
          .from(learningPlanItems)
          .where(
            and(
              eq(learningPlanItems.id, result.itemId),
              eq(learningPlanItems.userId, userId),
            ),
          )
          .limit(1);
        if (!updated) notFound("Learning plan item");
        return { ...updated, replayed: result.replayed };
      }),
    setStatus: protectedProcedure
      .input(
        z.object({
          itemId: id,
          status: z.enum([
            "proposed",
            "accepted",
            "in-progress",
            "completed",
            "dismissed",
          ]),
          expectedRevision: z.number().int().positive(),
        }),
      )
      .handler(async ({ context, input }) => {
        const [updated] = await db
          .update(learningPlanItems)
          .set({
            status: input.status,
            revision: input.expectedRevision + 1,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(learningPlanItems.id, input.itemId),
              eq(learningPlanItems.userId, context.session.user.id),
              eq(learningPlanItems.revision, input.expectedRevision),
            ),
          )
          .returning();
        if (!updated)
          conflict("The learning plan item changed; reload before updating it");
        return updated;
      }),
  },
  progress: protectedProcedure
    .input(z.object({ yearId: id }))
    .handler(async ({ context, input }) => {
      await requireYear(context.session.user.id, input.yearId);
      const projections = await db
        .select({
          projection: learningMasteryProjections,
          objective: learningObjectives,
          concept: learningConcepts,
        })
        .from(learningMasteryProjections)
        .innerJoin(
          learningObjectives,
          eq(learningObjectives.id, learningMasteryProjections.objectiveId),
        )
        .innerJoin(
          learningConcepts,
          eq(learningConcepts.id, learningObjectives.conceptId),
        )
        .where(
          and(
            eq(learningMasteryProjections.userId, context.session.user.id),
            eq(learningObjectives.yearId, input.yearId),
          ),
        )
        .orderBy(desc(learningMasteryProjections.createdAt))
        .limit(200);
      const schoolGrades = await db
        .select({
          id: grades.id,
          name: grades.name,
          value: grades.value,
          outOf: grades.outOf,
          passedAt: grades.passedAt,
          subjectId: grades.subjectId,
        })
        .from(grades)
        .where(
          and(
            eq(grades.userId, context.session.user.id),
            eq(grades.yearId, input.yearId),
          ),
        )
        .orderBy(desc(grades.passedAt))
        .limit(100);
      return {
        projections,
        schoolGrades,
        disclaimer:
          "Ces événements sont associés dans le temps ; ils ne prouvent pas à eux seuls une causalité.",
      };
    }),
  privacy: {
    preview: protectedProcedure.handler(async ({ context }) => {
      const exported = await exportLearningData(context.session.user.id);
      return {
        counts: Object.fromEntries(
          Object.entries(exported.data).map(([name, rows]) => [
            name,
            rows.length,
          ]),
        ),
        derivativeScopes: {
          "copy-analysis":
            "Deletes OCR/model proposals, reviews and copy-derived evidence while retaining original grade attachments.",
          "all-computed":
            "Also deletes model/parser evidence, mastery histories and learning-plan suggestions while retaining concepts and human/provider evidence.",
        },
        fullDeletion:
          "Deletes every Learning row only. Grades, original files, projects and authoritative planning tasks remain.",
      };
    }),
    export: protectedProcedure.handler(async ({ context }) => {
      const json = await exportLearningData(context.session.user.id);
      return { json, markdown: learningExportMarkdown(json) };
    }),
    deleteDerivatives: protectedProcedure
      .input(
        z.object({
          scope: z.enum(["copy-analysis", "all-computed"]),
          confirmation: z.literal("DELETE DERIVATIVES"),
        }),
      )
      .handler(({ context, input }) =>
        deleteLearningDerivatives(context.session.user.id, input.scope),
      ),
    deleteAll: protectedProcedure
      .input(z.object({ confirmation: z.literal("DELETE LEARNING") }))
      .handler(({ context }) => deleteAllLearningData(context.session.user.id)),
  },
};
