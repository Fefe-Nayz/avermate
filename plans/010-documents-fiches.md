# Plan 010: Build the documents/fiches domain — markdown editor, versioned model, print export

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat 46c966b..HEAD -- apps/server/src/db/schema apps/server/src/routers apps/web/src/app apps/web/src/lib/nav.ts docs/`
> REQUIRES plan 001 DONE is NOT needed here (documents are text, not files);
> REQUIRES plan 005 DONE for folder/subject attachment. 002 is soft (exports).
> On excerpt mismatch, STOP.

## Status

- **Priority**: P2 (wave 2)
- **Effort**: L
- **Risk**: MED
- **Depends on**: plans/005 (hard — folders/subjects to attach to); 002 (soft — deferred export jobs); 003+009 (soft — plan 011 wires MCP/prompts on top)
- **Category**: direction
- **Planned at**: commit `46c966b`, 2026-08-14

## Why this matters

Fiches de révision are the produced half of the NotebookLM vision: the student
(or an agent, via plan 011) turns course materials into their own documents,
inside the app, with all context attached. Nothing exists today — `apps/web`
has zero rich-text/markdown/PDF dependencies (verified) — so this plan picks
the stack, defines the storage model on the repo's own versioned-JSON
convention, and ships editor + reader + a print-based PDF export. Server-side
PDF/PPTX exports are seamed as job kinds but deliberately deferred: browser
print delivers a usable fiche PDF with zero infrastructure.

## Current state

- **No editor/renderer deps**: `apps/web/package.json` has no
  tiptap/prosemirror/lexical/slate/codemirror, no remark/rehype/mdx/markdown,
  no pdfjs/react-pdf (audited + re-verified by grep). Everything below is a
  new-dependency decision — pinned in Step 1 so the executor does not choose.
- **Storage convention to follow** (`db/schema/app.ts:507-545`): rich
  entities store `text({ mode: "json" }).$type<T>()` + an explicit version
  int, and every field needed by delete/ownership/list queries is mirrored
  into a derived reference table (`dashboardCards` + `dashboardCardReferences`
  are the exemplar; `docs/widgets.md` writes the convention up).
- **Optimistic concurrency precedent**: `feedback.revision` (int bumped on
  triage writes) — reuse the shape for editor autosave conflicts.
- Plan 005 provides `material_folders` (tree) + `material_documents` and the
  `/materials` web space; documents/fiches live in the SAME tree (a fiche
  sits next to the PDFs it summarizes).
- Conventions: schema spreads (`app.ts:24-36`), `newId`, `requireX` ownership
  helpers, `goals.ts` router shape, `routers/index.ts` registration,
  feature-scoped read models (`docs/ssr-data-loading.md` rule 6, added by
  plan 004), forms/i18n conventions, `nav.ts` single declaration.
- The prototype's fiche vocabulary (content asset to carry): CPGE boxes
  `BoxDef` (définitions), `BoxThm` (théorèmes), `BoxMeth` (méthodes),
  `BoxPit` (pièges classiques), `BoxCheck` — from the deleted prototype's
  `DEFAULT_PREAMBLE`/`DEFAULT_BODY` (`project.py:376-474` at
  `Fichr@prototype`). In markdown they become styled callout blockquotes
  (Step 4), not LaTeX.

## Commands you will need

| Purpose | Command | Expected |
|---------|---------|----------|
| Migration | `bun run db:generate` && `bun run db:migrate` | exit 0 |
| Tests | `bun run --cwd apps/server test` | exit 0 |
| Full gate | `bun run format:check && bun run lint && bun run check-types && bun run test && bun run build` | exit 0 |

## Scope

**In scope**:
- `apps/server/src/db/schema/documents.ts` (create: `studyDocuments`, `studyDocumentReferences`) + export + migration
- `apps/server/src/lib/ownership.ts` (`requireStudyDocument`)
- `apps/server/src/routers/documents.ts` (create) + `routers/index.ts`
- `apps/server/src/routers/documents.test.ts` (create)
- `apps/web/package.json` (the Step 1 pinned deps ONLY)
- `apps/web/src/components/documents/**` (editor, reader, print styles), `apps/web/src/app/(app)/materials/**` (fiches appear in the materials tree) or `(app)/documents/**` — Step 5 picks the mount point
- `apps/web/messages/{en,fr}.json`
- `apps/mobile/app/**` — READER only (render markdown), no mobile editor in this plan; `apps/mobile/lib/i18n.ts`

**Out of scope**:
- Server-side PDF (headless browser) and PPTX (`pptxgenjs`) exports — the job
  KINDS are named in Maintenance notes as the seam; implementing them is a
  follow-up plan once real demand exists. Do not add these deps.
- LaTeX compilation of any kind (toolchain-bound; the local Python companion
  still does it for those who want it).
- MCP tools and prompts over documents — that is plan 011, on top of this.
- Collaborative/multi-device live editing; AI copilot in the editor (ADR 007
  triggers).
- The mobile editor.

## Git workflow

- Branch: `advisor/010-documents-fiches`; conventional commits
  (`feat(server): study documents domain`, `feat(web): fiche editor`).
- Do NOT push or open a PR unless instructed.

## Steps

### Step 1: Pin the editor/renderer stack (decision recorded here)

Add to `apps/web` ONLY: `codemirror` (v6 meta-package) +
`@codemirror/lang-markdown` + `@codemirror/view` (editor);
`react-markdown` + `remark-gfm` + `remark-math` + `rehype-katex` +
`katex` (reader). Rationale to note in the commit: CodeMirror 6 is the
prototype's validated editor choice; `react-markdown` keeps rendering
plugin-based and CSP-safe (no `dangerouslySetInnerHTML` of user content —
katex CSS imported as a stylesheet). If bundle analysis (`next build`) pushes
the shared chunk past ~1.5× its current size, lazy-load both behind
`next/dynamic` on the editor/reader routes only.

**Verify**: `bun install` exit 0; `bun run build` exit 0.

### Step 2: Schema

`apps/server/src/db/schema/documents.ts`:

```ts
export type StudyDocumentKind = "fiche" | "note";
export type StudyDocumentRefKind = "subject" | "materialDocument" | "grade";

export const studyDocuments = sqliteTable("study_documents", {
  id: text().notNull().primaryKey().$defaultFn(() => newId("sdoc")),
  kind: text().$type<StudyDocumentKind>().notNull().default("fiche"),
  title: text().notNull(),
  /** The document body. Markdown, ≤ 512 KiB (validated in the router). */
  bodyMarkdown: text().notNull().default(""),
  /** Autosave conflict fence — mirror feedback.revision's optimistic shape. */
  revision: integer().notNull().default(1),
  metaVersion: integer().notNull().default(1),
  metaJson: text({ mode: "json" }).$type<StudyDocMetaV1>(),   // { emoji?, color? } — presentation only
  folderId: text().references(() => materialFolders.id, { onDelete: "set null", onUpdate: "cascade" }),
  subjectId: text().references(() => subjects.id, { onDelete: "set null", onUpdate: "cascade" }),
  yearId: text().notNull().references(() => years.id, { onDelete: "cascade", onUpdate: "cascade" }),
  userId: owner(),
  ...timestamps,
}, (t) => [index("study_documents_year_idx").on(t.yearId), index("study_documents_folder_idx").on(t.folderId)]);

