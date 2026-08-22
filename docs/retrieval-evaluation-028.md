# Corpus and retrieval evaluation (Plan 028)

This document describes the backend retrieval baseline shipped for Plan 028.
It is intentionally provider-independent: lexical search, project scoping and
exact citations remain available when no inference or embedding provider is
configured.

## Architecture and placement contract

The shared corpus contract lives in `@avermate/agent-contracts`. The core
placement implements it with:

- `CoreCorpusStore` for owned source registration, durable staging, immutable
  versions/chunks, publication and reference-aware garbage collection;
- `SqliteFts5LexicalSearchBackend` for mandatory lexical retrieval;
- `CoreCitationResolver` for owned resolution and open targets;
- `LexicalOnlyVectorIndex` and the explicit opt-in in-memory cosine adapter for
  conformance tests;
- an OpenAI-compatible text `EmbeddingProvider`, a persistent Qdrant
  `VectorIndex` and deterministic reciprocal-rank fusion for optional hybrid
  retrieval.

A future node placement is conforming only when its store, lexical backend and
citation resolver pass the same placement tests. A vector-only node is not a
supported corpus placement.

The `0055_third_mephistopheles` migration creates study projects, polymorphic
project references, owned content sources, immutable versions/chunks/assets,
durable citation edges and durable staging rows. SQLite triggers enforce:

- unique owned source identity and unique version/chunk keys;
- immutable published versions, chunks and references;
- source/project ownership and compatible academic-year scope;
- citation chunk/version agreement and citation ownership;
- an atomic current-version pointer and FTS synchronization.

Indexing extracts and stages a complete candidate version before one
transaction publishes the version, chunks, private asset edges, FTS rows and
current pointer. Newly captured image objects are prepared first and
compensated if publication fails. A failure, cancellation or stale
compare-and-swap leaves the preceding version current and searchable. Repair
compares deterministic source version keys; verify/rebuild checks FTS
consistency; GC retains every version reached by a durable citation or project
snapshot.

## Source coverage and locator truthfulness

| Source               | Searchable evidence                               | Locator                                            | Degraded behavior                                                   |
| -------------------- | ------------------------------------------------- | -------------------------------------------------- | ------------------------------------------------------------------- |
| Inline material      | Native text                                       | Exact character range                              | Empty text is unsupported                                           |
| Web article          | Extracted Markdown                                | Heading path and source line range                 | No body is fabricated                                               |
| YouTube              | Publisher captions persisted during ingestion     | Exact caption-derived video start/end milliseconds | A legacy flattened transcript is metadata-only                      |
| Uploaded PDF         | Native PDF text layer, then exact ready OCR pages | Exact one-based PDF page                           | Textless pages stay visual-only until OCR; unseen text cannot match |
| Audio/video material | Provider segments persisted during transcription  | Exact audio/video start/end milliseconds           | A legacy flattened transcript is metadata-only                      |
| Lecture recording    | Stored transcript segments                        | Exact audio start/end milliseconds                 | Recording metadata remains openable but not full-text searchable    |
| Study document       | Revisioned Markdown or slide source               | Heading/line range or slide number                 | Empty documents are unsupported                                     |
| Grade                | Compact structured fact                           | Grade identifier                                   | Never represented as a fabricated course transcript                 |
| Subject              | Compact structured fact                           | Exact text range                                   | Never represented as a fabricated course transcript                 |
| Generated artifact   | Title/status metadata                             | Openable metadata locator                          | `metadata-and-locators-only` until a native extractor exists        |
| Conversation         | Disabled in Plan 028                              | None                                               | Plan 029 owns the real adapter and lifecycle                        |

OCR, YouTube and media jobs store structured extraction rows in the same
transaction that marks the artifact ready. The indexer never guesses a page or
timestamp by splitting final Markdown. Visual-only chunks carry truthful
coverage/evidence labels and are not a substitute for body text.

