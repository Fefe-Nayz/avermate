/// <reference path="../types/turndown.d.ts" />

import { Readability } from "@mozilla/readability";
import type {
  CapturedAsset,
  IngestionRequest,
  IngestionResult,
} from "@avermate/agent-contracts";
import { ingestionRequestSchema, ingestionResultSchema } from "@avermate/agent-contracts";
import { parseHTML } from "linkedom";
import {
  extractMarkdown,
  fetchArticle,
  type FetchedArticle,
} from "../lib/ingest";
import { sha256 } from "../search/values";
import { AdvancedIngestionError, asAdvancedIngestionError } from "./errors";

export interface ReferencedImageCandidate {
  readonly sourceUrl: string;
  readonly alt: string;
}

export interface CapturedImageSet {
  readonly assets: readonly CapturedAsset[];
  readonly assetHrefBySourceUrl: ReadonlyMap<string, string>;
}

export type ReferencedImageCapture = (input: {
  sourceId: string;
  finalUrl: string;
  candidates: readonly ReferencedImageCandidate[];
  signal?: AbortSignal;
}) => Promise<CapturedImageSet>;

function safeImageUrl(value: string, baseUrl: string): string | null {
  try {
    const url = new URL(value, baseUrl);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    if (url.username || url.password) return null;
    url.hash = "";
    return url.toString();
  } catch {
    return null;
  }
}

/** Select only images inside Readability's article subtree. */
export function referencedArticleImages(
  html: string,
  finalUrl: string,
): readonly ReferencedImageCandidate[] {
  const { document } = parseHTML(html);
  const base = document.createElement("base");
  base.setAttribute("href", finalUrl);
  document.head?.prepend(base);
  const readable = new Readability(document as unknown as Document).parse();
  if (!readable?.content) return [];
  const article = parseHTML(readable.content).document;
  const seen = new Set<string>();
  const selected: ReferencedImageCandidate[] = [];
  for (const image of article.querySelectorAll("img[src]")) {
    if (selected.length >= 250) break;
    const width = Number.parseInt(image.getAttribute("width") ?? "", 10);
    const height = Number.parseInt(image.getAttribute("height") ?? "", 10);
    if ((width > 0 && width <= 1) || (height > 0 && height <= 1)) continue;
    const sourceUrl = safeImageUrl(image.getAttribute("src") ?? "", finalUrl);
    if (!sourceUrl || seen.has(sourceUrl)) continue;
    seen.add(sourceUrl);
    selected.push(
      Object.freeze({
        sourceUrl,
        alt: Array.from((image.getAttribute("alt") ?? "").trim())
          .slice(0, 500)
          .join(""),
      }),
    );
  }
  return Object.freeze(selected);
}

export function markdownIngestionCitations(markdown: string) {
  const lines = markdown.split("\n");
  const citations: Array<{
    locator: {
      kind: "markdown";
      headingPath: string[];
      startLine: number;
      endLine: number;
    };
    textDigest: string;
  }> = [];
  const headings: string[] = [];
  let cursor = lines[0] === "---" ? 1 : 0;
  if (cursor === 1) {
    while (cursor < lines.length && lines[cursor] !== "---") cursor += 1;
    cursor = Math.min(cursor + 1, lines.length);
  }
  while (cursor < lines.length) {
    const line = lines[cursor] ?? "";
    const heading = /^(#{1,6})\s+(.+?)\s*$/u.exec(line);
    if (heading) {
      const level = heading[1]!.length;
      headings.splice(level - 1);
      headings[level - 1] = heading[2]!.trim();
      cursor += 1;
      continue;
    }
    if (!line.trim()) {
      cursor += 1;
      continue;
    }
    const start = cursor;
    while (cursor + 1 < lines.length && lines[cursor + 1]!.trim()) {
      if (/^#{1,6}\s+/u.test(lines[cursor + 1]!)) break;
      cursor += 1;
    }
    const end = cursor;
    const text = lines.slice(start, end + 1).join("\n");
    citations.push({
      locator: {
        kind: "markdown",
        headingPath: headings.filter(Boolean),
        startLine: start + 1,
        endLine: end + 1,
      },
      textDigest: sha256(text),
    });
    cursor += 1;
  }
  return citations.slice(0, 20_000);
}

export interface StaticHtmlIngestionDependencies {
  fetchArticle?: typeof fetchArticle;
  extractMarkdown?: typeof extractMarkdown;
  captureImages?: ReferencedImageCapture;
  now?: () => Date;
}

export class StaticHtmlIngestionAdapter {
  constructor(private readonly dependencies: StaticHtmlIngestionDependencies = {}) {}

  async ingest(
    rawRequest: IngestionRequest,
    options: { signal?: AbortSignal } = {},
  ): Promise<IngestionResult> {
    const request = ingestionRequestSchema.parse(rawRequest);
    if (request.strategy !== "static-html") {
      throw new AdvancedIngestionError(
        "unsupported_content",
        "The static HTML adapter only accepts static-html requests",
        false,
      );
    }
    const startedAt = (this.dependencies.now?.() ?? new Date()).toISOString();
    let fetched: FetchedArticle;
    try {
      fetched = await (this.dependencies.fetchArticle ?? fetchArticle)(
        request.canonicalUrl,
        {
          signal: options.signal,
          timeoutMs: request.limits.deadlineMs,
        },
      );
    } catch (error) {
      throw asAdvancedIngestionError(error);
    }
    if (!fetched.html) {
      throw new AdvancedIngestionError(
        "unsupported_content",
        `Static HTML extraction does not support ${fetched.contentType || "this content type"}`,
        false,
      );
    }

    const candidates = referencedArticleImages(fetched.html, fetched.finalUrl);
    const captured = this.dependencies.captureImages
      ? await this.dependencies.captureImages({
          sourceId: request.sourceId,
          finalUrl: fetched.finalUrl,
          candidates,
          signal: options.signal,
        })
      : { assets: [] as const, assetHrefBySourceUrl: new Map<string, string>() };
    let extracted: ReturnType<typeof extractMarkdown>;
    try {
      extracted = (this.dependencies.extractMarkdown ?? extractMarkdown)(
        fetched.html,
        fetched.finalUrl,
        {
          now: new Date(startedAt),
          imageHrefResolver: ({ sourceUrl }) =>
            captured.assetHrefBySourceUrl.get(sourceUrl) ?? null,
        },
      );
    } catch (error) {
      throw asAdvancedIngestionError(error);
    }
    const completedAt = (this.dependencies.now?.() ?? new Date()).toISOString();
    return ingestionResultSchema.parse({
      finalUrl: fetched.finalUrl,
      title: extracted.title,
      markdown: extracted.markdown,
      assets: captured.assets,
      citations: markdownIngestionCitations(extracted.markdown),
      diagnostics: {
        strategy: "static-html",
        rendererBuildDigest: null,
        redirectChain: [request.canonicalUrl, fetched.finalUrl].filter(
          (value, index, all) => all.indexOf(value) === index,
        ),
        requestCount: 1,
        inputBytes: fetched.body.byteLength,
        outputBytes: new TextEncoder().encode(extracted.markdown).byteLength,
        language: request.language ?? null,
        startedAt,
        completedAt,
        reasonCode: null,
      },
    });
  }
}
