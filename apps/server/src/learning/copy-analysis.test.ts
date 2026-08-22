import { describe, expect, test } from "bun:test";
import { buildCopyProposal, runResolvedGradeCopyOcr } from "./copy-analysis";

describe("grade copy proposal", () => {
  test("routes owner-scoped copy OCR through the resolved Node provider", async () => {
    let resolvedOwner = "";
    let nodeCalls = 0;
    const result = await runResolvedGradeCopyOcr(
      "owner-copy-node",
      {
        blob: new Blob(["copy"], { type: "image/png" }),
        name: "copy.png",
      },
      { operationId: "copy-job-1" },
      {
        resolveProvider: async (ownerId) => {
          resolvedOwner = ownerId;
          return {
            id: "node-local",
            model: "tesseract-ocr@tesseract-5.5.1-fra-eng",
            run: async (_file, options) => {
              nodeCalls += 1;
              expect(options?.operationId).toBe("copy-job-1");
              return {
                markdown: "Copie locale",
                pageCount: 1,
                providerFileId: "node:fixture",
                pages: [{ providerIndex: 0, markdown: "Copie locale" }],
              };
            },
          };
        },
      },
    );
    expect(resolvedOwner).toBe("owner-copy-node");
    expect(nodeCalls).toBe(1);
    expect(result).toMatchObject({
      provider: "node-local",
      model: "tesseract-ocr@tesseract-5.5.1-fra-eng",
      result: { providerFileId: "node:fixture" },
    });
  });

  test("does not fall back when Node copy OCR resolution is unavailable", async () => {
    let providerCalls = 0;
    await expect(
      runResolvedGradeCopyOcr(
        "owner-copy-offline",
        { blob: new Blob(["copy"]), name: "copy.png" },
        {},
        {
          resolveProvider: async () => {
            providerCalls += 1;
            throw new Error("NODE_OCR_MODEL_NOT_ATTESTED");
          },
        },
      ),
    ).rejects.toThrow("NODE_OCR_MODEL_NOT_ATTESTED");
    expect(providerCalls).toBe(1);
  });

  test("keeps page boundaries and proposes only explicit points", () => {
    const proposal = buildCopyProposal(
      {
        markdown: "",
        pageCount: 2,
        providerFileId: "provider-file",
        pages: [
          { providerIndex: 0, markdown: "Question sur Pythagore ?\n\n15/20" },
          { providerIndex: 1, markdown: "Attention au calcul et aux signes" },
        ],
      },
      [
        {
          id: "objective-pythagore",
          statement: "Appliquer le théorème de Pythagore",
          conceptLabel: "Pythagore",
        },
      ],
    );
    expect(proposal.pages.map((page) => page.page)).toEqual([1, 2]);
    expect(proposal.pages[0]?.regions[0]?.suggestedObjectiveIds).toEqual([
      "objective-pythagore",
    ]);
    expect(proposal.pages[0]?.regions[1]?.awarded).toEqual({
      value: 15,
      outOf: 20,
    });
    expect(proposal.pages[1]?.regions[0]?.suggestedError?.taxonomy).toBe(
      "calculation",
    );
    expect(proposal.unsupportedInferences).toContain("grade-remains-unchanged");
  });

  test("does not invent a score from ambiguous text", () => {
    const proposal = buildCopyProposal(
      { markdown: "presque vingt points", pageCount: 1, providerFileId: "f" },
      [],
    );
    expect(proposal.pages[0]?.regions[0]?.awarded).toBeUndefined();
  });
});
