# Plan 028: Study projects, versioned corpus, hybrid retrieval and citations

> **Executor instructions**: Read this plan, the 026 contracts and 027 registry
> boundary before editing. Ship lexical projects/search before optional vector
> providers, run each delivery gate below, and update the 028 row in
> `plans/README.md` only when exact citations and cross-user isolation pass. Do
> not push or open a PR unless requested.
>
> **Drift check (run first)**: run `git diff --stat <plan-025-baseline>..HEAD --
apps/server/src/db/schema apps/server/src/jobs apps/server/src/search
apps/server/src/routers apps/server/src/mcp apps/web/src packages/core`. Compare
> live material/document/recording revisions and search behavior to “Current
> state”; stop if source ownership or locator persistence has changed without a
> reconciled design.

> [!IMPORTANT]
> This is the NotebookLM core, not an optional optimization. Build useful
> lexical retrieval and precise citations before relying on embeddings or an
> agent. With no inference key, a user must be able to search every source that
> has a deterministic native text layer and understand exactly where a result
> came from. A scanned or handwritten page without OCR is registered and
> openable by page, but is not falsely advertised as full-text searchable until
> OCR or an explicitly configured visual embedding capability has processed it.

## Status

- **Status**: IN PROGRESS — core projects, corpus, lexical retrieval and citation
  paths are implemented and targeted green; production placement and baseline
  gates remain
- **Priority**: P0
- **Effort**: XL
- **Risk**: HIGH
- **Depends on**: 025; 026 for shared capability contracts; 027 for tool
  registration (the indexing work may begin in parallel after schemas settle)
- **Blocks**: 029 and the retrieval-dependent parts of 033
- **Category**: data model, search, materials, NotebookLM product loop
- **Planned at**: 2026-08-22
- **Planning baseline**: plan 025 baseline SHA

### Implementation checkpoint (2026-08-22)

The current tree contains the owned study-project/source/version/chunk model,
FTS5 lexical retrieval, exact locator/citation resolution, inline-asset
normalization, deterministic hybrid primitives, optional configured embedding
and Qdrant adapters, and the project/API/Web surfaces. Core lexical, corpus and
project suites are green in the current targeted verification wave:

- `bun run --cwd apps/server test src/search`: **24 passed, 0 failed**;
- `bun run --cwd apps/server test src/routers/projects.test.ts`: **4 passed, 0
  failed**;
- the Web `src` suite, which includes the project/search surface tests: **805
  passed, 0 failed**.

Plan 032 additionally proves the shared placement cells currently wired in this
tree: 7 storage/corpus contract tests, 4 filesystem-provider tests, and 38
Core/Node adapter, adoption, deletion, lexical, citation, corpus and
conversation tests passed. Its last complete storage run also passed a
disposable Garage 2.3 conformance cell and cleanup. Those results justify only
the adapters exercised by that harness. They do **not** prove the missing
production Core↔Node pairing/relay transports, a live optional embedding
provider, or a fully deployed Node corpus migration path; see plan 032's own
checkpoint.

The final repository/migration/clean-clone gates remain inherited from plan 025. Do not promote this checkpoint to `DONE` from core lexical success alone.

## Scope

**In scope**: project/reference schemas, versioned source/chunk/asset registry,
exact locators, deterministic extraction, FTS5, optional embedding/vector
adapters, placement-neutral corpus contracts, indexing/repair jobs, owned
API/tools and a compact Web project/search surface.

**Out of scope**: generated answers/chat orchestration (029), agent mutations
(030), node transport (032), public sharing/collaboration, a mandatory vector
service and provider-specific storage as the canonical source.

## Current state

Avermate already owns most source types needed for a school corpus:

- `materialDocuments` plus OCR, web and media `materialArtifacts`;
- `studyDocuments` with revisioned Markdown and typed quiz/slides/LaTeX data;
- lecture recordings and transcripts;
- grades, subjects, years and planning objects;
- Moodle, OneDrive and Google Drive synchronized materials;
- private files and generated artifacts.

Search is currently a bounded `LIKE ... COLLATE NOCASE` over material text and
ready material artifacts in
`apps/server/src/routers/materials/documents.ts`. It does not provide BM25
ranking, snippets, a common corpus, semantic recall, page/section/time citations
or index-version management.

