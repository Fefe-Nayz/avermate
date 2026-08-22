# Plan 036: Multimodal school RAG, embeddings and reranking

> **Executor instruction**
>
> Read plans 028, 029, 033 and 035 completely, then audit the current corpus,
> source adapters, storage handles, project references, provider-key settings and
> Web search/project/assistant surfaces. This plan makes advanced retrieval a
> delivered capability, not a forever-optional TODO. Provider selection remains
> optional and explicit; the contracts, Gemini adapter, cloud reranker, local
> reranker, evaluation harness, fallback and Web controls are mandatory. Do not
> include React Native.

## Status

- **Status**: TODO
- **Priority**: P0
- **Effort**: XL
- **Risk**: HIGH
- **Depends on**: 025, 027–029 and 035; Node-local providers consume 032/038;
  dynamic media page/segment production consumes 033
- **Blocks**: cited multimodal answers and the learning loop in 037
- **Category**: retrieval, multimodal documents, search quality, Web product
- **Planned at**: 2026-08-22, branch `rewrite`
- **Evidence baseline**: `dbd4fe87957fb23cbfd4b0815a029fc21ff6aa64` plus the
  uncommitted 025–034 implementation; replace after the implementation-wave
  commit

## Decision

Implement one provider-neutral, versioned retrieval pipeline with all of these
stages:

```text
scope/ACL + query normalization
       -> lexical FTS candidate generation
       -> dense text/multimodal candidate generation
       -> identity/version dedupe + reciprocal-rank fusion
       -> diversity and source/page constraints
       -> cross-encoder reranking
       -> parent/neighbor expansion
       -> evidence-budget packing
       -> exact claim-local citations
```

`gemini-embedding-2` is the required first multimodal cloud adapter because the
stable API accepts text, images, audio, video and PDF in one space across 100+
languages. It supports one PDF of at most six pages per request and Google
recommends one page per PDF for quality, so Avermate indexes one original page or
meaningful media segment at a time. The adapter is not the storage contract and
does not replace native text extraction, lexical search, source bytes, exact
locators or user consent.

Reranking is also a real stage, not a type-only extension. Implement at least:

- a cloud `CohereRerankProvider` supporting the current multilingual
  `rerank-v4.0-pro` and `rerank-v4.0-fast` API;
- a Node-local `TeiRerankProvider` for a pinned Apache-2.0 multilingual
  cross-encoder, initially `Alibaba-NLP/gte-multilingual-reranker-base`;
- a higher-quality local profile for `Qwen/Qwen3-Reranker-0.6B` behind a pinned,
  purpose-built worker after its exact runtime output passes parity fixtures;
- a disabled provider that is explicit and never advertised as advanced RAG.

Add `VoyageRerankProvider` for `rerank-2.5` if its real French-school evaluation
beats or materially complements Cohere under the same privacy/cost constraints.
The comparison is evidence-driven; marketing benchmarks do not select the
production default.

Primary references frozen for the initial implementation:

- <https://ai.google.dev/gemini-api/docs/embeddings>
- <https://docs.cohere.com/v2/docs/rerank>
- <https://docs.voyageai.com/docs/reranker>
- <https://huggingface.co/Alibaba-NLP/gte-multilingual-reranker-base>
- <https://huggingface.co/Qwen/Qwen3-Reranker-0.6B>
- <https://github.com/huggingface/text-embeddings-inference>

## Current-state evidence and gaps

1. `packages/agent-contracts/src/corpus.ts:329-360` already defines embedding
   space descriptors plus text/media input, but no equivalent `RerankProvider`
   contract is implemented.
2. `apps/server/src/jobs/corpus.ts:233-269` deliberately excludes
   `visual-only` chunks from embedding jobs. Pages without text are therefore
   openable but not semantically searchable.
3. `apps/server/src/search/adapters.ts:380-406` and other source adapters produce
   honest `visual-only` evidence; the provenance model is reusable.
4. `apps/server/src/search/vector-runtime.ts` has a configured text embedding
   seam and optional vector store, but no Gemini multimodal transport and no
   production reranker.
5. `apps/server/src/db/schema/corpus.ts:95-139` stores project membership by
   `kind + referenceId`; it does not pin a conversation branch/head or immutable
   source version.
6. `apps/server/src/assistant/core-conversation-store.ts:2349-2403` accepts a
   branch while saving a conversation to a project, but the project item records
   only the thread reference. The conversation adapter then indexes the thread's
   completed messages as a whole (`apps/server/src/search/adapters.ts:780-845`).
7. Plan 028's current lexical/hybrid primitives and exact proof handles are
   green. They must remain the fallback and citation authority while dense and
   rerank stages evolve.
