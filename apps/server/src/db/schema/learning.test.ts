import { describe, expect, test } from "bun:test";
import { getTableConfig } from "drizzle-orm/sqlite-core";
import {
  learningConceptOperations,
  learningConcepts,
  learningCopyAnalyses,
  learningCopyAnalysisReviews,
  learningEvidence,
  learningEvidenceDecisions,
  learningMasteryCurrent,
  learningMasteryProjections,
  learningObjectives,
  learningPlanItems,
  learningQuizAttemptItems,
  learningQuizAttemptModes,
  learningQuizQuestionVersions,
} from "./learning";

describe("learning schema contracts", () => {
  test("keeps the durable learning records in distinct append-only tables", () => {
    const names = [
      learningConcepts,
      learningObjectives,
      learningConceptOperations,
      learningCopyAnalyses,
      learningCopyAnalysisReviews,
      learningEvidence,
      learningEvidenceDecisions,
      learningMasteryProjections,
      learningMasteryCurrent,
      learningPlanItems,
      learningQuizQuestionVersions,
      learningQuizAttemptModes,
      learningQuizAttemptItems,
    ].map((table) => getTableConfig(table).name);

    expect(names).toEqual([
      "learning_concepts",
      "learning_objectives",
      "learning_concept_operations",
      "learning_copy_analyses",
      "learning_copy_analysis_reviews",
      "learning_evidence",
      "learning_evidence_decisions",
      "learning_mastery_projections",
      "learning_mastery_current",
      "learning_plan_items",
      "learning_quiz_question_versions",
      "learning_quiz_attempt_modes",
      "learning_quiz_attempt_items",
    ]);
  });

  test("indexes owner/source cursors and constrains evidence inputs", () => {
    const evidence = getTableConfig(learningEvidence);
    const copy = getTableConfig(learningCopyAnalyses);

    expect(evidence.indexes).toHaveLength(2);
    expect(evidence.checks.length).toBeGreaterThanOrEqual(4);
    expect(evidence.foreignKeys.length).toBeGreaterThanOrEqual(5);
    expect(copy.indexes.length).toBeGreaterThanOrEqual(3);
    expect(copy.checks).toHaveLength(1);
    expect(copy.foreignKeys.length).toBeGreaterThanOrEqual(7);
  });
});