Material folders also are not NotebookLM projects. A project must collect
references without moving their source rows and must be able to include a grade,
subject, conversation or generated artifact alongside files.

## Product contract

### Study project

A **study project** is an owned workspace/notebook for one topic. It has:

- title, description, optional emoji/color;
- optional year and subject defaults;
- ordered references to any compatible Avermate source;
- optional user-authored project instructions and an explicit default context
  policy; these guide the assistant but can never grant scopes or lower risk;
- conversations and generated artifacts;
- exports and sharing only when separately authorized.

Adding a source to a project never moves, duplicates or grants new access to the
source. Removing it removes only the reference. Deleting a source leaves a
legible missing-reference tombstone until the project owner resolves it.

### Search

Search supports:

- all owned content for a year;
- one or more projects;
- explicit attached objects;
- subject/source-kind/date filters;
- lexical-only operation with no provider key;
- optional vector and reranker stages;
- precise, openable citations for every returned passage.

The search service returns evidence, not a generated answer.

## Schema

Exact names may follow repository conventions, but preserve these entities and
invariants.

### Projects and references

```ts
studyProjects {
  id, userId, title, description, yearId?, subjectId?,
  instructionsMarkdown?, contextPolicyVersion, contextPolicyJson?,
  emoji?, color?, revision, starredAt?, deletedAt?, createdAt, updatedAt
}

studyProjectItems {
  projectId,
  kind: "material" | "study-document" | "recording" | "grade" |
        "subject" | "conversation" | "artifact",
  referenceId,
  position,
  contextMode: "include" | "on-demand" | "exclude",
  label?,
  addedAt
}
```

Use a composite unique key on `(projectId, kind, referenceId)`. Validate
ownership and compatible year scope on every insert. Plan 028 reserves the
versioned `conversation` item kind but does not implement or index it. Plan 029
owns and must deliver the `ConversationIndexableSourceAdapter`, its lifecycle
hooks and its cross-user/retention tests before that item kind can be enabled in
production. Never create an invalid foreign key across polymorphic domains.

### Source registry and versions

```ts
contentSources {
  id, userId, yearId?, subjectId?,
  originKind, originId,
  currentVersionId?, status,
  placement: "core" | "node",
  placementRef?,
  createdAt, updatedAt
}

contentVersions {
  id, sourceId, versionKey, contentHash,
  extractorId, extractorVersion,
  mimeType?, language?, byteSize?,
  locatorSchemaVersion,
  metadataJson,
  createdAt
}

contentChunks {
  id, versionId, ordinal,
  text, normalizedText,
  tokenEstimate,
  contentHash,
  locatorJson,
  headingPathJson?,
  createdAt
}

contentAssets {
  id, versionId, fileId,
  role: "inline-image" | "page-image" | "thumbnail" | "attachment",
  locatorJson?, altText?, contentHash
}

contentVersionReferences {
  id, userId,
  ownerKind: "project-item" | "assistant-citation" | "conversation-summary" |
             "artifact-revision" | "export",
  ownerId,
  sourceVersionId,
  chunkId?,
  locatorSchemaVersion,
  locatorJson,
  quotedContentHash?, referenceKey,
  createdAt
}
```

Required constraints:

- unique `(userId, originKind, originId)` for the active source identity;
- unique `(sourceId, versionKey)` and `(versionId, ordinal)`;
- immutable content version and chunk rows;
- foreign keys from `contentVersionReferences.sourceVersionId` to
  `contentVersions.id` and from its optional `chunkId` to `contentChunks.id`,
  plus a constraint/application invariant proving the chunk belongs to that
  version;
- a deterministic `referenceKey = hash(sourceVersionId, chunkId-or-empty,
locatorSchemaVersion, canonical-locator-json)` and unique
  `(ownerKind, ownerId, referenceKey)`; do not rely on SQLite nullable/JSON
  equality for this invariant;
- current pointer changes atomically only after a complete index succeeds;
- deleting/replacing a source schedules GC only after no project item or durable
  `contentVersionReferences` edge targets that version;
- remote/node placement stores identifiers and hashes, never a fake local body.

### Locators and citations

Use a versioned discriminated union, at minimum:

