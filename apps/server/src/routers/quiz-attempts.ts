import { and, desc, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db";
import { quizAttempts, type QuizQuestionV1 } from "../db/schema";
import { badRequest, protectedProcedure } from "../lib/orpc";
import { requireStudyDocument } from "../lib/ownership";
import {
  quizContentSchema,
  quizPromptContent,
} from "../lib/study-document-content";

const answerSchema = z.union([
  z.array(z.number().int().nonnegative()).max(12),
  z.string().max(8 * 1024),
  z.array(z.string().max(1_024)).max(50),
]);

const answersSchema = z.array(answerSchema).max(200);

function normalizedAnswer(value: string) {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .replace(/\s+/g, " ")
    .toLocaleLowerCase("fr");
}

function scoreQuestion(question: QuizQuestionV1, answer: unknown): number {
  if (question.kind === "mcq") {
    if (
      !Array.isArray(answer) ||
      answer.some((item) => !Number.isInteger(item))
    ) {
      return 0;
    }
    const actual = [...new Set(answer as number[])].sort((a, b) => a - b);
    const expected = [...question.answers].sort((a, b) => a - b);
    return actual.length === expected.length &&
      actual.every((item, index) => item === expected[index])
      ? 1
      : 0;
  }
  if (question.kind === "open") {
    return typeof answer === "string" &&
      normalizedAnswer(answer) === normalizedAnswer(question.expected)
      ? 1
      : 0;
  }
  if (!Array.isArray(answer) || question.blanks.length === 0) return 0;
  const correct = question.blanks.reduce(
    (total, expected, index) =>
      total +
      (typeof answer[index] === "string" &&
      normalizedAnswer(answer[index] as string) === normalizedAnswer(expected)
        ? 1
        : 0),
    0,
  );
  return correct / question.blanks.length;
}

async function requireQuizAttempt(userId: string, attemptId: string) {
  const [attempt] = await db
    .select()
    .from(quizAttempts)
    .where(and(eq(quizAttempts.id, attemptId), eq(quizAttempts.userId, userId)))
    .limit(1);
  if (!attempt) badRequest("This quiz attempt is unavailable");
  return attempt;
}

export const quizAttemptsRouter = {
  list: protectedProcedure
    .input(z.object({ documentId: z.string().min(1) }).strict())
    .handler(async ({ context, input }) => {
      const userId = context.session.user.id;
      const document = await requireStudyDocument(userId, input.documentId);
      if (document.kind !== "quiz") badRequest("This document is not a quiz");
      return db
        .select({
          id: quizAttempts.id,
          documentId: quizAttempts.documentId,
          sourceRevision: quizAttempts.sourceRevision,
          startedAt: quizAttempts.startedAt,
          completedAt: quizAttempts.completedAt,
          score: quizAttempts.score,
          outOf: quizAttempts.outOf,
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
    }),

  start: protectedProcedure
    .input(z.object({ documentId: z.string().min(1) }).strict())
    .handler(async ({ context, input }) => {
      const userId = context.session.user.id;
      const document = await requireStudyDocument(userId, input.documentId);
      if (document.deletedAt) badRequest("A trashed quiz cannot be attempted");
      if (document.kind !== "quiz") badRequest("This document is not a quiz");
      const content = quizContentSchema.safeParse(document.metaJson);
      if (!content.success) badRequest("This quiz has invalid questions");
      const [attempt] = await db
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
      if (!attempt) throw new Error("The quiz attempt was not created");
      return {
        id: attempt.id,
        sourceRevision: attempt.sourceRevision,
        startedAt: attempt.startedAt,
        questions: quizPromptContent(content.data).questions,
      };
    }),

  complete: protectedProcedure
    .input(
      z
        .object({ attemptId: z.string().min(1), answers: answersSchema })
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
      const score = attempt.questionsJson.reduce(
        (total, question, index) =>
          total + scoreQuestion(question, input.answers[index]),
        0,
      );
      const completedAt = new Date();
      const [completed] = await db
        .update(quizAttempts)
        .set({
          answersJson: input.answers,
          score,
          outOf: attempt.questionsJson.length,
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
      if (!completed) badRequest("This quiz attempt was already submitted");
      return {
        ...completed,
        feedback: attempt.questionsJson.map((question, index) => ({
          correct: scoreQuestion(question, input.answers[index]) === 1,
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
