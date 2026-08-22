# Plan 036 live retrieval evaluation

`verify:036:evaluation:regression` checks only the deterministic, pre-ranked
repository fixture. It catches metric and reporting regressions; it is not
evidence that a current provider/model is good.

`verify:036:evaluation:live` is the release-quality operator gate. It requires
a private or redistributable reviewed French corpus and calls Gemini Embedding
2 plus one real Cohere, TEI/GTE, or Qwen3 reranker. It fails closed when the
dataset, consent, credentials, immutable revisions, or output path is missing.

The manifest is strict JSON with this shape (comments shown here are not valid
JSON):

```jsonc
{
  "schemaRevision": "avermate-live-retrieval-evaluation/1",
  "corpusRevision": "school-corpus-2026-08",
  "labelRevision": "review-2026-08-22",
  "reviewedAt": "2026-08-22T12:00:00+02:00",
  "language": "fr",
  "license": "private reviewed corpus",
  "qualityGate": {
    "minimumRecallAt10": 0.8,
    "minimumNdcgAt10": 0.75,
    "minimumCitationPrecisionAt10": 0.75,
    "minimumAbstentionAccuracy": 0.75,
    "minimumRecallImprovementOverLexical": 0.05,
    "maximumP95LatencyMs": 10000,
    "maximumQueryProviderCostMinor": 25,
  },
  "documents": [
    {
      "id": "physics-page-12",
      "sourceId": "physics-course",
      "title": "Forces sur un plan incliné",
      "text": "Reviewed transcript or structured extraction used by BM25 and reranking.",
      "modality": "pdf-page",
      "locator": { "kind": "pdf", "page": 12 },
      "media": {
        "path": "media/physics-page-12.pdf",
        "mediaType": "application/pdf",
        "estimatedInputTokens": 900,
      },
    },
  ],
  "queries": [
    {
      "id": "inclined-plane",
      "query": "Comment décomposer les forces sur le plan incliné ?",
      "answerable": true,
      "relevance": [{ "documentId": "physics-page-12", "grade": 3 }],
    },
  ],
}
```

Media paths are relative to the manifest and may not contain symlinks,
traversal, absolute paths, or mismatched file signatures. A PDF derivative must
contain exactly one page. A release corpus must contain at least 12 documents,
8 queries, all five supported modalities, and both answerable and unanswerable
queries.

Required common environment:

```text
PLAN036_EVAL_MANIFEST=<absolute manifest path>
PLAN036_EVAL_REPORT=<new report path; existing files are never overwritten>
PLAN036_GEMINI_CONSENT=gemini-embedding-school-content/1
PLAN036_GEMINI_CONSENT_GRANTED_AT=<ISO datetime with offset>
PLAN036_EVAL_GEMINI_DIMENSIONS=768|1536|3072
PLAN036_EVAL_GEMINI_MODEL_REVISION=<recorded provider revision>
PLAN036_EVAL_RERANKER=cohere|tei|qwen3
PLAN036_EVAL_RETRIEVAL_LIMIT=20..100
PLAN036_EVAL_RERANK_WINDOW=20..128
PLAN036_EVAL_EVIDENCE_LIMIT=1..10
PLAN036_EVAL_ABSTENTION_SCORE_THRESHOLD=0..1
PLAN036_EVAL_TIMEOUT_SECONDS=60..3600
GEMINI_API_KEY=<secret>
```

Provider-specific variables use the existing `CORPUS_RERANK_*` configuration.
Cohere additionally requires `COHERE_API_KEY` and
`PLAN036_COHERE_CONSENT=cohere-rerank-school-content/1` plus
`PLAN036_COHERE_CONSENT_GRANTED_AT`. Local TEI/Qwen3 runs require their
immutable model/runtime/image revisions and endpoint.

Provider adapters do not return a stable monetary price. The report therefore
records cost as `null` unless the operator supplies a dated pricing revision,
currency, Gemini input-token rate, and rerank request rate through:

```text
PLAN036_EVAL_COST_CURRENCY=USD
PLAN036_EVAL_PRICING_REVISION=<dated price-card revision>
PLAN036_EVAL_GEMINI_COST_MINOR_PER_MILLION_INPUT_TOKENS=<number>
PLAN036_EVAL_RERANK_COST_MINOR_PER_REQUEST=<number; use explicit 0 for local>
```

The report contains no corpus text, query text, media path, credential, or
provider request ID. Citation/abstention fields are explicitly labelled as a
top-k retrieval-evidence proxy because this command does not run answer
generation. The report includes live ablations for BM25, text-only dense,
multimodal dense, multimodal RRF, and the final reranked pipeline; none of those
rankings are pre-authored in the manifest.

The reviewed quality thresholds are part of the label revision. A failing run
still writes its redacted evidence report, then exits non-zero with
`LIVE_EVAL_QUALITY_GATE_FAILED`; low metrics can therefore never make the live
verification command green.