```ts
type SourceLocatorV1 =
  | { kind: "pdf"; page: number; bbox?: [number, number, number, number] }
  | {
      kind: "markdown";
      headingPath: string[];
      startLine?: number;
      endLine?: number;
    }
  | { kind: "text"; startOffset: number; endOffset: number }
  | { kind: "audio" | "video"; startMs: number; endMs: number }
  | { kind: "slides"; slide: number; elementId?: string }
  | { kind: "spreadsheet"; sheet: string; range: string }
  | { kind: "grade"; gradeId: string; field?: string };
```

A `CitationRef` is a read DTO resolved from a durable
`contentVersionReferences` edge. It includes source/version/chunk IDs, display
title, locator, content hash and an ownership-checked open target. Display title,
signed/open URLs and renderer hints are computed at read time and are never the
canonical citation record. Never cite “PDF page 4” based on a guessed chunk
boundary or preserve citation reachability only inside an opaque JSON message
part.

### Corpus placement contracts

Define the contracts in the shared agent/corpus contract package before any
router depends directly on SQLite:

```ts
interface CorpusStore {
  getSource(identity: OwnedSourceIdentity): Promise<ContentSourceRecord | null>;
  stageVersion(input: StagedContentVersion): Promise<StagedVersionRef>;
  commitVersion(input: CommitVersionInput): Promise<CommittedVersionRef>;
  resolveVersion(ref: OwnedVersionRef): Promise<ContentVersionRecord>;
  listReferences(versionId: string): Promise<ContentVersionReference[]>;
  markVersionForGc(versionId: string): Promise<void>;
}

interface LexicalSearchBackend {
  capabilities(): Promise<LexicalSearchCapabilities>;
  upsertVersion(input: LexicalVersionInput): Promise<void>;
  removeVersion(versionId: string): Promise<void>;
  search(input: OwnedLexicalQuery): Promise<LexicalCandidate[]>;
  verify(): Promise<LexicalConsistencyReport>;
}

interface CitationResolver {
  resolve(input: OwnedCitationRef): Promise<ResolvedCitation>;
  open(input: OwnedCitationRef): Promise<OwnedOpenTarget>;
}
```

Plan 028 ships `CoreCorpusStore`, `SqliteFts5LexicalSearchBackend` and
`CoreCitationResolver`, plus a reusable placement conformance suite. The suite
must verify ownership filtering before body access, immutable versions, atomic
current-pointer swaps, locator round-trips, reference-aware GC, deterministic
pagination and lexical rebuild equivalence. Plan 032 supplies the node adapters,
but a node corpus placement is not a supported capability until its
`CorpusStore`, `LexicalSearchBackend` and `CitationResolver` all pass this exact
suite. Vector-only node retrieval is invalid: every supported placement must
provide the mandatory lexical backend.

## Extraction and chunking

### Canonical adapters

Add an `IndexableSourceAdapter` for each source domain. It resolves the owned
row, computes a stable version key and emits structured blocks with locators.

Initial adapters:

1. material inline text;
2. PDF originals, preserving the real page identity and deterministic native
   text extraction where a text layer exists;
3. ready OCR artifact, preserving OCR page boundaries;
4. static/dynamic web Markdown, preserving headings and source URLs;
5. YouTube/media transcript segments with timecodes;
6. lecture transcript segments;
7. study-document revisions and transcluded reference graph;
8. grades/subjects as compact structured facts, never as a fabricated course
   transcript.

The adapter registry exposes a versioned extension point for future source
kinds. Plan 029 delivers and registers `ConversationIndexableSourceAdapter`;
028 must not ship a placeholder adapter that reads assistant tables it does not
own.

If the current OCR/transcription persistence flattened page or segment
boundaries, extend the artifact metadata or add structured extraction rows.
Do not attempt to recover locators by splitting the final Markdown heuristically.

### PDF and multimodal indexing policy

The original file/page remains the source of truth. Do not make a paid full OCR
transcription a prerequisite for adding or semantically searching a PDF:

- for a native PDF, extract its existing text deterministically page by page for
  FTS and exact quotation;
- for a scan/handwritten PDF, register page locators immediately; OCR is a
  separately visible, cacheable job requested by the user/workflow or enabled by
  an explicit instance policy;