Uploaded PDFs are read from private managed storage with a 64 MiB input bound,
a 10,000-page bound, a 64 MiB extracted-text bound and a parsing timeout. Native
text is extracted deterministically page by page. Ready OCR segments fill only
pages without usable native text, avoiding duplicate or conflicting evidence.
If parsing fails, the failure class—not the path, URL or file bytes—is retained
as diagnostic metadata and exact OCR/visual fallback remains available.

Markdown images that survive a vetted extractor are fetched through the shared
public-network/redirect policy (or decoded from a bounded data URI), decoded
under a raster-pixel budget, resized and re-encoded to metadata-free WebP.
Their Markdown destination becomes `asset://<sha256>` and `content_assets`
points to a private owned `files` row. Failed/disabled captures are reduced to
bounded alt text, so an indexed chunk never retains a remote hotlink. The
current web-page ingestion sanitizer still removes arbitrary page images before
Markdown generation; this capture path intentionally applies only to images an
extractor has explicitly retained.

## Lexical behavior and security

The SQLite backend uses FTS5 with Unicode61 text segmentation, SQLite's
level-two diacritic removal, and prefix indexes. It supports:

- safe AND terms;
- safe phrases;
- safe token prefixes;
- case-sensitive exact literals for formulas such as `E=mc^2`.

User syntax is tokenized and quoted before it reaches FTS, so operators and
malformed quote input are inert. French accent folding improves recall without
rewriting exact-formula queries. BM25 results use stable chunk-id tie breaking
and an opaque offset cursor.

Search first selects candidate identifiers through joins that enforce owner,
current version, project, year, subject and source-kind filters. It then
re-checks ownership before selecting any chunk body. A stale or poisoned FTS
row therefore cannot expose another user's text. Search results create durable,
hash-bound citation edges; resolving or opening one repeats the ownership check
and returns the immutable locator and content hash.

## Fixed evaluation corpus

`src/search/fixtures/evaluation-028.ts` contains 64 committed, labelled school
queries: 40 French and 24 English, distributed across materials, study
documents, recordings, grades, subjects and artifacts. The corpus includes
accents, abbreviations, formula/exact-mode coverage, transcript and PDF
locators, and intentionally similar cross-user content.

The mandatory automated gate measures one gold chunk per query and requires:

- lexical Recall@5 at least `0.85`;
- mean reciprocal rank at least `0.75`;
- returned Precision@5 at least `0.70`;
- exact locator/content-hash round trips;
- zero cross-user results;
- deterministic pagination and rebuild equivalence;
- zero unseen-body hits and truthful labels for scan-only fixtures.

On the bundled SQLite/Bun test runtime on 2026-08-22, all 64 gold chunks were
retrieved in the first five results and every asserted threshold passed. The
test deliberately calls the last metric “returned Precision@5”: it divides by
the bounded number of returned candidates, not by five when fewer than five
results exist.

The in-memory vector adapter has deterministic cosine ordering, ownership and
space isolation, dimension/finite-value validation, removal by immutable
version and deterministic RRF coverage. It remains test-only.

The production adapter is disabled unless `CORPUS_EMBEDDING_ENABLED=true` and
every provider/vector field below is present. It sends bounded chunk/query text
to an OpenAI-compatible `/embeddings` endpoint through Avermate's origin-bound,
DNS-pinned model transport, validates result ordering, finiteness and exact
dimensions, and stores vectors in Qdrant. Qdrant payload filters enforce
`ownerId + spaceId` before candidate return; SQLite then independently verifies
owner, current version and project/year/subject/kind scope before selecting a
chunk body.

Each exact provider/model/dimension/preprocessing descriptor receives a new
collection. A full re-embed writes that collection while lexical and the prior
vector space remain active, then switches the durable `*_active` Qdrant alias
with one alias transaction. Identical owned content hashes are reused from the
staging collection. Per-owner rebuilds may stage vectors but cannot switch the
global alias. No test claims semantic uplift from a real provider: enabling one
for evaluation is an explicit opt-in gate.