8. There is no real Web configuration/status experience for embeddings,
   rerankers, reindex progress, provider disclosure or retrieval-quality mode.

## Mandatory drift check

```text
git rev-parse HEAD
git status --short
rg -n "interface EmbeddingProvider|visual-only|embedMedia|RerankProvider" packages apps/server
rg -n "studyProjectItems|kind = 'conversation'|branchId" apps/server/src/db/schema/corpus.ts apps/server/src/assistant apps/server/src/search
rg -n "embedding|rerank|Gemini|Cohere|Voyage" apps/server/src apps/web/src
bun run --cwd apps/server test src/search src/jobs/corpus.test.ts
bun run verify:029:citations
```

STOP and update the evidence if a newer stable provider/model replaced one of
the pinned defaults, if the corpus placement moved to Node, or if project items
already gained immutable branch/version selectors.

## Non-negotiable invariants

- Authorization and source-version filtering happen before any bytes or text
  leave their authoritative placement and are checked again before packing.
- Lexical search is always available for text-bearing sources and survives
  provider outages, reindexing and model changes.
- Vectors from different provider/model/revision/dimension/preprocessing spaces
  are never compared. A space change creates a new immutable index generation.
- The original file/source version remains truth. Embeddings and OCR are
  disposable derivatives that can be rebuilt without changing citations.
- One PDF page, image, slide, audio window or video window maps to an exact
  locator and content digest. No six-page aggregate is cited as one page.
- Native PDF text is extracted deterministically. OCR is cached when required
  for selection/accessibility/exact quotes; Gemini's internal PDF OCR is not
  falsely presented as an Avermate transcript.
- Sending school content to Google, Cohere, Voyage or another cloud provider
  requires an explicit per-provider disclosure and user/tenant policy. BYOK does
  not waive privacy disclosure.
- Rerankers receive the smallest authorized candidate representation. They do
  not receive signed URLs, credentials, unrelated metadata or the entire corpus.
- Search quality is measured by retrieval metrics and human-reviewed evidence,
  not by a perfect synthetic fixture.
- A provider timeout may fall back only to a user-approved mode. The response
  records which stages actually ran; it never labels lexical-only output as
  reranked multimodal RAG.

## In scope

- Versioned multimodal page/segment derivatives and indexing jobs.
- Gemini Embedding 2 transport, service-key lifecycle and consent boundary.
- Required `RerankProvider` contract and cloud/local implementations.
- Lexical+dense fusion, reranking, diversity, context packing and trace metadata.
- Immutable branch-aware project conversation references.
- Search, project and assistant Web experiences for setup/status/progress/results.
- A serious French school retrieval/evidence evaluation suite and ablations.

## Out of scope

- Delegating corpus authority to a provider-managed File Search product.
- Deleting OCR/transcripts or making every PDF go through paid OCR first.
- Cross-user/global vector spaces or training on user content.
- A claim that one vendor is universally best without Avermate evaluation.
- Replacing citations with provider-generated grounding metadata.
- React Native.

## Required contracts

### Embedding space

Extend the current descriptor without leaking provider implementation types:

```ts
type EmbeddingSpaceDescriptor = {
  id: string;
  provider: string;
  model: string;
  modelRevision: string;
  dimensions: number;
  modalities: Array<"text" | "image" | "pdf-page" | "audio" | "video">;
  normalization: "provider-unit" | "client-unit";
  preprocessingRevision: string;
  placement: "core" | "node" | "managed";
};
```

The persisted space key includes every field that changes vector meaning.
Gemini defaults to 768 dimensions only after evaluation confirms the expected
quality/storage tradeoff; 1536 and 3072 remain separate spaces.

### Reranking

Add a bounded contract in `packages/agent-contracts`:

```ts
interface RerankProvider {
  descriptor(): RerankSpaceDescriptor;
  rerank(input: {
    operationId: string;
    query: string;
    candidates: readonly RerankCandidate[];
    topN: number;
    signal: AbortSignal;
  }): Promise<readonly RerankScore[]>;
}
```

Descriptors include provider/model/revision, language/modalities, maximum
candidates/tokens, score semantics, placement and cost unit. Results contain
only known candidate IDs, finite scores and stable order. Duplicate, missing,
invented or cross-operation IDs fail closed.

### Retrieval trace

Persist or emit a privacy-safe trace containing query digest, corpus generation,
scope digest, candidate counts, exact stage descriptors, durations, fallback
reason, packed evidence IDs and evaluation correlation ID. Do not persist raw
queries by default outside the conversation that already owns them.

## Implementation sequence

### 1. Correct project and corpus version semantics