- when a configured embedding provider accepts PDF/images, embed each original
  page (or its faithful page rendering) directly, subject to that provider's
  current page/token limits;
- retrieval may therefore find an untranscribed scanned page through its visual
  vector, but a verbatim quote/text-only client must request OCR or present the
  original page to a capable model;
- after retrieval, prefer giving a multimodal model the exact owned page image or
  PDF page plus available native/OCR text, not an embedding vector or an
  approximate Markdown reconstruction;
- record whether evidence is native text, OCR, transcript or visual-only so the
  answer and citation UI can be honest.

Safe native/structured extraction for DOCX/ODT/PPTX/XLSX/ODS may ship here when
it uses bounded parsers and preserves paragraph, slide or cell/range locators.
Document-to-PDF, slide rasterization and spreadsheet rendering are explicitly
deferred to plan 031's isolated sandbox capability: API processes must not spawn
LibreOffice, Chromium or arbitrary document converters. Once that capability
exists, DOCX/ODT/PPTX can add deterministic page/slide renderings while retaining
native structure, and XLSX/ODS can add bounded sheet renderings while retaining
cell/range data for exact search and calculation. Never rely on a visual
representation alone for numeric spreadsheet reasoning, and keep the native
lexical index available if the renderer is absent.

### Chunk rules

- Prefer semantic boundaries: heading, paragraph, list, code block, equation,
  page or transcript segment.
- Keep a small configurable overlap only between adjacent text chunks.
- Never split inside a fenced code block, table row group or TeX display unless
  it exceeds a hard maximum.
- Record token estimates by tokenizer family without claiming exactness for all
  models.
- Bound individual chunk text and total chunks per source; oversize sources
  enter a clear partial/failed state.
- Hash normalized content so unchanged chunks can reuse embeddings.
- Treat extracted instructions as untrusted content metadata, not system policy.

### Inline images

For OCR images and vetted web images:

1. fetch/extract inside the guarded ingestion boundary;
2. validate magic bytes, decoded dimensions, pixel count and byte size;
3. decode and re-encode to a supported safe format, stripping metadata;
4. store privately as a `files` row and link via `contentAssets`;
5. put an opaque asset reference in Markdown, never a remote URL or filesystem
   path;
6. resolve to a short-lived owned URL at render time.

This closes the current gap where remote images are intentionally reduced to
alt text to prevent browser tracking and LAN requests.

## Lexical index: mandatory v1

Create an FTS5 virtual table over chunk text with external-content triggers or
an explicit transactional synchronizer. Store filter/ownership fields in normal
tables and join candidate row IDs back through `contentChunks → versions →
sources` before returning anything.

All routers, jobs and tools call `LexicalSearchBackend`; they do not import the
FTS table directly. The core implementation may optimize joins internally, but
the conformance behavior is the product contract for core and node placement.

Requirements:

- Unicode-aware normalized search and accent-insensitive query expansion where
  it improves French school terms without corrupting exact formula/code search;
- BM25 ranking;
- phrase, prefix and exact modes with safe query parsing;
- bounded highlighted snippets generated from owned chunk text;
- project/year/subject/kind filters applied before or during candidate
  selection, never after exposing rows;
- index consistency checker and full rebuild command;
- startup/migration feature probe that reports missing FTS5 honestly.

In `LexicalOnly`/no-key mode, report per-source coverage as
`searchable-native-text`, `searchable-ocr`, `metadata-and-locators-only` or
`unsupported`. A scanned page in `metadata-and-locators-only` may match its
title/file metadata and can be opened, but its unseen handwriting/body must not
match a content query and the UI must say “OCR required for page text search.”

Replace the current material `LIKE` route through a compatibility adapter only
after parity tests. Keep title/folder client filtering fast and separate from
content search.

## Embeddings and hybrid retrieval

### Provider abstraction

Define:

```ts
interface EmbeddingProvider {
  descriptor(): EmbeddingSpaceDescriptor;
  embedText(input: TextEmbeddingInput[]): Promise<EmbeddingVector[]>;
  embedMedia?(input: MediaEmbeddingInput[]): Promise<EmbeddingVector[]>;
}

interface VectorIndex {
  capabilities(): Promise<VectorCapabilities>;
  upsert(batch: IndexedVector[]): Promise<void>;
  remove(versionIds: string[]): Promise<void>;
  search(query: VectorQuery): Promise<VectorCandidate[]>;
}
```