Configuration (values are never returned or logged):

```dotenv
CORPUS_EMBEDDING_ENABLED=true
CORPUS_EMBEDDING_PROVIDER=openai-compatible
CORPUS_EMBEDDING_BASE_URL=https://provider.example/v1
CORPUS_EMBEDDING_API_KEY=...
CORPUS_EMBEDDING_MODEL=embedding-model-id
CORPUS_EMBEDDING_DIMENSION=1536
AVERMATE_DEPLOYMENT_MODE=full-self-host
CORPUS_EMBEDDING_PLACEMENT=full-self-host
CORPUS_EMBEDDING_LOCAL=false
CORPUS_VECTOR_URL=https://qdrant.example
CORPUS_VECTOR_API_KEY=...
CORPUS_VECTOR_COLLECTION_PREFIX=avermate_corpus
```

For an operator-controlled full-self-host endpoint, set placement to
`full-self-host` and `CORPUS_EMBEDDING_LOCAL=true`. Hosted-core embedding is
fail-closed until it is dispatched through the managed reservation/cost-control
router; a `node` label is likewise rejected until the request actually crosses
the Node execution router. With the flag absent,
partial configuration, an unreachable vector alias or any capability mismatch,
search stays lexical and the privacy endpoint reports the real disabled,
incomplete, configured and active states separately.

## Operational API and jobs

The owned `projects` router provides project create/list/get/update,
star/trash/restore, source add/remove/reorder, scoped search, citation read,
chunk resolve, index status/retry and the explicit embedding privacy status.
Adding or removing a project item never moves or deletes its source. Conversation
items are rejected until Plan 029 registers its native adapter.

The durable worker registry includes source indexing, version removal/GC, FTS
rebuild, verify, repair, embedding and re-embedding job kinds. Index jobs honor
the worker cancellation signal at extraction and publication fences. When the
optional runtime is configured, a committed source index schedules its
immutable version for embedding; otherwise it returns a null embedding job and
remains fully searchable lexically. Personal file upload schedules
`corpus.indexSource` only after adoption is committed, with a stable
`material:<documentId>` idempotency key, so concurrent direct-upload replays
produce one durable job. Repair is idempotent because unchanged source version
keys resolve to the already committed immutable version.

## Web project surface

`/projects` provides active/trash lists, create/edit/star/trash/restore, project
instructions, source catalog add/remove/reorder, truthful index state and retry,
and scoped lexical/hybrid search. Filters cover project, academic year, subject
and source kind. Selecting a result creates and reads an immutable citation and
shows the exact page, heading/line, time, slide, grade or text range. The pages
hydrate TanStack Query from authenticated server prefetches, invalidate only
affected keys, poll only while indexing, and use accessible dialogs/sheets and
mobile layouts. The existing source viewers remain the canonical open target.

## Reproducible gates

Run from the repository root:

```powershell
bun run --cwd apps/server test src/search
bun run --cwd apps/server test src/routers/projects.test.ts
bun run --cwd apps/server test src/routers/materials.test.ts --test-name-pattern "uploads a personal PDF|adopts a direct upload"
bun run --cwd apps/web test src/components/projects
bunx --cwd apps/web eslint src/components/projects "src/app/(app)/projects" src/lib/nav.ts
bun run --cwd apps/server test src/lib/youtube.test.ts src/lib/ocr.test.ts src/jobs/transcribe-material-media.test.ts src/routers/materials.test.ts
bun run --cwd apps/server test scripts/migration-history.test.ts scripts/migrate-prefix.integration.test.ts
bun run --cwd apps/server check-types
```

The migration tests replay all migrations into isolated temporary databases;
they do not modify a developer database. Global type checking may still report
independent work in later plans, but Plan 028-owned modules must remain clean.
