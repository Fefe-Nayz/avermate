import { describe, expect, test } from "bun:test";
import {
  assertEvaluationMediaSignature,
  assertLiveEvaluationReportRedacted,
  batchTextEmbeddingInputs,
  cosineSimilarity,
  evaluateLiveQualityGate,
  liveEvaluationManifestSchema,
  orderRerankedDocumentIds,
  rankDenseDocuments,
  rankDocumentsWithBm25,
  runLiveRetrievalEvaluation,
  validateRelativeMediaPath,
} from "./live-evaluation";

describe("Plan 036 live evaluation algorithms", () => {
  test("ranks French lexical evidence deterministically with BM25", () => {
    const documents = [
      { id: "b", text: "Révolution industrielle et machine à vapeur" },
      { id: "a", text: "Le théorème de Thalès compare des longueurs" },
      { id: "c", text: "Thales est aussi un nom sans accent" },
    ];
    const first = rankDocumentsWithBm25("théorème de Thalès", documents);
    expect(first).toEqual(
      rankDocumentsWithBm25("théorème de Thalès", documents),
    );
    expect(first[0]?.id).toBe("a");
    expect(first[0]!.score).toBeGreaterThan(0);
    expect(first.every((entry) => entry.score > 0)).toBe(true);
  });

  test("ranks multiple text/media vectors by their best compatible evidence", () => {
    expect(cosineSimilarity([1, 0], [1, 0])).toBe(1);
    expect(
      rankDenseDocuments(
        [1, 0],
        [
          { id: "text-only", vectors: [[0, 1]] },
          {
            id: "multimodal",
            vectors: [
              [0, 1],
              [0.99, 0.01],
            ],
          },
        ],
      )[0]?.id,
    ).toBe("multimodal");
    expect(() => cosineSimilarity([1], [1, 0])).toThrow(
      "LIVE_EVAL_VECTOR_DIMENSION_MISMATCH",
    );
  });

  test("rejects incomplete, duplicate or invented reranker results", () => {
    expect(
      orderRerankedDocumentIds({
        candidateIds: ["a", "b"],
        scores: [
          { candidateId: "b", rank: 0, score: 0.9 },
          { candidateId: "a", rank: 1, score: 0.2 },
        ],
      }),
    ).toEqual(["b", "a"]);
    expect(() =>
      orderRerankedDocumentIds({
        candidateIds: ["a", "b"],
        scores: [{ candidateId: "invented", rank: 0, score: 1 }],
      }),
    ).toThrow("LIVE_EVAL_RERANK_RESULT_INVALID");
  });

  test("batches text below both provider count and byte ceilings", () => {
    const inputs = Array.from({ length: 205 }, (_, index) => ({
      text: `document-${index}`,
    }));
    const batches = batchTextEmbeddingInputs(inputs);
    expect(batches.map((batch) => batch.length)).toEqual([100, 100, 5]);
    expect(batches.flat()).toEqual(inputs);
  });

  test("fails a reviewed live gate on regression, latency and unknown bounded cost", () => {
    const metric = {
      recallAt5: 0.7,
      recallAt10: 0.7,
      recallAt20: 0.7,
      mrrAt10: 0.7,
      ndcgAt10: 0.7,
      map: 0.7,
      sourceDiversityAt10: 1,
      citationLocatorAccuracy: 1,
      multimodalRelevantRecallAt10: 0.7,
      citationPrecisionAt10: 0.7,
      citationCoverageAt10: 0.7,
      abstentionAccuracy: 0.7,
      p50LatencyMs: 100,
      p95LatencyMs: 5_000,
      totalProviderCostMinor: null,
    };
    expect(
      evaluateLiveQualityGate({
        final: metric,
        lexical: { ...metric, recallAt10: 0.69 },
        thresholds: {
          minimumRecallAt10: 0.8,
          minimumNdcgAt10: 0.6,
          minimumCitationPrecisionAt10: 0.6,
          minimumAbstentionAccuracy: 0.6,
          minimumRecallImprovementOverLexical: 0.05,
          maximumP95LatencyMs: 2_000,
          maximumQueryProviderCostMinor: 10,
        },
      }),
    ).toMatchObject({
      passed: false,
      reasons: [
        "recall-at-10",
        "recall-improvement-over-lexical",
        "p95-latency",
        "query-provider-cost-unavailable",
      ],
    });
  });
});

