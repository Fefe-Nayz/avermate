# Plan 020: Materials explorer — the seven pieces the UI is waiting on

> **Split of labour (maintainer's request, this session)**: the maintainer
> builds the server — schema, migrations, oRPC procedures. This document is
> the contract each piece needs. The web UI for each is already designed and
> is written against the surface described here; nothing below is speculative
> about the client, and nothing above the "API contract" line in each section
> is negotiable without a matching change on the other side.
>
> Read each section as a standalone plan. They are ordered by what unlocks
> the most for the least schema churn, not by ambition.

## Status

- **Priority**: P1 for §1–§2, P2 for §3–§5, P3 for §6–§7
- **Depends on**: plans/005 (course-materials slice), 001 (files), 002 (jobs),
  008 (provider sync framework), 010 (documents/fiches)
- **Planned at**: 2026-08-21, branch `rewrite`

## Where the client already is

The browser was rebuilt this session on the project's registry components:
`@reui/tree` for the rail, `@reui/data-grid` for the table (virtualised past
150 rows), a card grid, `?folder=` in the address feeding the app breadcrumb,
selection with bulk move/delete/download, cut & paste, drag-and-drop onto
folders, right-click menus on the rail and on rows, and `origin` shown as a
chip with a filter. Everything below extends that; none of it replaces it.

Shared client vocabulary, for reference in the contracts:

- `MaterialRow` — the one row shape the table and the grid both read
  (`apps/web/src/components/materials/materials-rows.ts`).
- `MaterialsLocation` — `root | all | folder`, parsed from `?folder=`
  (`materials-location.ts`).
- `MaterialMenuKit` — one action list, rendered into either menu
  (`materials-menu.ts`).

---

## §1 — Favourites and trash

**Why first**: one migration, two columns, and it removes the most frightening
thing in the screen — a delete that cannot be undone. Everything else in this
document is easier to demo once a mistake is recoverable.

### Schema

```ts
// material_folders, material_documents, study_documents, lecture_recordings
starredAt: integer({ mode: "timestamp" }),   // null = not starred
deletedAt: integer({ mode: "timestamp" }),   // null = live
deletedFrom: text(),                         // folderId at deletion time
```

`deletedFrom` is what makes "restore" put a file back where it was rather than
at the root. Keep the FK on `folderId` as it is; on delete of a folder, stamp
`deletedAt` on its descendants rather than cascading rows away.

### API contract

```ts
materials.star({ kind: "folder"|"document"|"study"|"recording",
                 id: string, starred: boolean }) -> { starredAt: Date | null }

materials.trash({ kind, id }) -> { deletedAt: Date }
materials.restore({ kind, id }) -> { folderId: string | null }
materials.purge({ kind, id }) -> { ok: true }           // the real delete
materials.emptyTrash({ yearId }) -> { purged: number }

// every existing list gains one input flag, defaulting to live rows only:
materials.documents.list({ yearId, include?: "live" | "trashed" })
```

Two rules the client depends on:

1. `list` **must** exclude `deletedAt != null` by default. The browser has no
   concept of a hidden row and would count trashed files in every folder badge.
2. `purge` after 30 days is a job (plan 002), not a client responsibility.

### UI on top

- A star toggle in the row menu and on hover in the name cell; a **Favoris**
  entry in the rail beside "Mes supports" reading `starredAt != null`.
- A **Corbeille** entry in the rail: same table, `include: "trashed"`, with the
  row actions replaced by *Restaurer* / *Supprimer définitivement*, plus
  *Vider la corbeille* in the toolbar.
- The existing delete confirmation changes wording from "définitif" to "vous
  pourrez le récupérer", and the bulk bar's Supprimer calls `trash`.

**Done when**: deleting from the browser is recoverable, and `?folder=trash`
is a location like any other.

---

## §2 — Tags

**Why second**: it is the missing axis. `origin` says where a file came from
and `folderId` says where it sits; nothing says what it is *about* when that
crosses folders (`révisions partiel`, `à relire`, `TD corrigé`).

### Schema

```ts
export const materialTags = sqliteTable("material_tags", {
  id: text().primaryKey().$defaultFn(() => newId("mtag")),
  name: text().notNull(),
  color: text(),                       // a token name, not a hex
  subjectId: text().references(() => subjects.id, { onDelete: "set null" }),
  yearId: text().notNull().references(() => years.id, { onDelete: "cascade" }),
  userId: owner(),
  ...timestamps,
}, (t) => [index("material_tags_year_idx").on(t.yearId)])

export const materialTagLinks = sqliteTable("material_tag_links", {
  tagId: text().notNull().references(() => materialTags.id, { onDelete: "cascade" }),
  targetKind: text().$type<"document" | "study" | "recording" | "folder">().notNull(),
  targetId: text().notNull(),
  ...timestamps,
}, (t) => [primaryKey({ columns: [t.tagId, t.targetKind, t.targetId] })])
```

`subjectId` optional is deliberate — the maintainer asked "relié ou pas à une
matière". A tag bound to a subject inherits its colour and can be offered
first when tagging something already filed under that subject.

### API contract

```ts
materials.tags.list({ yearId }) -> Tag[]
materials.tags.create({ yearId, name, color?, subjectId? }) -> Tag
materials.tags.update({ tagId, name?, color?, subjectId? }) -> Tag
materials.tags.delete({ tagId }) -> { ok: true }
materials.tags.assign({ tagId, targets: { kind, id }[] , assigned: boolean }) -> { count: number }

// list projections gain, per row:
tagIds: string[]
```

`tagIds` on the list projection rather than a join per row: the browser draws
1000 rows and cannot open 1000 queries. The tag table itself is small and is
fetched once.

### UI on top

- `MaterialRow` gains `tagIds`; chips render beside the origin chip, capped at
  two with a `+N`.
- A **Tags** section in the rail under the folder tree, each tag a location
  (`?tag=<id>`) — the same table filtered.
- Multi-select in the toolbar filter row, and *Tags ▸* in the row context menu
  with a checkbox per tag (the `MaterialMenuKit` already supports submenus).

**Done when**: a tag is a location in the rail and a filter in the toolbar, and
tagging is reachable from the right click.

---

## §3 — Thumbnails (preview instead of an icon)

**Why**: the grid view is currently 400 identical grey squares. A preview is
what makes a card view worth switching to.

### Schema

```ts
// on files (plan 001)
previewFileId: text().references(() => files.id, { onDelete: "set null" }),
previewStatus: text().$type<"pending"|"ready"|"unsupported"|"failed">()
  .notNull().default("pending"),
```

A preview is itself a `files` row (purpose `"preview"`), so storage, quota and
signed URLs are the machinery that already exists.

### API contract

```ts
// job (plan 002), enqueued on upload and on re-ingest
"materials.preview" : { fileId } -> writes previewFileId + previewStatus

// list projection gains:
previewStatus: "pending" | "ready" | "unsupported" | "failed"

// one batched read, because a grid needs many at once:
materials.documents.previewUrls({ documentIds: string[] })
  -> { documentId: string, url: string }[]   // short-lived, ~1h
```

Generation targets, in order of value: PDF first page, images (resize to
512px), PPTX/DOCX via the existing conversion path if one lands, everything
else `unsupported`.

### UI on top

- The card's 80px tile becomes the preview when `previewStatus === "ready"`,
  with the icon as the placeholder and the fallback.
- The table's name cell keeps its icon — a thumbnail in a 36px tile is noise.
- `previewUrls` is called once per rendered window, which is why it is batched:
  the grid is virtualised too by then.

**Done when**: the grid shows real first pages and never blocks on a missing
one.

---

## §4 — Reading and editing inside the explorer

**Why**: opening a fiche today throws away the rail, the breadcrumb and the
selection, and a plain upload opens in a dialog — two different answers to the
same gesture.

**This one is mostly client work.** The API needs nothing new; the plan is here
because it changes routing, which the server renders.

### Routing

```
/materials                       → rail + table
/materials/f/[folderId]          → rail + table, folder selected   (replaces ?folder=)
/materials/d/[documentId]        → rail + reader, right pane only
/materials/d/[documentId]/edit   → rail + editor
```

A layout at `/materials` renders the rail and the toolbar; the child segment
renders either the table or the document pane. `?folder=` stays supported as a
redirect for one release so existing links do not break.

The breadcrumb hook already builds a folder trail; it gains one segment for the
document, so the header reads
`Supports / Physique / TP / Compte-rendu 3`.

### UI on top

- `MaterialViewer` (dialog) and the fiche routes collapse into one right-pane
  component with tabs *Source | Transcription | Notes*.
- The rail keeps its selection, so navigating between documents in a folder is
  one click each.
- Mobile keeps the full-screen behaviour: the pane replaces the table.

**Done when**: no document opens in a dialog, and the header trail names the
document you are reading.

---

## §5 — LaTeX documents with a live PDF build

**Why**: the maintainer asked for it explicitly, side-by-side, "comme dans
Overleaf".

### Schema

```ts
// study_documents.kind gains "latex"
// bodyMarkdown holds the .tex source (rename is not worth a migration)
// metaJson (v2): { engine: "pdflatex"|"xelatex"|"lualatex", entry?: string }

export const studyDocumentBuilds = sqliteTable("study_document_builds", {
  id: text().primaryKey(),
  documentId: text().notNull().references(() => studyDocuments.id, { onDelete: "cascade" }),
  revision: integer().notNull(),      // the source revision built
  status: text().$type<"queued"|"running"|"succeeded"|"failed">().notNull(),
  pdfFileId: text().references(() => files.id, { onDelete: "set null" }),
  log: text(),                        // the compiler output, truncated
  ...timestamps,
})
```

### API contract

```ts
documents.build({ documentId, revision }) -> { buildId }      // enqueues
documents.builds.latest({ documentId }) -> Build | null       // polled, or SSE
documents.builds.log({ buildId }) -> { log: string }
```

Server side: a sandboxed `tectonic` (single binary, no TeX Live install) in a
job worker, with a wall-clock cap and a page cap. Build on explicit request
first; debounced auto-build is a later refinement.

### UI on top

- CodeMirror with a LaTeX mode in the left pane, the built PDF in the right,
  a build button with the status and the error log in a collapsible strip.
- Errors parsed to `file:line` and clickable into the editor.
- The split is the same right-pane component §4 introduces, so this is one more
  document kind rather than a new screen.

**Done when**: a `.tex` document builds to a PDF that opens beside its source,
and a failed build shows the compiler's own words.

---

## §6 — A renderer registry (the NotebookLM ambition)

**Why**: every new file type currently means an `if` in the viewer.

### API contract

Nothing new — this is a client architecture plan, listed because the server
decides what `mimeType` values exist and what extraction each gets.

```ts
interface MaterialRenderer {
  id: string
  accepts: (row: MaterialRow) => boolean
  /** Weight, so a specific renderer beats a generic one. */
  priority: number
  Reader: ComponentType<{ row: MaterialRow }>
  Editor?: ComponentType<{ row: MaterialRow }>
  /** What the assistant should read; falls back to the transcript. */
  extract?: (row: MaterialRow) => Promise<string>
}
```

First renderers: PDF (the existing iframe), image, markdown/text, CSV → data
table, audio (the recording player), LaTeX (§5), and a generic "download only".

The server-side counterpart is the extraction each type gets in plan 009's
pipeline, so the assistant sees the same content the reader does.

**Done when**: adding a file type is one file in `materials/renderers/` and no
change to the viewer.

---

## §7 — OneDrive as a second source

**Why**: the maintainer's own architecture note, which is right. The shape
below only records the decisions the client depends on.

### Schema

```ts
export const contentConnections = sqliteTable("content_connections", {
  id: text().primaryKey(),
  provider: text().$type<"moodle" | "onedrive">().notNull(),
  accountLabel: text().notNull(),         // shown in settings
  status: text().$type<"connected"|"expired"|"error">().notNull(),
  cursor: text(),                         // Graph deltaLink, opaque
  subscriptionId: text(),                 // Graph webhook
  subscriptionExpiresAt: integer({ mode: "timestamp" }),
  lastSyncedAt: integer({ mode: "timestamp" }),
  scopeJson: text({ mode: "json" }).$type<{ folderIds: string[] } | null>(),
  yearId: text().notNull(),
  userId: owner(),
  ...timestamps,
})
```

`material_documents` gains `connectionId` and `externalId`; `origin` widens to
`"manual" | "moodle" | "onedrive"` — the client already renders `origin` as a
chip and filters on it, so a third value costs the UI one label.

### API contract

```ts
connectors.list({ yearId }) -> Connection[]
connectors.oauthUrl({ provider, yearId }) -> { url, state }
connectors.disconnect({ connectionId }) -> { ok: true }

connectors.browse({ connectionId, remoteFolderId?: string })
  -> { id, name, kind: "folder"|"file", childCount? }[]   // the folder picker
connectors.setScope({ connectionId, folderIds: string[] }) -> Connection
connectors.syncNow({ connectionId }) -> { jobId }

// POST /api/webhooks/graph  → validation handshake + enqueue a delta job
```

Read-only, as the maintainer proposed. `browse` is what the "choisir des
dossiers" picker needs and is the only part of Graph the client ever sees —
everything else is the sync job's business.

### UI on top

- **Réglages ▸ Sources**: one card per connection with the account, the last
  sync, and a folder picker that reuses `MaterialsFolderTree` against
  `connectors.browse`.
- The browser itself does not change: a synced file is a row with an
  `onedrive` origin chip, in whatever folder the mapping puts it.
- **Decision, stated once**: one merged tree, not a tree per source. Separating
  by connector forces you to choose *where to look* before looking, and breaks
  the case that matters — the Moodle handout and your own notes for the same
  chapter, side by side. Provenance is an attribute of a document, not its
  location.

**Done when**: connecting OneDrive files a chosen folder tree into Materials,
a change in OneDrive shows up without a manual refresh, and the browser cannot
tell you which connector a row came from except by its chip.

---

## §8 — A gantt, and where it actually belongs

**The question, answered plainly**: a gantt is the wrong shape for daily school
planning and the right shape for one thing this app already has.

Wrong for the day-to-day, because a gantt earns its keep on work with
*duration* — bars that span days, rows that are resources, dependencies between
them. A student's homework is overwhelmingly a set of single-day deadlines, and
a gantt of one-day bars is a worse calendar: the same information, more chrome,
and a horizontal axis carrying nothing.

Right for **multi-week work**, which the app has three sources of:

- Revision plans before an exam — the goal plans in `use-goal-plans.ts` already
  produce dated blocks per subject, and they have no view of their own.
- Long assignments: a TIPE, a dossier, a project handed out in October and due in
  March. Today they are one deadline in a list, which is exactly the case where
  seeing the runway matters.
- The year's own shape: periods, holidays, exam weeks, as a background against
  which the two above are read.

### What it needs from the API

Only one thing that does not exist: assignments and tasks have a due date but no
*start*. A bar needs both.

```ts
// planning_assignments, planning_tasks
startsAt: integer({ mode: "timestamp" }),   // null = a deadline, not a stretch
```

Nothing else. Goal plans already carry a range, and periods already carry
`startsAt` / `endsAt`.

### UI on top

`@reui/gantt`, on a fifth planning tab — **Projets** — not as a replacement for
any existing one:

- Rows are subjects (`GanttResource` tree, one group per parent subject), bars
  are the dated stretches: long assignments, goal-plan blocks, revision windows.
- `defaultScale="week"`, with month and quarter for the long view.
- Drag and resize commit through `onEventUpdate` → `assignments.update`, which is
  where the new `startsAt` gets written; `canDropEvent` refuses a bar dragged
  past its due date.
- Off days from the school calendar (`offDays`), so a plan cannot be built across
  a holiday without seeing it.
- Anything with no `startsAt` stays a deadline and is not shown as a bar — it is
  listed on the day it is due, in the views that already do that well.

**Done when**: a long assignment shows its runway rather than only its deadline,
and dragging its start writes `startsAt`.

## Order I would take them

`§1 favourites + trash` → `§2 tags` → `§4 reading in place` → `§3 previews` →
`§7 OneDrive` → `§8 gantt` → `§5 LaTeX` → `§6 renderer registry`.

§8 sits where it does because it is one nullable column away from being
possible, and because it is the only one of these that adds a *view* rather than
a capability — worth doing once the sources feeding it are richer.

§1 and §2 are one migration each and immediately visible. §4 needs no server
work at all and removes the worst inconsistency in the screen. §3 and §7 are
where the cost is. §5 and §6 are the long tail, and §6 is only worth doing once
there are three or four renderers to register.
