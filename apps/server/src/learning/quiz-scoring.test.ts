import { describe, expect, test } from "bun:test";
import type { QuizQuestionV2 } from "../db/schema/documents";
import { scoreQuizQuestion } from "./quiz-scoring";

function metadata(
  rubric: QuizQuestionV2["rubric"],
): Pick<
  QuizQuestionV2,
  | "id"
  | "objectiveIds"
  | "difficulty"
  | "sourceProofs"
  | "rubricRevision"
  | "rubric"
  | "validationState"
> {
  return {
    id: "question-1",
    objectiveIds: ["objective-1"],
    difficulty: null,
    sourceProofs: [],
    rubricRevision: "rubric-v2",
    rubric,
    validationState: "reviewed",
  };
}

describe("quiz v2 scoring", () => {
  test("accepts reviewed deterministic variants without accent sensitivity", () => {
    const question: QuizQuestionV2 = {
      kind: "open",
      prompt: "Capitale ?",
      expected: "Paris",
      ...metadata({
        scoringMode: "deterministic",
        acceptedVariants: ["Paris, France"],
      }),
    };
    expect(scoreQuizQuestion(question, "  PARIS, FRÁNCE ")).toMatchObject({
      normalizedOutcome: 1,
      reviewRequired: false,
      scoringRevision: "rubric-v2",
    });
  });

  test("supports per-blank accepted variants and partial deterministic credit", () => {
    const question: QuizQuestionV2 = {
      kind: "cloze",
      text: "Une suite convergente est … et …",
      blanks: ["bornée", "de Cauchy"],
      ...metadata({
        acceptedBlankVariants: [["bornee"], ["suite de Cauchy"]],
      }),
    };
    expect(
      scoreQuizQuestion(question, ["BORNEE", "incorrect"]).normalizedOutcome,
    ).toBe(0.5);
  });

  test.each([
    ["human-review", "human"],
    ["model-review", "model"],
  ] as const)(
    "never invents an automatic score for %s open-answer rubrics",
    (scoringMode, reviewKind) => {
      const question: QuizQuestionV2 = {
        kind: "open",
        prompt: "Justifie la propriété.",
        expected: "Une justification de référence",
        ...metadata({ scoringMode, modelDescriptor: "configured-provider" }),
      };
      expect(scoreQuizQuestion(question, "Réponse libre")).toEqual({
        normalizedOutcome: null,
        reviewRequired: true,
        reviewKind,
        scoringRevision: "rubric-v2",
      });
    },
  );

  test("preserves legacy exact scoring", () => {
    expect(
      scoreQuizQuestion(
        { kind: "open", prompt: "Capitale ?", expected: "Paris" },
        " Páris ",
      ),
    ).toMatchObject({ normalizedOutcome: 1, scoringRevision: "quiz-v1-exact" });
  });
});