describe("Plan 036 live evaluation input security", () => {
  test("fails closed before network access when operator configuration is absent", async () => {
    await expect(runLiveRetrievalEvaluation({})).rejects.toThrow(
      "LIVE_EVAL_REQUIRED_ENV_MISSING:PLAN036_EVAL_MANIFEST",
    );
  });

  test("requires absolute operator-controlled input and output paths", async () => {
    await expect(
      runLiveRetrievalEvaluation({
        PLAN036_EVAL_MANIFEST: "relative/manifest.json",
        PLAN036_EVAL_REPORT: "relative/report.json",
      }),
    ).rejects.toThrow("LIVE_EVAL_MANIFEST_PATH_MUST_BE_ABSOLUTE");
  });

  test("rejects raw corpus or secret material in a would-be report", () => {
    expect(() =>
      assertLiveEvaluationReportRedacted('{"digest":"abc"}', [
        "texte privé unique",
        "secret-key",
      ]),
    ).not.toThrow();
    expect(() =>
      assertLiveEvaluationReportRedacted('{"summary":"texte privé unique"}', [
        "texte privé unique",
      ]),
    ).toThrow("LIVE_EVAL_REPORT_REDACTION_FAILED");
  });

  test("rejects traversal, absolute Windows/POSIX paths and ambiguous segments", () => {
    expect(validateRelativeMediaPath("media/page-001.pdf")).toBe(true);
    for (const hostile of [
      "../secret.pdf",
      "media/../secret.pdf",
      "/etc/passwd",
      "C:\\Users\\secret.pdf",
      "\\\\server\\share\\secret.pdf",
      "media//page.pdf",
      "media/./page.pdf",
      "media/page.pdf:secret",
      "media/CON.pdf",
      "media/page.pdf. ",
    ]) {
      expect(validateRelativeMediaPath(hostile)).toBe(false);
    }
  });

  test("checks declared media signatures before any provider call", () => {
    expect(() =>
      assertEvaluationMediaSignature(
        "application/pdf",
        new TextEncoder().encode("not a PDF"),
      ),
    ).toThrow("LIVE_EVAL_MEDIA_SIGNATURE_MISMATCH");
    expect(() =>
      assertEvaluationMediaSignature(
        "image/png",
        Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]),
      ),
    ).not.toThrow();
  });

  test("enforces corpus byte bounds and reference integrity", () => {
    const base = {
      schemaRevision: "avermate-live-retrieval-evaluation/1",
      corpusRevision: "corpus-v1",
      labelRevision: "labels-v1",
      reviewedAt: "2026-08-22T12:00:00+02:00",
      language: "fr",
      license: "private reviewed evaluation corpus",
      qualityGate: {
        minimumRecallAt10: 0.8,
        minimumNdcgAt10: 0.7,
        minimumCitationPrecisionAt10: 0.7,
        minimumAbstentionAccuracy: 0.7,
        minimumRecallImprovementOverLexical: 0.05,
        maximumP95LatencyMs: 10_000,
      },
      documents: [
        {
          id: "doc-a",
          sourceId: "source-a",
          title: "Cours",
          text: "Contenu du cours",
          modality: "text",
          locator: { kind: "text", startOffset: 0, endOffset: 16 },
        },
        {
          id: "doc-b",
          sourceId: "source-b",
          title: "Annexe",
          text: "Autre contenu",
          modality: "text",
          locator: { kind: "text", startOffset: 0, endOffset: 13 },
        },
      ],
      queries: [
        {
          id: "q-a",
          query: "Question",
          answerable: true,
          relevance: [{ documentId: "missing", grade: 3 }],
        },
      ],
    };
    expect(liveEvaluationManifestSchema.safeParse(base).success).toBe(false);
    expect(
      liveEvaluationManifestSchema.safeParse({
        ...base,
        queries: [
          {
            ...base.queries[0],
            relevance: [{ documentId: "doc-a", grade: 3 }],
          },
        ],
      }).success,
    ).toBe(true);
    expect(
      liveEvaluationManifestSchema.safeParse({
        ...base,
        documents: [
          { ...base.documents[0], text: "x".repeat(12 * 1024 + 1) },
          base.documents[1],
        ],
        queries: [
          {
            ...base.queries[0],
            relevance: [{ documentId: "doc-a", grade: 3 }],
          },
        ],
      }).success,
    ).toBe(false);
  });
});
