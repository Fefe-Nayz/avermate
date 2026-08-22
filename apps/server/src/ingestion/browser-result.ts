import type {
  BrowserRenderWorkerOutput,
  CapturedAsset,
  IngestionRequest,
  IngestionResult,
} from "@avermate/agent-contracts";
import {
  ingestionRequestSchema,
  ingestionResultSchema,
} from "@avermate/agent-contracts";
import { extractMarkdown } from "../lib/ingest";
import { AdvancedIngestionError } from "./errors";
import { parseBrowserRenderWorkerOutput } from "./browser-renderer";
import {
  markdownIngestionCitations,
  type ReferencedImageCapture,
} from "./static-html";
import type { PublicIngestionUrlPolicy } from "./url-policy";

/** Trusted post-sandbox normalization; page JavaScript never authors Markdown. */
export class BrowserRenderedIngestionAdapter {
  constructor(
    private readonly dependencies: {
      urlPolicy: Pick<PublicIngestionUrlPolicy, "validate">;
      captureImages?: ReferencedImageCapture;
      rendererBuildDigest: string;
      now?: () => Date;
    },
  ) {}

  async adopt(input: {
    request: IngestionRequest;
    workerOutput: unknown;
    startedAt: string;
    signal?: AbortSignal;
  }): Promise<IngestionResult> {
    const request = ingestionRequestSchema.parse(input.request);
    if (request.strategy !== "browser-render") {
      throw new AdvancedIngestionError(
        "unsupported_content",
        "The browser result adapter requires a browser-render request",
        false,
      );
    }
    const output = parseBrowserRenderWorkerOutput(input.workerOutput);
    for (const [index, url] of output.redirectChain.entries()) {
      await this.dependencies.urlPolicy.validate(
        url,
        index === 0 ? "main-navigation" : "redirect",
        input.signal,
      );
    }
    await this.dependencies.urlPolicy.validate(
      output.finalUrl,
      "redirect",
      input.signal,
    );
    const captured = this.dependencies.captureImages
      ? await this.dependencies.captureImages({
          sourceId: request.sourceId,
          finalUrl: output.finalUrl,
          candidates: output.selectedImages.map((image) => ({
            sourceUrl: image.url,
            alt: image.alt,
          })),
          signal: input.signal,
        })
      : {
          assets: [] as readonly CapturedAsset[],
          assetHrefBySourceUrl: new Map<string, string>(),
        };
    const completedAt = (this.dependencies.now?.() ?? new Date()).toISOString();
    const extracted = extractMarkdown(output.readableHtml, output.finalUrl, {
      now: new Date(input.startedAt),
      imageHrefResolver: ({ sourceUrl }) =>
        captured.assetHrefBySourceUrl.get(sourceUrl) ?? null,
    });
    return ingestionResultSchema.parse({
      finalUrl: output.finalUrl,
      title: extracted.title || output.title,
      markdown: extracted.markdown,
      assets: captured.assets,
      citations: markdownIngestionCitations(extracted.markdown),
      diagnostics: {
        strategy: "browser-render",
        rendererBuildDigest: this.dependencies.rendererBuildDigest,
        redirectChain: output.redirectChain,
        requestCount: output.requestCount,
        inputBytes: output.responseBytes,
        outputBytes: new TextEncoder().encode(extracted.markdown).byteLength,
        language: output.language,
        startedAt: input.startedAt,
        completedAt,
        reasonCode: null,
      },
    });
  }
}
