import { createHash } from "node:crypto";
import { describe, expect, test } from "bun:test";
import {
  GEMINI_EMBEDDING_DISCLOSURE_REVISION,
  GeminiEmbeddingProvider,
} from "./gemini-embedding";
import { CohereRerankProvider, TeiRerankProvider } from "./rerank-providers";

function consent(signal: AbortSignal) {
  return {
    operationId: "operation-fixture",
    signal,
    consent: {
      provider: "gemini",
      capability: "embedding" as const,
      disclosureRevision: GEMINI_EMBEDDING_DISCLOSURE_REVISION,
      grantedAt: new Date(0).toISOString(),
    },
  };
}

const vector = () => Array.from({ length: 768 }, (_, index) => index / 768);

function syntheticPdf(pageTexts: readonly string[]) {
  const objects: string[] = [];
  const pageIds = pageTexts.map((_text, index) => 3 + index * 2);
  objects.push("<< /Type /Catalog /Pages 2 0 R >>");
  objects.push(
    `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pageTexts.length} >>`,
  );
  pageTexts.forEach((text, index) => {
    const pageId = 3 + index * 2;
    const streamId = pageId + 1;
    const escaped = text
      .replaceAll("\\", "\\\\")
      .replaceAll("(", "\\(")
      .replaceAll(")", "\\)");
    const stream = `BT /F1 12 Tf 72 720 Td (${escaped}) Tj ET`;
    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 ${3 + pageTexts.length * 2} 0 R >> >> /Contents ${streamId} 0 R >>`,
    );
    objects.push(
      `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    );
  });
  objects.push("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");
  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(pdf.length);
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  pdf += offsets
    .slice(1)
    .map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`)
    .join("");
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return new TextEncoder().encode(pdf);
}

describe("Gemini Embedding 2 HTTP contract", () => {
  test("uses the v1beta batch schema, retrieval prefixes, and exact ordering", async () => {
    let request: { url: string; body: Record<string, unknown> } | null = null;
    const provider = new GeminiEmbeddingProvider({
      apiKey: "fixture-key",
      dimensions: 768,
      fetch: async (input, init) => {
        request = {
          url: String(input),
          body: JSON.parse(String(init?.body)),
        };
        return Response.json(
          {
            embeddings: [{ values: vector() }, { values: vector().reverse() }],
            usageMetadata: { promptTokenCount: 17, totalTokenCount: 17 },
          },
          { headers: { "x-goog-request-id": "gemini-fixture-request" } },
        );
      },
    });
    const signal = new AbortController().signal;
    const result = await provider.embedText(
      [
        { contentHash: "a".repeat(64), text: "gravité", purpose: "query" },
        {
          contentHash: "b".repeat(64),
          text: "La force est verticale.",
          purpose: "document",
          title: "Mécanique",
        },
      ],
      consent(signal),
    );
    expect(request!.url).toBe(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-2:batchEmbedContents",
    );
    const requests = request!.body.requests as Array<Record<string, unknown>>;
    expect(requests).toHaveLength(2);
    expect(JSON.stringify(requests[0])).toContain(
      "task: search result | query: gravité",
    );
    expect(JSON.stringify(requests[1])).toContain(
      "title: Mécanique | text: La force est verticale.",
    );
    expect(JSON.stringify(request!.body)).not.toContain("taskType");
    expect(requests[0]?.embedContentConfig).toEqual({
      autoTruncate: false,
      outputDimensionality: 768,
    });
    expect(result.map((entry) => entry.contentHash)).toEqual([
      "a".repeat(64),
      "b".repeat(64),
    ]);
    expect(result[0]?.usage).toEqual({
      inputTokens: 17,
      providerRequestId: "gemini-fixture-request",
    });
  });

  test("validates every opaque image before spend and sends inline_data", async () => {
    const png = Uint8Array.from(
      Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
        "base64",
      ),
    );
    const digest = createHash("sha256").update(png).digest("hex");
    let calls = 0;
    let requestBody: Record<string, unknown> | null = null;
    const provider = new GeminiEmbeddingProvider({
      apiKey: "fixture-key",
      dimensions: 768,
      resolveMedia: async () => ({ bytes: png, mediaType: "image/png" }),
      fetch: async (_input, init) => {
        calls += 1;
        requestBody = JSON.parse(String(init?.body));
        return Response.json({ embedding: { values: vector() } });
      },
    });
    const input = {
      contentHash: digest,
      modality: "image" as const,
      mediaType: "image/png",
      opaqueFileHandle: "file:owned-fixture",
      locator: { kind: "slides" as const, slide: 2 },
      byteLength: png.byteLength,
      estimatedInputTokens: 8,
    };
    await provider.embedMedia([input], consent(new AbortController().signal));
    expect(calls).toBe(1);
    expect(JSON.stringify(requestBody)).toContain("inline_data");
    expect(JSON.stringify(requestBody)).toContain("image/png");
    expect(requestBody!.embedContentConfig).toEqual({
      autoTruncate: false,
      outputDimensionality: 768,
    });

    calls = 0;
    await expect(
      provider.embedMedia(
        [
          input,
          {
            ...input,
            contentHash: "f".repeat(64),
            opaqueFileHandle: "file:bad",
          },
        ],
        consent(new AbortController().signal),
      ),
    ).rejects.toThrow("DIGEST_MISMATCH");
    expect(calls).toBe(0);
  });

  test("embeds exactly one owned PDF page and rejects an aggregate before spend", async () => {
    const onePage = syntheticPdf(["Théorème de Pythagore"]);
    const twoPages = syntheticPdf(["Première page", "Deuxième page"]);
    let resolved = onePage;
    let calls = 0;
    let requestBody: Record<string, unknown> | null = null;
    const provider = new GeminiEmbeddingProvider({
      apiKey: "fixture-key",
      dimensions: 768,
      resolveMedia: async () => ({
        bytes: resolved,
        mediaType: "application/pdf",
      }),
      fetch: async (_input, init) => {
        calls += 1;
        requestBody = JSON.parse(String(init?.body));
        return Response.json({ embedding: { values: vector() } });
      },
    });
    const input = {
      contentHash: createHash("sha256").update(onePage).digest("hex"),
      modality: "pdf-page" as const,
      mediaType: "application/pdf",
      opaqueFileHandle: "file:owned-pdf-page",
      locator: { kind: "pdf" as const, page: 4 },
      byteLength: onePage.byteLength,
      estimatedInputTokens: 300,
    };

    await provider.embedMedia([input], consent(new AbortController().signal));
    expect(calls).toBe(1);
    expect(JSON.stringify(requestBody)).toContain("application/pdf");
    expect(requestBody!.embedContentConfig).toEqual({
      autoTruncate: false,
      outputDimensionality: 768,
    });

    resolved = twoPages;
    calls = 0;
    await expect(
      provider.embedMedia(
        [
          {
            ...input,
            contentHash: createHash("sha256").update(twoPages).digest("hex"),
            byteLength: twoPages.byteLength,
          },
        ],
        consent(new AbortController().signal),
      ),
    ).rejects.toThrow("PDF_MUST_CONTAIN_ONE_PAGE");
    expect(calls).toBe(0);
  });

  test("revalidates mutable authorization immediately before every provider dispatch", async () => {
    const pageA = syntheticPdf(["Première preuve"]);
    const pageB = syntheticPdf(["Deuxième preuve"]);
    const media = new Map([
      ["file:page-a", pageA],
      ["file:page-b", pageB],
    ]);
    let providerCalls = 0;
    let authorizationChecks = 0;
    const provider = new GeminiEmbeddingProvider({
      apiKey: "fixture-key",
      dimensions: 768,
      resolveMedia: async (input) => ({
        bytes: media.get(input.opaqueFileHandle)!,
        mediaType: "application/pdf",
      }),
      fetch: async () => {
        providerCalls += 1;
        return Response.json({ embedding: { values: vector() } });
      },
    });
    const signal = new AbortController().signal;
    const context = {
      ...consent(signal),
      authorize: async () => {
        authorizationChecks += 1;
        if (authorizationChecks === 2) throw new Error("CONSENT_REVOKED");
      },
    };

    await expect(
      provider.embedMedia(
        [
          {
            contentHash: createHash("sha256").update(pageA).digest("hex"),
            modality: "pdf-page",
            mediaType: "application/pdf",
            opaqueFileHandle: "file:page-a",
            locator: { kind: "pdf", page: 1 },
            byteLength: pageA.byteLength,
            estimatedInputTokens: 200,
          },
          {
            contentHash: createHash("sha256").update(pageB).digest("hex"),
            modality: "pdf-page",
            mediaType: "application/pdf",
            opaqueFileHandle: "file:page-b",
            locator: { kind: "pdf", page: 2 },
            byteLength: pageB.byteLength,
            estimatedInputTokens: 200,
          },
        ],
        context,
      ),
    ).rejects.toThrow("CONSENT_REVOKED");
    expect(authorizationChecks).toBe(2);
    expect(providerCalls).toBe(1);
  });

  test("fails closed without the current disclosure", async () => {
    const provider = new GeminiEmbeddingProvider({
      apiKey: "fixture-key",
      dimensions: 768,
      fetch: async () => {
        throw new Error("must not fetch");
      },
    });
    await expect(
      provider.embedText([{ contentHash: "a".repeat(64), text: "secret" }]),
    ).rejects.toThrow("EXPLICIT_CONSENT_REQUIRED");
    await expect(
      provider.embedText(
        [{ contentHash: "b".repeat(64), text: "secret" }],
        {
          ...consent(new AbortController().signal),
          consent: {
            ...consent(new AbortController().signal).consent,
            disclosureRevision: "gemini-embedding-school-content/2",
          },
        },
      ),
    ).rejects.toThrow("EXPLICIT_CONSENT_REQUIRED");
  });
});

const candidates = [
  { id: "chunk-a", text: "premier document", tokenEstimate: 4 },
  { id: "chunk-b", text: "second document", tokenEstimate: 4 },
];

describe("rerank HTTP contracts", () => {
  test("re-authorizes Cohere immediately before every provider dispatch", async () => {
    let authorizationChecks = 0;
    let providerCalls = 0;
    const provider = new CohereRerankProvider({
      apiKey: "fixture-key",
      model: "rerank-v4.0-fast",
      authorize: async () => {
        authorizationChecks += 1;
        throw new Error("fixture-consent-revoked");
      },
      fetch: async () => {
        providerCalls += 1;
        return Response.json({ results: [] });
      },
    });

    await expect(
      provider.rerank({
        operationId: "cohere-revoked-op",
        query: "question privée",
        candidates,
        topN: 1,
        signal: new AbortController().signal,
      }),
    ).rejects.toThrow("fixture-consent-revoked");
    expect(authorizationChecks).toBe(1);
    expect(providerCalls).toBe(0);
  });

  test("discards Cohere scores when consent is revoked in flight", async () => {
    let consentActive = true;
    let authorizationChecks = 0;
    let markStarted!: () => void;
    let releaseProvider!: () => void;
    const started = new Promise<void>((resolve) => {
      markStarted = resolve;
    });
    const released = new Promise<void>((resolve) => {
      releaseProvider = resolve;
    });
    const provider = new CohereRerankProvider({
      apiKey: "fixture-key",
      model: "rerank-v4.0-fast",
      authorize: async () => {
        authorizationChecks += 1;
        if (!consentActive) throw new Error("fixture-consent-revoked");
      },
      fetch: async () => {
        markStarted();
        await released;
        return Response.json({
          results: [{ index: 0, relevance_score: 0.9 }],
        });
      },
    });

    const pending = provider.rerank({
      operationId: "cohere-in-flight-revoke",
      query: "question privée",
      candidates,
      topN: 1,
      signal: new AbortController().signal,
    });
    await started;
    consentActive = false;
    releaseProvider();
    await expect(pending).rejects.toThrow("fixture-consent-revoked");
    expect(authorizationChecks).toBe(2);
  });

  test("maps Cohere v2 indices without sending ids or metadata", async () => {
    let request: { url: string; body: Record<string, unknown> } | null = null;
    const provider = new CohereRerankProvider({
      apiKey: "fixture-key",
      model: "rerank-v4.0-pro",
      fetch: async (input, init) => {
        request = { url: String(input), body: JSON.parse(String(init?.body)) };
        return Response.json({
          id: "fixture-rerank",
          results: [{ index: 1, relevance_score: 0.91 }],
          meta: { billed_units: { search_units: 1 } },
        });
      },
    });
    const output = await provider.rerank({
      operationId: "cohere-op",
      query: "quel document ?",
      candidates,
      topN: 1,
      signal: new AbortController().signal,
    });
    expect(request!.url).toBe("https://api.cohere.com/v2/rerank");
    expect(request!.body).toEqual({
      model: "rerank-v4.0-pro",
      query: "quel document ?",
      documents: ["premier document", "second document"],
      top_n: 1,
      max_tokens_per_doc: 4096,
    });
    expect(output).toEqual([
      {
        operationId: "cohere-op",
        candidateId: "chunk-b",
        score: 0.91,
        rank: 0,
      },
    ]);
  });

  test("uses TEI ranks and rejects duplicate or missing candidate indices", async () => {
    let body: Record<string, unknown> | null = null;
    const provider = new TeiRerankProvider({
      baseUrl: "http://paired-node.internal:8080",
      modelRevision: "a".repeat(40),
      teiRevision: "b".repeat(40),
      imageDigest: `sha256:${"c".repeat(64)}`,
      fetch: async (_input, init) => {
        body = JSON.parse(String(init?.body));
        return Response.json({
          ranks: [
            { index: 1, score: 0.8 },
            { index: 0, score: 0.3 },
          ],
          metadata: { compute_chars: 32 },
        });
      },
    });
    const output = await provider.rerank({
      operationId: "tei-op",
      query: "question",
      candidates,
      topN: 1,
      signal: new AbortController().signal,
    });
    expect(body as unknown).toEqual({
      query: "question",
      texts: ["premier document", "second document"],
      truncate: false,
      raw_scores: false,
      return_text: false,
    });
    expect(output[0]?.candidateId).toBe("chunk-b");

    const hostile = new TeiRerankProvider({
      baseUrl: "http://paired-node.internal:8080",
      modelRevision: "a".repeat(40),
      teiRevision: "b".repeat(40),
      imageDigest: `sha256:${"c".repeat(64)}`,
      fetch: async () =>
        Response.json({
          ranks: [
            { index: 0, score: 1 },
            { index: 0, score: 0.5 },
          ],
        }),
    });
    await expect(
      hostile.rerank({
        operationId: "tei-hostile-op",
        query: "question",
        candidates,
        topN: 2,
        signal: new AbortController().signal,
      }),
    ).rejects.toThrow("INVALID_OR_DUPLICATE_RESULT_INDEX");
  });
});
