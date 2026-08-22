import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db";
import {
  learningEvidence,
  learningEvidenceDecisions,
  learningObjectives,
  learningQuizAttemptItems,
  learningQuizAttemptModes,
  learningQuizQuestionVersions,
  quizAttempts,
  type QuizContentV2,
  type QuizQuestionV2,
} from "../db/schema";
import { badRequest, protectedProcedure } from "../lib/orpc";
import { requireStudyDocument } from "../lib/ownership";
import {
  quizContentSchema,
  quizPromptContent,
} from "../lib/study-document-content";
import { newId } from "../lib/id";
import { scoreQuizQuestion } from "../learning/quiz-scoring";
import { recomputeObjectiveMastery } from "./learning";

const answerSchema = z.union([
  z.array(z.number().int().nonnegative()).max(12),
  z.string().max(8 * 1024),
  z.array(z.string().max(1_024)).max(50),
]);

const answersSchema = z.array(answerSchema).max(200);

async function requireQuizAttempt(userId: string, attemptId: string) {
  const [attempt] = await db
    .select()
    .from(quizAttempts)
    .where(and(eq(quizAttempts.id, attemptId), eq(quizAttempts.userId, userId)))
    .limit(1);
  if (!attempt) badRequest("This quiz attempt is unavailable");
  return attempt;
}

function missingLearningTable(error: unknown) {
  return /no such table: learning_/i.test(
    error instanceof Error ? error.message : String(error),
  );
}

