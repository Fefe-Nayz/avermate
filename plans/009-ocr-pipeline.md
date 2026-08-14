# Plan 009: Port the OCR pipeline — course documents to searchable markdown artifacts

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat 46c966b..HEAD -- apps/server/src/db/schema apps/server/src/routers apps/server/src/lib apps/server/src/jobs`
> REQUIRES plans 002 (jobs) and 005 (materials) DONE — verify their Done
> criteria first. 008 is soft (manual uploads get OCR too). On excerpt
> mismatch, STOP.

## Status

- **Priority**: P2 (wave 2)
- **Effort**: M-L
- **Risk**: MED (external paid API — cost controls are part of the spec)
- **Depends on**: plans/002, 005 (hard); 003 for MCP; 008 (soft)
- **Category**: direction
- **Planned at**: commit `46c966b`, 2026-08-14

## Why this matters

The NotebookLM half of the vision needs course PDFs as machine-readable text:
grounded agent answers, future full-text search, and fiche generation all
consume markdown, not scans. The prototype proved the flow on a year of real
CPGE material with Mistral's OCR API; this plan ports it as a plan-002 job
over plan-005 documents, fixing the four audited defects (absolute-path state
keys, re-upload-on-failure waste, dead `skip_patterns`, no spend ceiling) and
storing output as a first-class artifact row — the corpus that the search
roadmap item will index.

## Current state

### The prototype pipeline being ported (audited 2026-08-14)

`pipeline.py` (byte-identical in CoursePilot and the Coutens working copy):

- **API calls**: ① `POST https://api.mistral.ai/v1/files` (multipart,
  `purpose=ocr`) → `{id}`; ② `POST https://api.mistral.ai/v1/ocr` with
  `{"document": {"file_id": ...}, "model": "<ocr_model>", "include_image_base64": false}`
  → `{pages: [{index, markdown}, ...]}`. Auth `Bearer $MISTRAL_API_KEY`
  (env-only). Model default `mistral-ocr-latest`.
- **Output format**: pages concatenated as `<!-- Page {index} -->\n{markdown}`
  blocks (`:337-347`).
- **Retry helper worth porting as-is**: exponential backoff 1s→20s cap,
  retries on 429/500/502/503/504, max 6 attempts (`:241-278`).
- **Defects to fix in the port** (verified):
  1. State keyed on ABSOLUTE local paths (`:157-221`) — moving the workspace
     re-billed every file. Here: key on the immutable `files.id` (plan 001
     rows are write-once; a re-synced/re-uploaded file is a NEW row, so no
     content hash is needed).
  2. `mark_uploaded` ran BEFORE OCR (`:423`): an OCR failure left
     `processed=false` and the next run re-uploaded (re-billed) the same file;
     the stored `file_id` was never reused.
  3. `config.pipeline.skip_patterns` (`["*_c.*", "*_corrige.*"]`) parsed and
     NEVER read — the maintainer paid to OCR correction files for months.
  4. `parallel_uploads` parsed, `ThreadPoolExecutor` imported, loop
     sequential — dead config. Concurrency now comes from the job runner.
  5. No page cap, no spend ceiling, no pre-run cost estimate.

### Avermate side

- Plan 005 delivered `material_documents` (each references a `files` row) and
  reserved `metaJson` (typed JSON + version). Plan 002 delivered
  `registerJobHandler` / `enqueueJob` (idempotency `(userId, kind, key)`),
  and the `jobs` router for polling.
- Env pattern: optional key + `DISABLE_*` escape hatch
  (`apps/server/src/lib/env.ts:46-53`).
- Typed-JSON convention: `text({ mode: "json" }).$type<T>()` + version int +
  derived reference table where queried (`db/schema/app.ts:507-545`).
- No markdown renderer exists in `apps/web` (verified — no remark/rehype/
  markdown dep). Plan 010 adds one; this plan's viewer is deliberately plain.

## Commands you will need

| Purpose | Command | Expected |
|---------|---------|----------|
| Migration | `bun run db:generate` && `bun run db:migrate` | exit 0 |
| Tests | `bun run --cwd apps/server test` | exit 0 |
| Full gate | `bun run format:check && bun run lint && bun run check-types && bun run test && bun run build` | exit 0 |

## Scope

