# Plan 017: Studio outputs — mind maps and slide decks as first-class document kinds (PPTX export included)

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat 46c966b..HEAD -- apps/server/src/db/schema/documents.ts apps/server/src/routers/documents.ts apps/web/src/components/documents apps/server/src/jobs`
> REQUIRES plans 010 (documents domain) and 002 (jobs, for the PPTX export)
> DONE — verify their Done criteria first; 011 (MCP authoring) is a soft
> dependency that makes agents able to produce these kinds. On excerpt
> mismatch, STOP.

## Status

- **Priority**: P3 (wave 2 extension)
- **Effort**: L
- **Risk**: MED
- **Depends on**: plans/010 (hard), 002 (hard for export), 011 (soft), 003 (soft)
- **Category**: direction
- **Planned at**: commit `46c966b`, 2026-08-14

## Why this matters

NotebookLM's studio is the other half of the vision: sources go in, and
MANY kinds of study artifacts come out — the maintainer explicitly wants
"cartes mentales, des vidéos, des powerpoints, des podcasts". Plan 010 built
one kind (markdown fiches). This plan turns `studyDocuments.kind` into a real
extension mechanism and ships the two kinds that need NO AI inference and NO
media toolchain — **mind maps** (structured tree, client-rendered,
agent-authorable) and **slide decks** (markdown slides + a real `.pptx`
export job) — while podcasts (TTS inference) and videos (Manim toolchain)
are declared as gated future kinds whose cost model belongs to plan 019.

## Current state

- Plan 010 delivered `studyDocuments` with
  `kind: "fiche" | "note"`, `bodyMarkdown`, `revision` fence,
  `metaVersion`/`metaJson` typed-JSON (+ `studyDocumentReferences`), the
  CodeMirror editor + `react-markdown` reader, and print export. Its
  maintenance notes name `export.documentPptx` (pptxgenjs) as the deferred
  seam — this plan builds it.
- Plan 002: job substrate (`registerJobHandler`, idempotent enqueue); plan
  001: `files` entity (`storeFile`) — the PPTX artifact is stored as a file
  row (purpose added here).
- Plan 011 (if DONE): `documents.create/update` MCP tools pass `kind` and
  body/meta through to the oRPC procedures — tool descriptions must then
  document the per-kind content contract added here.
- The deleted prototype (`Fichr@prototype`) vendored `@xyflow/react` in its
  webapp — prior art for graph rendering, but NOT a dependency here yet
  (decision in Step 3).
- Conventions: typed-JSON + version + validation in the router
  (`badRequest`), feature-scoped invalidation, en/fr messages together,
  colocated pure-module tests (`components/cards/` pattern).

## Commands you will need

| Purpose | Command | Expected |
|---------|---------|----------|
| Tests | `bun run --cwd apps/server test` | exit 0 |
| Full gate | `bun run format:check && bun run lint && bun run check-types && bun run test && bun run build` | exit 0 |

## Scope

**In scope**:
- `apps/server/src/db/schema/documents.ts` — widen `StudyDocumentKind` with `"mindmap" | "slides"`; define `MindmapContentV1` and `SlidesMetaV1` types (type-only change + validation)
- `apps/server/src/routers/documents.ts` — per-kind content validation on create/update; `exportPptx({ documentId })` procedure
- `apps/server/src/jobs/handlers.ts` — register `export.documentPptx`
- `apps/server/package.json` — `pptxgenjs` (Step 4 only dep)
- `apps/server/src/lib/storage.ts` — purpose `"document-export"` (20 MiB, `["application/vnd.openxmlformats-officedocument.presentationml.presentation"]`)
- `apps/web/package.json` — the Step 3 renderer dep ONLY
- `apps/web/src/components/documents/**` — mindmap editor/renderer, slides editor mode + present view, export button
- Tests: extend `documents.test.ts`; new colocated component-model tests
- `docs/mcp.md` + plan-011 tool descriptions IF 011 is DONE (document the per-kind contracts)

**Out of scope**:
- **Podcasts / audio overviews** (needs TTS inference — cost model is plan
  019's; the kind union comment names it as reserved).
- **Videos** (Manim/ffmpeg toolchain — stays the local Python companion; the
  prototype's cue-timeline logic is portable the day a server video feature
  is funded).
- AI *generation* of these documents server-side — agents generate through
  MCP (plan 011); the server only stores, validates, renders, exports.
- Collaborative editing, slide themes/branding, image embedding in slides
  (v2; markdown text + code + math only).
- PDF export of slides (browser print already covers it via plan 010).

## Git workflow

- Branch: `advisor/017-studio-outputs`; conventional commits
  (`feat(server): mindmap and slides document kinds`, `feat(server): pptx export job`, `feat(web): mindmap and slides studio`).
- Do NOT push or open a PR unless instructed.

## Steps

### Step 1: Kind contracts (server)

Widen the union and define, next to it:

```ts
export interface MindmapNodeV1 { id: string; label: string; children?: MindmapNodeV1[]; note?: string }
export interface MindmapContentV1 { version: 1; root: MindmapNodeV1 }
export interface SlidesMetaV1 { version: 1; /** slide separator convention marker only */ }
```

Contract, enforced in `create`/`update` with `badRequest`:
- `"mindmap"`: `bodyMarkdown` MUST be empty; `metaJson` holds
  `MindmapContentV1`; validate depth ≤ 8, nodes ≤ 500, labels ≤ 120 chars,
  unique ids (pure validator function, unit-tested).
- `"slides"`: content IS `bodyMarkdown`, slides separated by `\n---\n` (the
  standard markdown-deck convention); `metaJson` is `SlidesMetaV1`; ≤ 100
  slides (count separators).
- `"fiche" | "note"`: unchanged.
The `revision` fence applies to all kinds unchanged.

**Verify**: extended `documents.test.ts`: valid/invalid mindmap payloads
(depth, count, dup ids), slide-count cap, kind-mismatch rejections
(`bodyMarkdown` on a mindmap). `bun run --cwd apps/server test` exit 0.

### Step 2: Slides on the web

Reuse plan 010's editor for `kind:"slides"` with two additions: the preview
pane renders per-slide (split `bodyMarkdown` on the separator, paginated
cards), and a **Present** mode — a full-screen route rendering one slide at a
time (keyboard ←/→, Escape; `react-markdown` + KaTeX already present; slide
counter). Colocate the deck-splitting model as a pure tested module.

**Verify**: model tests (splitting, math inside a slide, `---` inside code
fences NOT treated as separator — use a fence-aware splitter, test it);
manual: author 3 slides, present them.

### Step 3: Mind map on the web

Renderer decision, pinned here: add **`@xyflow/react`** to `apps/web`
(prototype-vetted, MIT, actively maintained) and render the tree with a
deterministic layout computed in a pure module (simple layered
tidy-tree layout: depth → x, sibling order → y; no physics). Editing v1 is
STRUCTURED, not freeform: an outline panel (indented list editor —
add/rename/indent/outdent/delete, keyboard-first) drives the tree; the
canvas is the visualization (pan/zoom from xyflow, no drag-editing). This
keeps agent output (JSON) and human editing (outline) in one model and
avoids freeform-canvas scope. Autosave through the same revision-fenced
`documents.update`.

**Verify**: layout + outline-operations pure-module tests; manual: build a
10-node map, indent/outdent, reload, intact; `bun run build` exit 0 (lazy-load
xyflow on the mindmap route via `next/dynamic` if the shared bundle grows).

### Step 4: PPTX export job

`bun add pptxgenjs` in `apps/server`. Register `export.documentPptx`
(payload `{ documentId }`, idempotency `documentId + revision` — a new
revision exports fresh, same revision replays): load a `"slides"` document,
map each slide → one 16:9 pptxgenjs slide (first `#`/`##` line becomes the
title, remaining markdown rendered as plain text lines with basic bullet
mapping — document the fidelity limits in the module header: no math
rendering in PPTX v1, code as monospace text), write the buffer via
`storeFile({ purpose: "document-export" })`, return `{ fileId, url }` in the
job result. Procedure `documents.exportPptx` enqueues (slides kind only) and
returns `jobId`; the web export menu polls `jobs.get` then offers the file
URL. If plan 011 is DONE, add the `documents.exportPptx` MCP tool
(write scope) and update harness enumerations + `docs/mcp.md`.