An embedding space identity includes provider, exact model, dimension, distance
metric, normalization, modality and preprocessing version. Vectors from two
spaces never share an index. Changing model/dimension schedules re-embedding and
atomically switches the active space after completion.

### Initial implementations

- mandatory `LexicalOnly` mode;
- native libSQL vector search when a startup feature probe confirms support;
- a future node vector adapter through plan 032;
- no mandatory `sqlite-vec` dependency while it remains pre-v1; a separately
  reviewed adapter may be added later.

Gemini `gemini-embedding-2` may be an optional multimodal adapter. Keep it
provider-neutral in storage. Its PDF support is useful for page images and
charts, but it does not replace structured extraction: index one page or
meaningful media segment at a time and retain the locator/text path. Users must
opt into sending that content to Google, and a model change must never require
deleting the lexical index.

### Ranking

Default pipeline:

1. lexical BM25 candidates;
2. vector candidates when configured;
3. reciprocal-rank fusion with deterministic weights;
4. deduplicate adjacent chunks from the same source;
5. enforce diversity and context byte/token budget;
6. optional reranker behind `RerankProvider` only when configured;
7. return citations and scores with no LLM call.

Log aggregate latency/counts, not query text or result bodies. Preserve enough
debug metadata for the owning user to understand why a source was selected.

## Jobs and consistency

Add resumable jobs:

- `corpus.indexSource`;
- `corpus.removeVersion`;
- `corpus.embedChunks`;
- `corpus.rebuildFts`;
- `corpus.reembedSpace`;
- `corpus.verify`.

Each job uses source/version/content hashes for idempotency, emits stage and
progress events, renews its lease, observes cancellation and never changes the
current-version pointer before all mandatory stages succeed. Extend the job
schema with structured progress/events only through a reviewed migration; do
not overload the free-form `result` column with an unbounded log.

Source mutations enqueue indexing after their transaction commits. A periodic
repair job finds current domain revisions with absent/stale index versions.

## API, MCP and UI

### oRPC

Add owned procedures for:

- project create/get/list/update/star/trash/restore;
- add/remove/reorder project items;
- search with explicit scope and filters;
- source/chunk/citation resolution;
- index status/retry for owned sources;
- embedding configuration and privacy summary without returning keys.

### Tools

Register through plan 027:

- `projects.list/get/create/update`;
- `projects.addSource/removeSource`;
- `search.query`;
- `search.readCitation`;
- `search.indexStatus`.

Search tools are read-only and return bounded passages. Project mutations use
the normal broker risk/revision policy.

### Web

Add a project landing page and a compact source manager. Reuse the existing
materials tree/viewer rather than creating another file browser. Search results
show source, project, snippet and locator; selecting one opens the existing
viewer at the page/heading/time range.

No chat is required to validate this plan.

## Delivery sequence and gates

1. Add project/source/version/chunk/asset/reference schemas and additive
   migration, then define `CorpusStore`, `LexicalSearchBackend` and
   `CitationResolver`. **Gate**: empty and supported-upgrade
   `bun run db:migrate` exit 0; schema constraint tests reject cross-owner
   references, mutable versions, mismatched chunk/version edges and duplicate
   keys; the shared placement conformance suite is committed.
2. Implement the three core adapters, native source adapters and structured
   locator preservation. **Gate**:
   synthetic PDF/Markdown/transcript fixtures round-trip exact page, heading and
   time locators; no flattened-text locator inference occurs; the core adapters
   pass every placement conformance case.
3. Implement FTS5 synchronization/rebuild and lexical search. **Gate**: the
   committed lexical evaluation meets the numeric thresholds below, returns
   zero cross-user rows and works with all provider keys absent; scan-only
   fixtures remain explicitly `metadata-and-locators-only` rather than
   generating invented searchable text.
4. Add projects/search oRPC, registry tools and compact Web surfaces. **Gate**:
   server/Web contract tests open every result at its exact owned locator and
   moving/removing a project item never moves/deletes the source.
