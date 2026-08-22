import { describe, expect, test } from "bun:test";

async function routerSource() {
  return Bun.file(new URL("./learning.ts", import.meta.url)).text();
}

describe("learning ownership and review contracts", () => {
  test("scopes every critical paper lookup to the authenticated owner", async () => {
    const source = await routerSource();

    expect(source).toContain("eq(gradeAttachments.userId, userId)");
    expect(source).toContain("eq(files.userId, userId)");
    expect(source).toContain("eq(grades.userId, userId)");
    expect(source).toContain("eq(learningCopyAnalyses.userId, userId)");
    expect(source).toContain("eq(learningObjectives.userId, userId)");
    expect(source).toContain("eq(learningEvidence.userId, userId)");
    expect(source).toContain("eq(learningPlanItems.userId, userId)");
  });

  test("keeps human review revisioned and evidence append-only", async () => {
    const source = await routerSource();

    expect(source).toContain("analysis.revision !== input.expectedRevision");
    expect(source).toContain(
      "eq(learningCopyAnalyses.revision, input.expectedRevision)",
    );
    expect(source).toContain(".insert(learningCopyAnalysisReviews)");
    expect(source).toContain(".insert(learningEvidence)");
    expect(source).toContain(".insert(learningEvidenceDecisions)");
    expect(source).not.toContain(".delete(learningEvidence)");
    expect(source).not.toContain(".update(learningEvidence)");
  });
});
