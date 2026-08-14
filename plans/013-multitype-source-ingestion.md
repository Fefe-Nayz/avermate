# Plan 013: Ingest non-file sources — web links to readable markdown (NotebookLM-style source types)

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat 46c966b..HEAD -- apps/server/src/db/schema apps/server/src/routers apps/server/src/lib apps/server/src/jobs`
> REQUIRES plans 002 (jobs), 005 (materials with `sourceType`) and 009
> (`materialArtifacts`) DONE — verify their Done criteria first. On excerpt
> mismatch, STOP.

## Status

- **Priority**: P2 (wave 2)
- **Effort**: M
- **Risk**: MED (server-side fetching of user URLs — SSRF surface; mitigations are part of the spec)
- **Depends on**: plans/002, 005, 009 (hard); 003 for MCP
- **Category**: direction
- **Planned at**: commit `46c966b`, 2026-08-14

## Why this matters

NotebookLM's power is that a "source" is anything — PDFs, pasted text, web
pages, videos — and the maintainer wants the same breadth. Plan 005 made
`material_documents` polymorphic (`sourceType: "file" | "link" | "text"`) and
plan 009 gave every document one readable-markdown artifact path. This plan
closes the loop for `"link"` sources: fetch the page server-side, extract the
readable article, convert to markdown, store it as the document's artifact —
so a Wikipedia page or a teacher's blog post becomes agent-readable course
content exactly like an OCR'd PDF. YouTube and other video sources are
explicitly deferred to the roadmap (transcript access is a moving target);
the artifact seam they will use is the one built here.

## Current state

- Plan 005 (as amended): `material_documents.sourceType` with `"link"` rows
  created by `materials.documents.createLink({ url })` — stored, never
  fetched. Invariant: link ⇒ `sourceUrl` set, `fileId`/`textContent` null.
- Plan 009: `materialArtifacts` — unique `(documentId, kind)`, kinds include
  `"ocr-markdown"`; `transcript` read procedure already returns "the plan-013
  ingestion artifact when present". This plan adds kind `"web-markdown"` to
  the union.
- Plan 002: job substrate (`registerJobHandler`, idempotent enqueue, retry).
- No HTML-parsing/readability/markdown-conversion dependency exists in
  `apps/server` (verify: `grep -n "readability\|turndown\|linkedom\|happy-dom" apps/server/package.json`
  → no matches expected). Step 1 pins the choices.
- Env pattern for switches: `lib/env.ts:46-53`.

## Commands you will need

| Purpose | Command | Expected |
|---------|---------|----------|
| Tests | `bun run --cwd apps/server test` | exit 0 |
| Full gate | `bun run format:check && bun run lint && bun run check-types && bun run test && bun run build` | exit 0 |

## Scope

**In scope**:
- `apps/server/package.json` (Step 1 pinned deps only)
- `apps/server/src/lib/ingest.ts` (create: fetch guard + extract + convert)
- `apps/server/src/jobs/handlers.ts` (register `ingest.link`)
- `apps/server/src/routers/materials/documents.ts` (wire `createLink` to enqueue; `reingest` procedure)
- `apps/server/src/db/schema/artifacts.ts` (widen the kind union — type-only)
- Tests: `apps/server/src/lib/ingest.test.ts` + extend `materials.test.ts`
- Web: link-source card states (pending/ready/failed + "Réessayer") in `apps/web/src/components/materials/**`
- MCP: nothing new — plan 009's `materials.documents.transcript` already serves the artifact

**Out of scope**:
- YouTube / video transcripts (roadmap; revisit when a stable official path
  exists — do not ship an innertube scraper).
- Paywalled/authenticated pages, JS-rendered SPAs (no headless browser —
  static HTML only; failures surface honestly as `failed` with a reason).
- Periodic re-fetch of changed pages (manual `reingest` only).
- PDFs served from URLs — if the fetched `Content-Type` is `application/pdf`,
  the job stores it via `storeFile` and flips the document to
  `sourceType:"file"` so plan 009's OCR path owns it (one branch, in scope);
  every other binary type fails cleanly.

## Git workflow

- Branch: `advisor/013-link-ingestion`; conventional commit
  (`feat(server): web link sources ingest to markdown`).
- Do NOT push or open a PR unless instructed.

## Steps

### Step 1: Pin the extraction stack

Add to `apps/server`: `@mozilla/readability` + `linkedom` (DOM for it to run
against — lighter than happy-dom for parse-only) + `turndown` (+
`turndown-plugin-gfm` for tables). Record in the commit message: chosen for
zero-headless-browser extraction; if `linkedom` proves incompatible with
Readability's expectations under Bun, `happy-dom` is the sanctioned fallback
— note the swap in the plan status row, don't improvise further.

**Verify**: `bun install` exit 0; `bun run check-types` exit 0.

### Step 2: `lib/ingest.ts` — guarded fetch + extraction

- `assertPublicHttpUrl(url)`: protocol http/https only; resolve DNS and
  reject private/reserved ranges (10/8, 172.16/12, 192.168/16, 127/8,
  169.254/16, ::1, fc00::/7) — the SSRF guard, applied BEFORE fetch and on
  every redirect hop (`redirect: "manual"`, max 5 hops, re-assert each
  Location). This server also hosts private services in deployment; a
  user-supplied URL must never reach them.
- `fetchArticle(url)`: 15s timeout, 5 MiB response cap (stream-count and
  abort), `Accept: text/html`, honest UA (`avermate-ingest/1.0`); returns
  `{ html, finalUrl, contentType }`.
- `extractMarkdown(html, finalUrl)`: Readability on a linkedom document →
  `{ title, byline, content }`; turndown+gfm → markdown; prepend a one-line
  provenance header (`> Source : <finalUrl> — capturé le <date>`); cap
  2 MiB like OCR artifacts.

**Verify**: `ingest.test.ts` — pure-function tests with fixture HTML (an
article extracts title+body; a nav-heavy page still yields main content), and
guard tests: `http://127.0.0.1/x`, `http://192.168.1.10/x`, a redirect
hopping to a private address, an `ftp://` URL — all rejected; oversize body
aborted. No network in tests (inject fetch/DNS stubs).

### Step 3: The `ingest.link` job + router wiring

Register `ingest.link` (payload `{ documentId }`, idempotency `documentId` —
same replay semantics as `ocr.document`): guard → fetch → (PDF branch: store
file, flip `sourceType`, enqueue `ocr.document` instead, done) → extract →
upsert `materialArtifacts` row `kind: "web-markdown"`, `status: "ready"`,
meta `{ finalUrl, fetchedAt, title }`; update the document's title when it
was URL-derived. Failures: artifact `failed` + human-readable `error`
("page inaccessible", "contenu non extractible"), rethrow for plan-002 retry
on network-shaped errors only (4xx are terminal).

Wire `materials.documents.createLink` (plan 005) to enqueue this job after
insert, and add `reingest({ documentId })` (link sources only, re-enqueues
with a fresh idempotency key `documentId + date`).

**Verify**: extended `materials.test.ts` with stubbed fetch: happy path
(artifact ready, title improved), terminal 404 (failed, no retry), PDF
content-type flips to file+OCR enqueue, `reingest` on a non-link rejected.

### Step 4: Web states

Link cards in the materials browser show pending/ready/failed chips (reuse
plan 009's transcription chip components if present), the provenance line,
and a retry action. `transcript` tab renders the `web-markdown` artifact
through the same viewer as OCR output. en/fr messages.

**Verify**: `bun run lint && bun run check-types` exit 0; manual: paste a
public article URL → readable markdown appears; paste an intranet IP → clean
rejection.

### Step 5: Full gate

**Verify**: all root gates exit 0.

## Test plan

Step 2/3 lists (≥10 cases). The SSRF guard tests are non-negotiable — they
are the security spec of this plan. Bootstrap:
`integrity.integration.test.ts:8-130`; zero live network.

## Done criteria

- [ ] `"web-markdown"` in the artifact kind union; ingest job registered
- [ ] SSRF guard test-proven (private ranges, redirect hops, protocol, size cap)
- [ ] `createLink` → auto-ingest → transcript readable via the plan-009 read path (test-proven)
- [ ] PDF-URL branch flips to file + OCR (test-proven)
- [ ] Only the pinned deps added (`git diff apps/server/package.json`)
- [ ] All root gates exit 0; `git status` clean outside scope; `plans/README.md` updated

## STOP conditions

- Plans 002/005/009 not actually DONE.
- Readability cannot run against linkedom under the pinned Bun (try the
  sanctioned happy-dom fallback once; if that also fails, STOP with the
  error).
- Bun's fetch cannot do manual-redirect + per-hop re-validation (verify
  early; if `redirect: "manual"` is unsupported, STOP — do not ship without
  the hop guard).
- You find yourself adding a headless browser — that is a different plan;
  STOP.

## Maintenance notes

- YouTube/video sources: revisit when an official transcript path is viable;
  they will be `sourceType:"link"` rows whose ingestion handler branches on
  the host — the artifact seam is ready.
- Studio-style OUTPUT types (flashcards/quiz decks with spaced repetition,
  study guides, audio overviews) are the other half of "plein de types de
  trucs" — they are documents, not sources: widen `studyDocuments.kind`
  (plan 010) with structured `metaJson` content per kind, and give practice
  UX its own plan (listed in the roadmap).
- Reviewer attention: the SSRF guard's redirect loop, the response-size
  abort, and that provenance headers make agent citations traceable.
