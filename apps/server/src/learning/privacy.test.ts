import { describe, expect, test } from "bun:test";
import { learningExportMarkdown } from "./privacy";

describe("learning privacy export", () => {
  test("renders relationship-complete Markdown without unsafe code fences", () => {
    const markdown = learningExportMarkdown({
      version: 1,
      exportedAt: "2026-08-22T12:00:00.000Z",
      ownership: "user-owned",
      sourceFiles: {
        included: false,
        reason: "File bytes are exported separately.",
      },
      data: {
        concepts: [{ id: "concept-1", label: "Fonctions ``` et limites" }],
        evidence: [
          {
            id: "evidence-1",
            sourceId: "copy-1",
            locatorJson: { kind: "pdf", page: 2 },
          },
        ],
        evidenceDecisions: [
          { evidenceId: "evidence-1", state: "excluded", reason: "ambigu" },
        ],
        masteryProjections: [
          { objectiveId: "objective-1", algorithmRevision: "mastery-v1" },
        ],
        planItems: [{ objectiveId: "objective-1", status: "proposed" }],
      },
    });

    expect(markdown).toContain("# Avermate learning data export");
    expect(markdown).toContain("## evidenceDecisions");
    expect(markdown).toContain('"page": 2');
    expect(markdown).not.toContain("```json");
  });
});