- Add append-only migration(s) for project item selectors:
  `sourceVersionId`, `conversationBranchId`, `conversationHeadMessageId` and an
  explicit `trackingMode` (`pinned` or `follow-head`).
- Backfill existing source items as `follow-head`; backfill conversation items
  to the active branch/head captured at migration time and mark them for user
  review rather than inventing historical intent.
- Make save-to-project persist the selected branch/head. Editing/retrying an old
  message does not silently change a pinned project source.
- Index conversation messages reachable from the selected branch head only.
- Keep immutable corpus generations while project membership changes publish a
  new pointer atomically.

### 2. Produce exact page and media derivatives

- Split PDFs into single-page PDF derivatives and bounded preview images through
  a reviewed plan-033 worker. Preserve original document/page numbering,
  rotation, dimensions and digest.
- Extract native text locally where present. Mark scan/handwriting confidence
  and enqueue OCR only when policy or a feature requires it.
- Convert DOCX/PPTX/ODT to page/slide derivatives in an attested sandbox before
  visual embedding; keep structured extraction separately.
- For XLSX/CSV, index structured cells and optional sheet renderings; never use a
  visual vector for exact calculations.
- Segment audio/video with overlap and exact millisecond locators. Keep transcript
  windows independently searchable and align visual segments where available.
- Normalize inline transcript/OCR images to private file records and opaque
  handles; Markdown must render those handles without hotlinking.

### 3. Implement Gemini Embedding 2

- Add `gemini` to the validated service-key provider union, settings copy,
  server-only resolution and minimal credential check. Stored keys remain sealed
  and are never readable by Web code.
- Implement a bounded Gemini adapter using the stable
  `gemini-embedding-2` model and exact API schema. Enforce TLS origin, deadline,
  response bytes, vector count, dimensions, finite values and cancellation.
- Use explicit retrieval instructions for text query/document inputs as the
  current model requires. Do not apply incompatible `task_type` parameters from
  `gemini-embedding-001`.
- Submit one PDF page per input. Reject accidental multi-page/truncated payloads
  before spend; store provider token/usage metadata when returned.
- Batch idempotently by source version and space. Partial provider results never
  publish a generation.
- Add deletion/reindex controls that remove only derivatives/vectors, not source
  files or lexical text.

### 4. Implement rerank providers

- Add Cohere key validation and a v2 HTTPS adapter for
  `rerank-v4.0-pro`/`fast`; bound candidate count, per-document bytes/tokens,
  total payload, deadline and response indices.
- Add a Node-private TEI `/rerank` adapter. The Core sends it only through the
  paired Node transport and capability grant.
- Pin the TEI image by digest and the GTE model by immutable revision. Provide
  CPU and GPU resource profiles with honest latency/readiness.
- Add a purpose-built Qwen3 rerank worker/profile only after Transformers and
  serving outputs match a checked-in scorer fixture. Do not accept a generic
  OpenAI chat answer as a relevance score.
- Implement Voyage 2.5 behind the same boundary if approved by the comparative
  evaluation. Never mix raw score thresholds across providers; use ordering and
  provider-specific calibration metadata.

### 5. Build the advanced retrieval policy

- Retrieve configurable but bounded lexical and dense pools, initially 80 each.
- Apply ACL, source version and locator validity before fusion.
- Deduplicate by immutable source-version/chunk-or-page identity.
- Fuse ranks with deterministic reciprocal-rank fusion; do not add incomparable
  BM25/cosine values directly.
- Apply per-source/page caps and deterministic diversity so one long document
  cannot consume the entire reranker window.
- Rerank the top bounded window (initially 50), then expand adjacent/parent
  context for the winning evidence only.
- Pack evidence against model token/image budgets while retaining proof handles,
  exact locators and original page/image handles.
- Record every stage actually used. If dense or rerank fails, follow the user's
  fallback policy (`fail`, `lexical-only`, or `hybrid-without-rerank`).
- Keep query rewriting/multi-query retrieval separately gated and evaluated;
  generated rewrites may add candidates but never relax scope or citation rules.

### 6. Complete the Web experience

- Add Settings controls for Gemini, Cohere and any approved provider with
  validate/replace/delete, privacy disclosure, placement and last-validation
  status. Never return stored secret material.
- Add project retrieval settings: lexical-only, advanced automatic, exact
  embedding/reranker placement, fallback policy and reindex action.
- Show per-source indexing states for native text, OCR, page derivatives,
  embeddings and failures with durable live progress/cancel/retry.
- Search results render page/slide/timecode thumbnails, matched text when
  available, provider-neutral relevance labels and an “open exact source” action.