**Verify**: job test with a 3-slide fixture (mock nothing — pptxgenjs runs
in-process; assert a non-empty buffer was stored and the file row exists);
manual: export, open the `.pptx` in a viewer.

### Step 5: Full gate

**Verify**: all root gates exit 0; `bunx expo export --platform all` exit 0
(mobile renders mindmap/slides read-only as outline/text lists v1 — reuse
plan 010's mobile reader approach; note it in the screens).

## Test plan

Server: kind-contract validations + export job (Step 1/4). Web: fence-aware
deck splitter, tidy-tree layout, outline operations (Step 2/3) — all pure
colocated modules per the repo pattern. Manual: present mode, PPTX opens.

## Done criteria

- [ ] `"mindmap"`/`"slides"` kinds validated server-side (test-proven caps and contracts)
- [ ] Slides: per-slide preview + Present mode; fence-aware splitting test-proven
- [ ] Mindmap: outline-driven editor + xyflow canvas; layout deterministic (test-proven)
- [ ] `export.documentPptx` produces a stored `.pptx` file row; idempotent per revision
- [ ] Only `@xyflow/react` (web) and `pptxgenjs` (server) added (`git diff` both package.json)
- [ ] MCP tool + docs updated IF 011 was DONE (else noted in README status)
- [ ] All root gates + Expo export exit 0; `git status` clean outside scope; `plans/README.md` updated

## STOP conditions

- Plan 010's kind/metaJson model differs from the excerpts (drift).
- `pptxgenjs` cannot produce a buffer under Bun (runtime incompatibility) —
  report; do not swap libraries unilaterally.
- `@xyflow/react` conflicts with React 19 at install/build — report versions.
- You find yourself building freeform canvas editing or slide theming — v2;
  STOP the gold-plating.

## Maintenance notes

- Reserved future kinds (named in the union comment, built only when plan
  019 settles their cost model): `"podcast"` (TTS overview — inference),
  `"video"` (Manim companion), `"quiz"`/`"flashcards"` (SRS studio — the
  roadmap's practice UX). Each follows this plan's recipe: typed content +
  validator + renderer + optional export job.
- Agent authoring: plan 011's prompt catalog should gain
  `mindmap-from-chapter` once this lands (same shape as
  `fiche-from-chapter`, producing `MindmapContentV1`).
- Reviewer attention: the fence-aware slide splitter (classic footgun), the
  mindmap validator caps, and PPTX fidelity limits being documented rather
  than half-implemented.