export const quizAttemptsRouter = {
  list: protectedProcedure
    .input(z.object({ documentId: z.string().min(1) }).strict())
    .handler(async ({ context, input }) => {
      const userId = context.session.user.id;
      const document = await requireStudyDocument(userId, input.documentId);
      if (document.kind !== "quiz") badRequest("This document is not a quiz");
      const attempts = await db
        .select({
          id: quizAttempts.id,
          documentId: quizAttempts.documentId,
          sourceRevision: quizAttempts.sourceRevision,
          startedAt: quizAttempts.startedAt,
          completedAt: quizAttempts.completedAt,
          score: quizAttempts.score,
          outOf: quizAttempts.outOf,
          questionsJson: quizAttempts.questionsJson,
        })
        .from(quizAttempts)
        .where(
          and(
            eq(quizAttempts.documentId, document.id),
            eq(quizAttempts.userId, userId),
          ),
        )
        .orderBy(desc(quizAttempts.startedAt))
        .limit(100);
      try {
        const modes = attempts.length
          ? await db
              .select()
              .from(learningQuizAttemptModes)
              .where(
                and(
                  eq(learningQuizAttemptModes.userId, userId),
                  inArray(
                    learningQuizAttemptModes.attemptId,
                    attempts.map((attempt) => attempt.id),
                  ),
                ),
              )
          : [];
        const byAttempt = new Map(
          modes.map((mode) => [mode.attemptId, mode.mode]),
        );
        return attempts.map(({ questionsJson, ...attempt }) => ({
          ...attempt,
          mode: byAttempt.get(attempt.id) ?? null,
          pendingReviewCount:
            attempt.completedAt && attempt.outOf !== null
              ? Math.max(0, questionsJson.length - attempt.outOf)
              : 0,
        }));
      } catch (error) {
        if (!missingLearningTable(error)) throw error;
        // Until plan 037's consolidated schema wave is applied, v1 quizzes
        // retain their exact historical contract.
        return attempts.map(({ questionsJson, ...attempt }) => ({
          ...attempt,
          mode: null,
          pendingReviewCount:
            attempt.completedAt && attempt.outOf !== null
              ? Math.max(0, questionsJson.length - attempt.outOf)
              : 0,
        }));
      }
    }),

  start: protectedProcedure
    .input(
      z
        .object({
          documentId: z.string().min(1),
          mode: z.enum(["practice", "progress"]).default("practice"),
          latencyConsent: z.boolean().default(false),
        })
        .strict(),
    )
    .handler(async ({ context, input }) => {
      const userId = context.session.user.id;
      const document = await requireStudyDocument(userId, input.documentId);
      if (document.deletedAt) badRequest("A trashed quiz cannot be attempted");
      if (document.kind !== "quiz") badRequest("This document is not a quiz");
      const content = quizContentSchema.safeParse(document.metaJson);
      if (!content.success) badRequest("This quiz has invalid questions");
      if (content.data.version === 2) {
        if (input.mode === "progress" && !document.subjectId) {
          badRequest("A progress quiz must belong to one subject");
        }
        const objectiveIds = [
          ...new Set(
            content.data.questions.flatMap((question) => question.objectiveIds),
          ),
        ];
        const owned = objectiveIds.length
          ? await db
              .select()
              .from(learningObjectives)
              .where(
                and(
                  eq(learningObjectives.userId, userId),
                  eq(learningObjectives.yearId, document.yearId),
                  inArray(learningObjectives.id, objectiveIds),
                ),
              )
          : [];
        if (
          owned.length !== objectiveIds.length ||
          owned.some((objective) => objective.subjectId !== document.subjectId)
        ) {
          badRequest(
            "Quiz objectives must be owned and belong to the quiz scope",
          );
        }
      }
      const attempt = await db.transaction(async (transaction) => {
        const [created] = await transaction
          .insert(quizAttempts)
          .values({
            documentId: document.id,
            sourceRevision: document.revision,
            questionsJson: content.data.questions,
            subjectId: document.subjectId,
            yearId: document.yearId,
            userId,
          })
          .returning();
        if (!created) throw new Error("The quiz attempt was not created");
        if (content.data.version === 2) {
          await transaction.insert(learningQuizAttemptModes).values({
            attemptId: created.id,
            mode: input.mode,
            latencyConsent: input.latencyConsent,
            userId,
          });
          await transaction
            .insert(learningQuizQuestionVersions)
            .values(
              content.data.questions.map((question) => ({
                documentId: document.id,
                documentRevision: document.revision,
                questionId: question.id,
                kind: question.kind,
                prompt:
                  question.kind === "cloze" ? question.text : question.prompt,
                objectiveIdsJson: question.objectiveIds,
                difficulty: question.difficulty,
                sourceProofsJson: question.sourceProofs,
                rubricRevision: question.rubricRevision,
                rubricJson: question.rubric,
                generationProvenanceJson: question.generationProvenance,
                validationState: question.validationState,
                userId,
              })),
            )
            .onConflictDoNothing();
        }
        return created;
      });
      return {
        id: attempt.id,
        mode: input.mode,
        sourceRevision: attempt.sourceRevision,
        startedAt: attempt.startedAt,
        questions: quizPromptContent(content.data).questions,
      };
    }),

  complete: protectedProcedure
    .input(
      z
        .object({
          attemptId: z.string().min(1),
          answers: answersSchema,
          itemMetrics: z
            .array(
              z.object({
                latencyMs: z
                  .number()
                  .int()
                  .nonnegative()
                  .nullable()
                  .default(null),
                hintsUsed: z.number().int().min(0).max(100).default(0),
              }),
            )
            .max(200)
            .optional(),
        })
        .strict(),
    )
    .handler(async ({ context, input }) => {
      const userId = context.session.user.id;
      const attempt = await requireQuizAttempt(userId, input.attemptId);
      if (attempt.completedAt)
        badRequest("This quiz attempt is already complete");
      if (input.answers.length !== attempt.questionsJson.length) {
        badRequest("Answer every quiz question before submitting");
      }
      const questionScores = attempt.questionsJson.map((question, index) =>
        scoreQuizQuestion(question, input.answers[index]),
      );
      const automaticallyScored = questionScores.filter(
        (result) => result.normalizedOutcome !== null,
      );
      const score = automaticallyScored.reduce(
        (total, result) => total + result.normalizedOutcome!,
        0,
      );
      const outOf = automaticallyScored.length;
      const completedAt = new Date();
      const modeRow = await db
        .select()
        .from(learningQuizAttemptModes)
        .where(
          and(
            eq(learningQuizAttemptModes.attemptId, attempt.id),
            eq(learningQuizAttemptModes.userId, userId),
          ),
        )
        .limit(1)
        .then((rows) => rows[0] ?? null)
        .catch((error) => {
          if (missingLearningTable(error)) return null;
          throw error;
        });
      const affectedObjectives = new Set<string>();
      const completed = await db.transaction(async (transaction) => {
        const [saved] = await transaction
          .update(quizAttempts)
          .set({
            answersJson: input.answers,
            score,
            outOf,
            completedAt,
            updatedAt: completedAt,
          })
          .where(
            and(
              eq(quizAttempts.id, attempt.id),
              eq(quizAttempts.userId, userId),
              isNull(quizAttempts.completedAt),
            ),
          )
          .returning({
            id: quizAttempts.id,
            score: quizAttempts.score,
            outOf: quizAttempts.outOf,
            completedAt: quizAttempts.completedAt,
          });
        if (!saved) badRequest("This quiz attempt was already submitted");
        const v2Questions = attempt.questionsJson.filter(
          (question): question is QuizQuestionV2 => "id" in question,
        );
        if (v2Questions.length === attempt.questionsJson.length) {
          const versions = await transaction
            .select()
            .from(learningQuizQuestionVersions)
            .where(
              and(
                eq(learningQuizQuestionVersions.documentId, attempt.documentId),
                eq(
                  learningQuizQuestionVersions.documentRevision,
                  attempt.sourceRevision,
                ),
                eq(learningQuizQuestionVersions.userId, userId),
              ),
            );
          const byQuestionId = new Map(
            versions.map((version) => [version.questionId, version]),
          );
          for (let index = 0; index < v2Questions.length; index += 1) {
            const question = v2Questions[index]!;
            const version = byQuestionId.get(question.id);
            if (!version) throw new Error("Quiz question version is missing");
            const scoring = questionScores[index]!;
            const normalizedOutcome = scoring.normalizedOutcome;
            const canCreateEvidence =
              modeRow?.mode === "progress" &&
              question.validationState === "reviewed" &&
              question.sourceProofs.length > 0 &&
              question.objectiveIds.length > 0 &&
              normalizedOutcome !== null;
            let firstEvidenceId: string | null = null;
            if (canCreateEvidence) {
              for (const objectiveId of question.objectiveIds) {
                const evidenceId = newId("lev");
                firstEvidenceId ??= evidenceId;
                await transaction.insert(learningEvidence).values({
                  id: evidenceId,
                  kind: "quiz-question",
                  objectiveId,
                  sourceKind: "quiz-attempt",
                  sourceId: attempt.id,
                  sourceVersion: `${attempt.sourceRevision}:${question.id}`,
                  locatorJson: {
                    kind: "quiz",
                    attemptId: attempt.id,
                    questionId: question.id,
                  },
                  observedOutcome: normalizedOutcome,
                  denominator: 1,
                  rubricJson: question.rubric,
                  difficulty: question.difficulty,
                  reliability: 0.8,
                  occurredAt: completedAt,
                  producerKind: "deterministic-parser",
                  producerDescriptor: "quiz-rubric-v2",
                  algorithmRevision: scoring.scoringRevision,
                  confidence: 1,
                  yearId: attempt.yearId,
                  subjectId: attempt.subjectId!,
                  userId,
                });
                await transaction.insert(learningEvidenceDecisions).values({
                  evidenceId,
                  state: "included",
                  reason: "reviewed progress quiz",
                  actor: "user",
                  idempotencyKey: `quiz:${attempt.id}:${question.id}:${objectiveId}`,
                  userId,
                });
                affectedObjectives.add(objectiveId);
              }
            }
            await transaction.insert(learningQuizAttemptItems).values({
              attemptId: attempt.id,
              questionVersionId: version.id,
              questionId: question.id,
              answerJson: input.answers[index]!,
              normalizedOutcome,
              feedback: scoring.reviewRequired
                ? `${scoring.reviewKind ?? "human"}-review-required`
                : normalizedOutcome === 1
                  ? "correct"
                  : "review",
              latencyMs:
                modeRow?.latencyConsent === true
                  ? (input.itemMetrics?.[index]?.latencyMs ?? null)
                  : null,
              hintsUsed: input.itemMetrics?.[index]?.hintsUsed ?? 0,
              evidenceId: firstEvidenceId,
              userId,
            });
          }
        }
        return saved;
      });
      await Promise.all(
        [...affectedObjectives].map((objectiveId) =>
          recomputeObjectiveMastery(userId, objectiveId),
        ),
      );
      return {
        ...completed,
        mode: modeRow?.mode ?? "practice",
        evidenceCreated: affectedObjectives.size > 0,
        pendingReviewCount: questionScores.filter(
          (result) => result.reviewRequired,
        ).length,
        feedback: attempt.questionsJson.map((question, index) => ({
          correct:
            questionScores[index]!.normalizedOutcome === null
              ? null
              : questionScores[index]!.normalizedOutcome === 1,
          reviewRequired: questionScores[index]!.reviewRequired,
          reviewKind: questionScores[index]!.reviewKind,
          expected:
            question.kind === "mcq"
              ? question.answers
              : question.kind === "open"
                ? question.expected
                : question.blanks,
          why: question.kind === "mcq" ? (question.why ?? null) : null,
        })),
      };
    }),
};