- Assistant citations open the exact page/region/timecode and may show the
  original visual evidence; a model cannot cite an inaccessible derivative.
- Add a developer/evaluation panel behind an explicit development/admin gate for
  stage timings, ranks and ablation results. Do not expose raw scoring traces to
  ordinary users as unexplained confidence.
- Add empty, offline, provider-denied, reindexing, degraded and stale-space states
  plus keyboard/screen-reader coverage.

### 7. Build a school-specific evaluation gate

- Create a versioned, synthetic/redacted French corpus with native/scanned PDFs,
  handwriting, equations, diagrams, tables, slides, audio/video, Moodle sources,
  grades and branch-specific conversations.
- Human-label query relevance at page/chunk level, answerability, exact evidence
  and allowed source scope. Include adversarial near-duplicates and conflicting
  periods/years.
- Report Recall@5/10/20, MRR@10, nDCG@10, MAP, source diversity, citation
  precision/coverage, abstention, latency and provider cost.
- Run ablations: lexical; dense; lexical+dense RRF; RRF+each reranker; text-only;
  multimodal; OCR on/off; 768/1536/3072 Gemini dimensions.
- Select defaults per workload only when advanced mode materially improves the
  labelled metrics without unacceptable privacy, cost or p95 latency. Store the
  full machine-readable report and model revisions.

## Verification matrix

Add dedicated scripts such as `verify:036:contracts`, `:gemini`, `:rerank`,
`:retrieval`, `:web`, `:evaluation` and an aggregate that cannot pass if an
advertised provider is only a mock.

Minimum cases:

- Gemini text/image/PDF-page request and response fixtures; size, page, token,
  truncation, malformed vector, timeout, cancellation and redaction attacks;
- embedding-space generation coexistence and atomic pointer promotion;
- Cohere v4 response-index validation, duplicate/invented index rejection,
  payload limits and cancellation;
- live Node-local TEI rerank conformance against a pinned model/image; mock is
  labelled unit evidence only;
- deterministic RRF/dedupe/diversity/neighbor expansion/context packing;
- provider outage for each explicit fallback policy;
- branch-pinned conversation indexing and cross-branch exclusion;
- cross-owner/project/year/placement isolation at every stage;
- exact page/image/timecode citations after dense retrieval and reranking;
- reindex, concurrent publication, deletion/export and model-space migration;
- Web key lifecycle, consent, progress, degraded state and citation navigation;
- evaluation thresholds and regression budget on the checked-in French corpus.

Then run:

```text
bun run verify:036
bun run verify:029:citations
bun run --cwd apps/server test src/search src/jobs src/assistant
bun run --cwd apps/web test
bun run --cwd apps/web e2e -- retrieval
bun run check-types
bun run lint
bun run format:check
bun run test
bun run build
```

## STOP conditions

STOP and request a decision if:

- provider terms/privacy would allow training on school content without the
  required opt-in or contracted protection;
- a cloud SDK cannot be bounded, cancelled, redacted or pinned to the expected
  origin/model;
- the implementation would compare vectors across incompatible spaces;
- a reranker requires sending unsigned URLs, credentials or candidates outside
  the authorized scope;
- a “multimodal citation” cannot resolve to the original owned page/segment;
- the only local reranker path uses an unpinned image/model or arbitrary shell;
- Docker/sandbox evidence is unavailable and a mock would be presented as live;
- the advanced pipeline regresses labelled French-school retrieval without a
  workload-specific justification;
- migration work would rewrite already-ratified history.

## Definition of done

- Gemini Embedding 2 works end to end for text, image and one-page PDF inputs
  with explicit consent, durable progress, deletion and reindexing.
- Native text/FTS remains available and no model change deletes source truth.
- Cohere cloud reranking and one pinned Node-local multilingual reranker pass the
  same contract; the higher-quality local profile is either green or explicitly
  non-advertised with recorded evidence.
- Production advanced search executes lexical+dense RRF and reranking, records
  truthful stage metadata, and follows explicit fallback policy.
- Project conversation sources are branch/head-aware and citations never escape
  the selected history.
- The Web exposes provider setup, consent, indexing progress, retrieval mode,
  degraded states and exact multimodal source navigation.
- The real labelled evaluation demonstrates the selected defaults and keeps its
  report/model revisions under version control or immutable release evidence.
- All plan-specific, migration, security, root test and build gates pass; any
  live-provider job that is required for release is not converted to a skip.

## Maintenance trigger

Re-evaluate and, when necessary, reindex into a new immutable space whenever a
provider model/revision, preprocessing instruction, dimensions, page renderer,
chunking policy, reranker, fusion policy or corpus locator schema changes.