**In scope**:
- `apps/server/src/db/schema/artifacts.ts` (create: `materialArtifacts`) + export + migration
- `apps/server/src/lib/env.ts` + `.env.example` (`MISTRAL_API_KEY`, `DISABLE_OCR`, `OCR_MAX_PAGES_PER_DOCUMENT`)
- `apps/server/src/lib/ocr.ts` (create: Mistral client + retry helper)
- `apps/server/src/jobs/handlers.ts` (register `ocr.document`)
- `apps/server/src/routers/materials/documents.ts` (add `transcribe`, `transcript`, `transcribeFolder` procedures) — extends plan 005's file
- `apps/server/src/lib/ocr.test.ts`, extend `apps/server/src/routers/materials.test.ts`
- MCP (if 003 DONE): extend the materials surface with `materials.documents.transcript` (read) + `materials.documents.transcribe` (write)
- `apps/web/src/components/materials/**` (transcript tab + transcribe actions) + messages

**Out of scope**:
- Rich markdown rendering (KaTeX, mermaid) — plan 010 brings the renderer;
  this plan's transcript view is a `<pre class="whitespace-pre-wrap">`.
- Full-text search over artifacts (roadmap item; this plan produces the
  corpus and nothing else).
- OCR of grade-copy attachments (plan 006's entity) — later, same handler,
  different trigger; do not wire it now.
- Per-user BYOK — the ADR (plan 007) sets operator-key policy for wave 2.

## Git workflow

- Branch: `advisor/009-ocr-pipeline`; conventional commits
  (`feat(server): mistral ocr artifacts over materials`).
- Do NOT push or open a PR unless instructed.

## Steps

### Step 1: Artifact schema

`apps/server/src/db/schema/artifacts.ts`:

```ts
export type MaterialArtifactKind = "ocr-markdown";     // later: "transcript" reuse decided in plan 012
export type MaterialArtifactStatus = "pending" | "ready" | "failed";

export const materialArtifacts = sqliteTable("material_artifacts", {
  id: text().notNull().primaryKey().$defaultFn(() => newId("mart")),
  documentId: text().notNull().references(() => materialDocuments.id, { onDelete: "cascade", onUpdate: "cascade" }),
  kind: text().$type<MaterialArtifactKind>().notNull(),
  status: text().$type<MaterialArtifactStatus>().notNull().default("pending"),
  /** The markdown itself. Capped at 2 MiB by the handler; larger outputs fail with a clear error. */
  content: text(),
  metaVersion: integer().notNull().default(1),
  metaJson: text({ mode: "json" }).$type<OcrMetaV1>(),   // { model, pageCount, providerFileId, durationMs }
  error: text(),
  userId: owner(),
  ...timestamps,
}, (t) => [
  uniqueIndex("material_artifacts_doc_kind_unique").on(t.documentId, t.kind),
  index("material_artifacts_user_idx").on(t.userId),
]);
```

**Verify**: migration + `bun run check-types` exit 0.

### Step 2: Env + Mistral client

Add to `env.ts` beside the other optional integrations: `MISTRAL_API_KEY`
(optional), `DISABLE_OCR: bool`, `OCR_MAX_PAGES_PER_DOCUMENT`
(`z.coerce.number().int().positive().default(300)`). Document all three in
`.env.example`.

`apps/server/src/lib/ocr.ts`: `ocrEnabled()`, and
`runMistralOcr(file: { blob: Blob; name: string }): Promise<{ markdown: string; pageCount: number; providerFileId: string }>`
implementing the two calls + the ported retry helper (backoff 1s→20s, retry
on 429/5xx, 6 attempts) and the `<!-- Page N -->` concatenation format
(preserve it exactly — the prototype's processed corpus uses it, and future
importers may want equality). Enforce `OCR_MAX_PAGES_PER_DOCUMENT` from the
response: over-cap → throw a descriptive error (artifact `failed`, no
partial content).

**Verify**: `ocr.test.ts` with a stubbed `fetch`: happy path (two calls, page
concat), 429-then-success retry, page-cap rejection, disabled-state error.

### Step 3: The `ocr.document` job

Register `ocr.document` with payload `{ documentId }`, idempotency key
`documentId` (a document is OCR'd once; re-running after failure is allowed
because plan 002's `failJob` releases the row — a NEW enqueue with the same
key replays only a SUCCEEDED result). Handler:

1. Load document + its `files` row (ownership already proven at enqueue).
2. Upsert the artifact row to `pending`.
3. Fetch the stored file bytes from `files.url`, call `runMistralOcr`.
4. Write `content` (≤ 2 MiB — else fail with "transcript too large"),
   `metaJson`, `status: "ready"`. On error: `status: "failed"`, `error` set,
   rethrow so plan 002's retry/backoff applies (provider hiccups) — the
   Mistral upload happens once per attempt; unlike the prototype, nothing
   marks success before OCR completes.

### Step 4: Router procedures + skip patterns

In `routers/materials/documents.ts` add:

- `transcribe({ documentId })` — `requireMaterialDocument`, `badRequest` when
  OCR disabled, PDF/image MIME check, then
  `enqueueJob("ocr.document", ...)` → `{ jobId, artifactStatus }`.
- `transcript({ documentId })` — returns `{ status, content, meta }` (null
  content unless `ready`). For `sourceType: "text"` documents (plan 005),
  return `textContent` directly with `status: "ready"` — pasted text IS its
  own transcript, no job involved. For `sourceType: "link"`, return the
  plan-013 ingestion artifact when present (same read path — agents never
  care how the markdown was obtained).
- `transcribeFolder({ folderId, skipPatterns?: string[] })` — resolves the
  folder subtree's un-transcribed PDF/image documents, applies
  `skipPatterns` as case-insensitive globs on the document title (default
  `["*_c.*", "*_corrige.*"]` — the prototype's configured intent, finally
  honored; document the default in the input schema description), and returns
  `{ candidates: n, enqueued: n, skipped: n, jobIds }`. The WEB UI shows
  `candidates`/`skipped` BEFORE confirming (list first via a `dryRun: true`
  flag on the same procedure) — the pre-run estimate the prototype lacked.

**Verify**: extended `materials.test.ts`: transcribe on a non-PDF rejected;
disabled-state rejected; dryRun counts respect skip patterns; enqueue is
idempotent per document.

### Step 5: Web + MCP

Web (`components/materials/`): a "Transcription" tab on the document view —
status chip, transcribe button, `<pre class="whitespace-pre-wrap">` content
once ready (plan 010 upgrades rendering; leave a code comment saying so), and
on folders a "Transcrire le dossier" action showing the dryRun counts in the
confirm dialog. Poll `jobs.get` while pending. en/fr messages.

MCP (if 003 DONE): `materials.documents.transcript` (read scope — agents
consume the corpus) and `materials.documents.transcribe` (write scope).
Harness enumerations + `docs/mcp.md` updated.

**Verify**: `bun run --cwd apps/server test` exit 0; manual with a real key:
one small PDF transcribes end to end; without a key: clean disabled states.

### Step 6: Full gate

**Verify**: all root gates exit 0.

## Test plan

Steps 2/4: stubbed-fetch client tests, router validation tests, dryRun/skip
pattern tests, idempotent enqueue — all on the in-memory bootstrap
(`integrity.integration.test.ts:8-130`), zero network.

## Done criteria

- [ ] `material_artifacts` migration applies; unique `(documentId, kind)` holds
- [ ] `MISTRAL_API_KEY` / `DISABLE_OCR` / `OCR_MAX_PAGES_PER_DOCUMENT` declared in `env.ts` + `.env.example`
- [ ] Retry, page-cap, and `<!-- Page N -->` format covered by `ocr.test.ts`
- [ ] `transcribeFolder` dryRun returns counts and honors skip patterns (test-proven)
- [ ] No success-before-OCR state write exists (the prototype's re-billing defect is structurally gone — artifact goes `ready` only after content is written)
- [ ] All root gates exit 0; `git status` clean outside scope; `plans/README.md` updated

## STOP conditions

- Plans 002/005 not actually DONE.
- Mistral's OCR API shape differs from the two-call contract above (capture
  the live response shape with the operator's key and report — do not guess a
  new contract).
- Artifacts regularly exceed 2 MiB on real course PDFs — report; the fix is
  object-storage offload, a design change, not a cap bump.
- `files.url` fetch fails for stored objects (storage transport drift from
  plan 005's decision).

## Maintenance notes

- The search roadmap item indexes `materialArtifacts.content` (FTS5) — keep
  the content column plain markdown, no HTML.
- Plan 012 (transcription) decides whether lecture transcripts reuse this
  table (`kind: "transcript"` + segments in meta) or their own — its plan
  owns that call; the `kind` union is the seam.
- When per-user BYOK arrives (post-ADR trigger), `lib/ocr.ts` gains a
  per-user key lookup before the env fallback; nothing else changes.
- Reviewer attention: the artifact status machine (pending→ready/failed only
  after content write), and that `transcribeFolder` cannot enqueue documents
  the user does not own (subtree resolution must filter by `userId`).