export const studyDocumentReferences = sqliteTable("study_document_references", {
  documentId: text().notNull().references(() => studyDocuments.id, { onDelete: "cascade", onUpdate: "cascade" }),
  kind: text().$type<StudyDocumentRefKind>().notNull(),
  referenceId: text().notNull(),
}, (t) => [
  primaryKey({ columns: [t.documentId, t.kind, t.referenceId] }),
  index("study_document_references_lookup_idx").on(t.kind, t.referenceId),
]);
```

References mirror what the body/metadata cites (sources for a fiche) so
"which fiches cite this chapter/subject" stays a relational query — the
`dashboardCardReferences` convention exactly. Add `requireStudyDocument`.

**Verify**: migration + `bun run check-types` exit 0.

### Step 3: Router

`routers/documents.ts` (`goals.ts` conventions): `list({ yearId, folderId? })`,
`get({ documentId })`, `create({ yearId, kind, title, folderId?, subjectId? })`
(validate folder/subject same-year via `assertSameYear`),
`update({ documentId, revision, title?, bodyMarkdown?, folderId?, subjectId?, sources? })`
— rejects with `badRequest("This fiche changed elsewhere — reload")` when
`revision` mismatches, bumps it on success, replaces
`studyDocumentReferences` from `sources` in the same `db.batch`; body cap
512 KiB. `delete({ documentId })`. Register `documents` in `routers/index.ts`.

**Verify**: `documents.test.ts` on the in-memory bootstrap: CRUD, revision
conflict, same-year validation, references replaced atomically, ownership
isolation, body-cap rejection.

### Step 4: Editor + reader (web)

`apps/web/src/components/documents/`:

- **Editor route** (full-screen per the forms convention): CodeMirror
  markdown pane + live `react-markdown` preview (split on desktop, tabbed on
  mobile widths). Autosave: debounce 1.5s → `documents.update` with the held
  `revision`; on conflict, non-destructive banner (keep local text, offer
  reload). Invalidate only `orpc.documents.*` keys.
- **Fiche callouts**: support the CPGE vocabulary as blockquote directives —
  a blockquote whose first line is `[!DEF]`, `[!THM]`, `[!METH]`, `[!PIEGE]`,
  or `[!CHECK]` renders as a tinted callout with the label (map to the
  `--band-*`/accent tokens; the GitHub-alerts syntax family, custom labels).
  Implement as a small rehype/remark plugin in
  `components/documents/callouts.ts` with colocated tests (pure function per
  the `components/cards/` pattern). Insert-toolbar buttons for the five.
- **Reader**: same renderer, read-only, used by the materials space and
  mobile parity.
- **Print export**: a `@media print` stylesheet on the reader route (A4
  margins, callouts keep their borders, code/math unbroken) + an "Exporter en
  PDF" button calling `window.print()`. This IS the v1 export.

**Verify**: `bun run lint && bun run check-types && bun run build` exit 0;
callout plugin unit tests pass; manual: create a fiche with math
(`$\int_0^1$`), a `[!THM]` callout, print preview renders cleanly.

### Step 5: Mount into the app

Fiches live in the materials tree: plan 005's browser lists
`studyDocuments` alongside `material_documents` (new-document button per
folder), and `nav.ts` needs no new entry. If plan 005 is not yet merged when
this executes, STOP (the dependency is real). Mobile: a read-only renderer
screen (`react-native` markdown rendering: use plain text fallback — mobile
READER ships as raw text section list in this plan; note in the screen header
that native rich rendering is follow-up).

**Verify**: manual browse: fiche appears in its folder, opens in editor;
`bunx expo export --platform all` exit 0.

### Step 6: Full gate

**Verify**: all root gates exit 0.

## Test plan

Server: Step 3 list (≥7 cases, `integrity.integration.test.ts` bootstrap).
Web: callout plugin + any editor view-model logic in colocated `.test.ts`.
Manual: math + callouts + print preview.

## Done criteria

- [ ] Migrations create `study_documents` + `study_document_references`
- [ ] `documents` registered; revision-conflict behavior test-proven
- [ ] Editor autosaves, preview renders GFM + KaTeX, five callouts render
- [ ] Print stylesheet produces a clean A4 preview (manual check documented in PR)
- [ ] Only the pinned deps were added to `apps/web/package.json` (`git diff` shows exactly them)
- [ ] All root gates exit 0; `git status` clean outside scope; `plans/README.md` updated

## STOP conditions

- Plan 005's materials tree is absent (mount point missing).
- The pinned packages conflict with React 19 / Next 16 at install or build —
  report the exact incompatibility; do not substitute a different editor
  stack on your own.
- KaTeX CSS cannot be imported under the app's CSP/build without inline-style
  violations — report rather than weakening CSP.
- Autosave conflicts require merging (two live editors) — out of scope;
  banner-and-reload is the contract.

## Maintenance notes

- Deferred export seam (do NOT build now): job kinds `export.documentPdf`
  (headless-chromium print of the reader route) and `export.documentPptx`
  (`pptxgenjs`, H2-per-slide mapping) on the plan-002 substrate — write their
  plan when browser print stops being enough (the PPTX ask is real; this is
  its landing zone).
- Plan 011 exposes this domain to agents (tools + prompts) — `update`'s
  revision fence is what makes concurrent agent edits safe; keep it.
- The search roadmap item indexes `bodyMarkdown` alongside OCR artifacts.
- Reviewer attention: reference replacement atomicity in `update`, the body
  cap, and that no `dangerouslySetInnerHTML` renders user content.
