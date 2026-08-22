import { describe, expect, test } from "bun:test";
import { buildCopyProposal } from "./copy-analysis";
import { evaluateCopyProposal } from "./evaluation";

describe("learning-loop labelled evaluation", () => {
  test("covers French decimal notation without inventing absent or bonus scores", () => {
    const proposal = buildCopyProposal(
      {
        markdown: "",
        pageCount: 3,
        providerFileId: "redacted-fixture",
        pages: [
          {
            providerIndex: 0,
            markdown:
              "Question : appliquer Pythagore\n\nRéponse correcte 15,5/20",
          },
          {
            providerIndex: 1,
            markdown: "ABS — devoir non rendu",
          },
          {
            providerIndex: 2,
            markdown: "Bonus : +1 si la justification est complète",
          },
        ],
      },
      [
        {
          id: "objective-pythagoras",
          statement: "Appliquer le théorème de Pythagore",
          conceptLabel: "Pythagore",
        },
      ],
    );
    const metrics = evaluateCopyProposal(proposal, [
      {
        page: 1,
        textIncludes: "appliquer Pythagore",
        awarded: null,
        objectiveId: "objective-pythagoras",
      },
      {
        page: 1,
        textIncludes: "15,5/20",
        awarded: { value: 15.5, outOf: 20 },
      },
      { page: 2, textIncludes: "ABS", awarded: null },
      { page: 3, textIncludes: "Bonus", awarded: null },
    ]);

    expect(metrics).toEqual({
      labelledRegions: 4,
      locatedRegions: 4,
      regionRecall: 1,
      scorePrecision: 1,
      scoreRecall: 1,
      objectiveTopKAccuracy: 1,
      errorTaxonomyAccuracy: null,
      unsupportedScoreRate: 0,
    });
  });
});