5. Add one optional embedding space/vector adapter behind capability/privacy
   settings. **Gate**: vector conformance, unchanged-chunk reuse, full reindex and
   atomic active-space switch pass; lexical results remain available throughout.
6. Add repair, cancellation, GC and compatibility switch from material `LIKE`.
   **Gate**: index rebuild equals incremental state, failed/cancelled indexing
   leaves the previous current version searchable, referenced historical
   versions survive GC and unreferenced versions are removed, then the full
   commands below all exit 0.

Plan 029 subsequently owns the conversation adapter delivery. Its gate must run
this plan's adapter and placement conformance tests before conversation content
is searchable or selectable as a project item; that dependency is not deferred
back to plan 028.

## Evaluation and tests

Create a synthetic bilingual school corpus containing:

- similar terms in different subjects;
- accents and abbreviations;
- formulas/code blocks/tables;
- a multi-page PDF with exact page answers;
- a transcript with exact time answers;
- malicious prompt-like instructions in source text;
- renamed, updated and deleted sources;
- two users with intentionally similar content.

Measure:

- lexical Recall@5 **≥ 0.85**, MRR **≥ 0.75** and Precision@5 **≥ 0.70** over a
  committed, human-labelled query set of at least 60 queries spanning every
  initially supported source adapter;
- hybrid Recall@5 no worse than lexical by more than **0.02** on any source kind
  and at least **+0.05** absolute on the designated semantic-query subset,
  without reducing overall Precision@5 below **0.70**;
- citation locator accuracy **100%** on deterministic fixtures: resolved
  source-version/chunk/page/heading/time/range equals the gold locator and opens
  the same immutable content hash;
- index update/rebuild equivalence;
- cross-user isolation;
- unchanged-chunk embedding reuse;
- no-provider lexical behavior, including **0** content hits from the unseen body
  of scan-only fixtures and **100%** truthful coverage-state labels.

The answer-quality metrics that depend on a model—supported-claim faithfulness,
citation coverage and abstention—are owned and gated numerically by plan 029.
Plan 028 provides the fixed evidence/query fixtures and gold citation mappings
that those tests consume; retrieval scores alone must never be relabelled as
answer faithfulness.

Commands:

```powershell
bun run --cwd apps/server test src/search
bun run --cwd apps/server test src/routers/projects.test.ts
bun run --cwd apps/web test src/components/projects src/components/assistant/assistant-citation-navigation.test.ts
bun run db:migrate
bun run format:check
bun run lint
bun run check-types
bun run test
bun run build
```

## Done criteria

- Projects can collect owned sources without moving them.
- Every current textual source type has immutable versions and locator-aware
  chunks.
- FTS5 search works with no AI/provider key for deterministically extractable
  text, opens exact citations, and labels un-OCRed scans honestly.
- Core corpus/search/citation implementations pass the shared placement suite;
  node support cannot be advertised until the same suite passes there.
- Embedding contracts are versioned, pluggable and fully rebuildable; their
  required multimodal/provider implementations and reranking stage complete in
  plan 036 rather than being left as an unimplemented option.
- Hybrid ranking is deterministic and evaluated against a committed corpus; the
  advanced lexical+dense+rerank production pipeline completes in plan 036.
- Inline assets are private stored objects, never tracking hotlinks.
- Index repair, cancellation, progress and GC are covered.
- Tool and Web surfaces enforce the same ownership rules.

## STOP conditions

- FTS/vector queries can return a candidate before ownership filtering.
- OCR/transcript locators would be guessed from flattened text.
- An embedding-provider change would overwrite/delete the only searchable copy.
- Remote images can load directly in a user's browser.
- A provider key or source body appears in logs/job results.
- Indexing runs synchronously inside a latency-sensitive mutation.
- Project references grant access to an otherwise unowned object.
- A node placement is enabled without a conforming lexical backend and citation
  resolver.
- An Office renderer executes in an API process rather than plan 031's isolated
  capability.

## Rollout and maintenance

Ship lexical projects/search first. Enable embeddings per user/instance only
after index status, costs and privacy are visible. Version every extractor,
chunker, locator and embedding space. Re-run the retrieval evaluation set on any
change to normalization, chunking, ranking or provider model.
