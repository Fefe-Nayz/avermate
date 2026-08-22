import type {
  QuizQuestionV1,
  QuizQuestionV2,
  QuizRubricV2,
} from "../db/schema/documents";

export type QuizReviewKind = "human" | "model" | null;

export interface QuizQuestionScore {
  normalizedOutcome: number | null;
  reviewRequired: boolean;
  reviewKind: QuizReviewKind;
  scoringRevision: string;
}

export function normalizeQuizAnswer(value: string) {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .replace(/\s+/g, " ")
    .toLocaleLowerCase("fr");
}

function isV2(question: QuizQuestionV1): question is QuizQuestionV2 {
  return "id" in question && "rubricRevision" in question;
}

function rubric(question: QuizQuestionV1): QuizRubricV2 {
  return isV2(question) ? question.rubric : {};
}

function pendingReview(question: QuizQuestionV1): QuizQuestionScore | null {
  if (!isV2(question) || question.kind !== "open") return null;
  const mode = rubric(question).scoringMode;
  if (mode === "human-review") {
    return {
      normalizedOutcome: null,
      reviewRequired: true,
      reviewKind: "human",
      scoringRevision: question.rubricRevision,
    };
  }
  if (mode === "model-review") {
    return {
      normalizedOutcome: null,
      reviewRequired: true,
      reviewKind: "model",
      scoringRevision: question.rubricRevision,
    };
  }
  return null;
}

function acceptedOpenAnswers(
  question: Extract<QuizQuestionV1, { kind: "open" }>,
) {
  const candidates = [question.expected];
  if (isV2(question)) {
    const variants = rubric(question).acceptedVariants;
    if (Array.isArray(variants)) {
      candidates.push(
        ...variants.filter(
          (candidate): candidate is string =>
            typeof candidate === "string" && candidate.trim().length > 0,
        ),
      );
    }
  }
  return new Set(candidates.map(normalizeQuizAnswer));
}

function acceptedBlankAnswers(
  question: Extract<QuizQuestionV1, { kind: "cloze" }>,
  index: number,
) {
  const candidates = [question.blanks[index]!];
  if (isV2(question)) {
    const variants = rubric(question).acceptedBlankVariants?.[index];
    if (Array.isArray(variants)) {
      candidates.push(
        ...variants.filter(
          (candidate): candidate is string =>
            typeof candidate === "string" && candidate.trim().length > 0,
        ),
      );
    }
  }
  return new Set(candidates.map(normalizeQuizAnswer));
}

/**
 * Score only deterministic question kinds locally. Open questions whose
 * versioned rubric delegates assessment remain unscored; they cannot create
 * mastery evidence until a separate reviewed assessment exists.
 */
export function scoreQuizQuestion(
  question: QuizQuestionV1,
  answer: unknown,
): QuizQuestionScore {
  const review = pendingReview(question);
  if (review) return review;
  const scoringRevision = isV2(question)
    ? question.rubricRevision
    : "quiz-v1-exact";

  if (question.kind === "mcq") {
    if (
      !Array.isArray(answer) ||
      answer.some((item) => !Number.isInteger(item))
    ) {
      return {
        normalizedOutcome: 0,
        reviewRequired: false,
        reviewKind: null,
        scoringRevision,
      };
    }
    const actual = [...new Set(answer as number[])].sort((a, b) => a - b);
    const expected = [...question.answers].sort((a, b) => a - b);
    return {
      normalizedOutcome:
        actual.length === expected.length &&
        actual.every((item, index) => item === expected[index])
          ? 1
          : 0,
      reviewRequired: false,
      reviewKind: null,
      scoringRevision,
    };
  }

  if (question.kind === "open") {
    return {
      normalizedOutcome:
        typeof answer === "string" &&
        acceptedOpenAnswers(question).has(normalizeQuizAnswer(answer))
          ? 1
          : 0,
      reviewRequired: false,
      reviewKind: null,
      scoringRevision,
    };
  }

  if (!Array.isArray(answer) || question.blanks.length === 0) {
    return {
      normalizedOutcome: 0,
      reviewRequired: false,
      reviewKind: null,
      scoringRevision,
    };
  }
  const correct = question.blanks.reduce(
    (total, _expected, index) =>
      total +
      (typeof answer[index] === "string" &&
      acceptedBlankAnswers(question, index).has(
        normalizeQuizAnswer(answer[index] as string),
      )
        ? 1
        : 0),
    0,
  );
  return {
    normalizedOutcome: correct / question.blanks.length,
    reviewRequired: false,
    reviewKind: null,
    scoringRevision,
  };
}
