import { describe, expect, test } from "bun:test";
import { captureInlineAssets } from "./assets";

const onePixelPng =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";

describe("private inline corpus assets", () => {
  test("normalizes data images and replaces them with opaque content handles", async () => {
    const original = `data:image/png;base64,${onePixelPng}`;
    const captured = await captureInlineAssets(
      [
        {
          text: `Avant ![Schéma](${original}) après`,
          locator: {
            kind: "markdown",
            headingPath: ["Chapitre"],
            startLine: 4,
            endLine: 4,
          },
          headingPath: ["Chapitre"],
          evidenceKind: "native-text",
        },
      ],
      { enabled: true },
    );
    expect(captured.assets).toHaveLength(1);
    expect(captured.assets[0]?.mimeType).toBe("image/webp");
    expect(captured.assets[0]?.locator).toEqual({
      kind: "markdown",
      headingPath: ["Chapitre"],
      startLine: 4,
      endLine: 4,
    });
    expect(captured.blocks[0]?.text).toContain("asset://");
    expect(captured.blocks[0]?.text).not.toContain("data:image");
  });

  test("removes an uncapturable remote image instead of retaining a hotlink", async () => {
    const captured = await captureInlineAssets(
      [
        {
          text: "![Pixel espion](https://tracker.example.test/pixel.png)",
          locator: { kind: "text", startOffset: 0, endOffset: 64 },
          headingPath: null,
          evidenceKind: "ocr",
        },
      ],
      {
        enabled: true,
        fetchArticle: async () => {
          throw new Error("blocked by public-network policy");
        },
      },
    );
    expect(captured.assets).toHaveLength(0);
    expect(captured.blocks[0]?.text).toBe("[Image: Pixel espion]");
    expect(captured.blocks[0]?.text).not.toContain("tracker.example.test");
  });
});
