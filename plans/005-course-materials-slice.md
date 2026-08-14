# Plan 005: Ship the course-materials vertical slice (storage decision spike + materials domain + web/MCP surfaces)

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat 46c966b..HEAD -- apps/server/src/db/schema apps/server/src/routers apps/server/src/lib apps/web/src/lib/nav.ts docs/`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition. This plan additionally REQUIRES
> plans 001 and 003 to be DONE (it consumes `files`/`lib/storage.ts` and
> `mcp/surfaces/`); verify their Done criteria before starting.

## Status

- **Priority**: P2
- **Effort**: L
- **Risk**: MED
- **Depends on**: plans/001-file-entity.md (hard), plans/003-mcp-modular-surfaces.md (hard for the MCP step), plans/004-agenda-domain.md (soft — reuse its read-model conventions and `docs/ssr-data-loading.md` rule 6)
- **Category**: direction
- **Planned at**: commit `46c966b`, 2026-08-14

## Why this matters

The heart of the study-companion vision is "all my course materials in one
place, browsable by me and by AI agents". The Python prototypes proved the
model — course → source files (Moodle-mirrored + personal) → processed
markdown — against a year of real CPGE material, but they live outside the
app. This plan lands the first server-truth slice in avermate: a `materials`
domain (folders + documents referencing the `files` entity), an upload/list/
rename/move/delete surface on web, and read tools over MCP so an agent can
list and fetch course documents. OCR, Moodle sync and the editor build on top
(see plans/README.md roadmap); none of them can start until files have a home.

## Current state

- Plan 001 delivered (verify): `files` table
  (`apps/server/src/db/schema/files.ts`) with `provider`/`storageKey`/`url`/
  `mimeType`/`byteSize`/`purpose`/`status` + `owner()`; `lib/storage.ts` with
  `FILE_CONSTRAINTS` per purpose, `storeFile`, `deleteFile`,
  `storageEnabled()`; `requireFile` in `lib/ownership.ts`.
- Plan 003 delivered (verify): MCP surfaces live under
  `apps/server/src/mcp/surfaces/`, ordered in `surfaces/index.ts`; scopes in
  `lib/auth.ts:24-32`; harness enumerations pin the catalog.
- Upload transport today is proxy-through-API: `z.instanceof(File)` oRPC
  inputs; the rationale (recorded at `routers/profile.ts:11-18`) explicitly
  leaned on files being "already cropped and small". Course PDFs and scans
  invert that (10–50 MB), hence the Step 1 spike.
- UploadThing is the only provider; token optional at `lib/env.ts:49`;
  `DISABLE_UPLOADS` at `:53`; web image hosts allowlisted in
  `apps/web/next.config.ts` (`*.ufs.sh`, `utfs.io`).
- Namespaced-router exemplar — `apps/server/src/routers/social.ts:13-26`:

  ```ts
  export const socialRouter = {
    sharing: socialSharingRouter,
    friends: { ...socialFriendsRouter, invitations: socialFriendInvitationsRouter },
    blocks: socialBlocksRouter,
    groups: { ...socialGroupsRouter, invitations: socialGroupInvitationsRouter },
    notifications: socialNotificationsRouter,
    reports: socialReportsRouter,
  };
  ```

  with sub-files under `routers/social/` and shared pure helpers in
  `routers/social/shared.ts`. Copy this layout for `routers/materials/`.
- Schema conventions, ownership helpers, goals-router procedure conventions,
  SSR page exemplar, nav declaration, forms and i18n conventions: identical to
  the "Current state" of plans 001/004 — reread those sections; they are not
  repeated here except where materials-specific.
- Subject tree: `subjects` (`db/schema/app.ts:260`) is a per-year
  self-referencing tree (`parentId`, no self-FK by design). Materials attach to
  a year and OPTIONALLY a subject.
- The prototype's proven modelling decisions to carry over (from the deleted
  Python prototype, `github.com/Fefe-Nayz/Fichr` commit `b8c5714`, and its
  working copy): personal files and synced files coexist in one tree
  (`perso/` subtree); OCR output is a SEPARATE mirrored artifact, not a column
  on the source file; the folder tree mirrors the source (Moodle
  section/module) structure. Model files as rows with storage keys, never
  filesystem paths.

## Commands you will need

| Purpose   | Command                          | Expected on success |
|-----------|----------------------------------|---------------------|
| Install   | `bun install --frozen-lockfile`  | exit 0              |
| Migration | `bun run db:generate` then `bun run db:migrate` | exit 0 |
| Typecheck | `bun run check-types`            | exit 0              |
| Server tests | `bun run --cwd apps/server test` | exit 0          |
| Web dev   | `bun run dev:server` + `bun run dev:web` | :5000 / :3000 |
| All gates | `bun run format:check && bun run lint && bun run check-types && bun run test && bun run build` | exit 0 |

## Scope

**In scope**:
- `docs/materials-storage.md` (create — the Step 1 decision record)
- `apps/server/src/db/schema/materials.ts` (create) + index export + migration
- `apps/server/src/lib/storage.ts` (add the `course-material` purpose; possibly presign support per Step 1)
- `apps/server/src/lib/ownership.ts` (add `requireMaterialFolder`, `requireMaterialDocument`)
- `apps/server/src/routers/materials/` (create: `folders.ts`, `documents.ts`, `shared.ts`) + `routers/materials.ts` namespace + `routers/index.ts` (one line)
- `apps/server/src/routers/materials.test.ts` (create)
- `apps/server/src/lib/auth.ts` (add `avermate:materials.read`, `avermate:materials.write`) + `apps/server/src/mcp/surfaces/materials.ts` + `surfaces/index.ts` + harness enumerations + `docs/mcp.md` tables
- `apps/web/src/app/(app)/materials/**`, `apps/web/src/components/materials/**`, `nav.ts`, `route-query-inputs.ts`, `messages/{en,fr}.json`
- `apps/mobile/app/materials/**` (minimal list/open)

**Out of scope** (do NOT touch):
- OCR, Moodle sync, transcription, the document editor — separate roadmap
  items; this plan stores and serves originals only.
- Sharing materials socially or via groups.
- Full-text search — listing and per-folder browsing only.
- Fetching/ingesting `"link"` sources (readability extraction, YouTube) —
  plan 013; this plan only stores the URL row.
- `snapshot.get` — materials are a feature-scoped read model (rule 6).
- Migrating avatar/feedback uploads to any new transport chosen in Step 1
  (they stay proxied; revisit only when quotas demand).

## Git workflow

- Branch: `advisor/005-course-materials-slice` from `rewrite`.
- Conventional commits, e.g. `feat(server): materials domain`,
  `feat(web): materials space`, `docs: materials storage decision`.
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Storage-transport spike → decision record

Answer ONE question and write it down: **proxy-through-API or presigned
direct-to-storage for course-material uploads?** Method:

1. Check UploadThing's server SDK (version in `apps/server/package.json`,
   `uploadthing@^7.x`) for presigned/direct upload support usable WITHOUT
   exposing the token (their `UTApi` and `uploadthing/server` route-handler
   docs; the dependency is already installed — read
   `node_modules/uploadthing/package.json` exports and the typed API surface,
   no network needed).
2. Weigh against the recorded proxy rationale (`profile.ts:11-18`) at
   30 MB PDF scale: Bun memory per request, reverse-proxy body limits in
   `deploy.yml`'s Traefik setup, and the Expo client (file URI, no `File`
   polyfill guarantees over oRPC — check how `apps/mobile` currently sends
   avatar images: `apps/mobile/lib/image-file.ts`).
3. Decide, and record in `docs/materials-storage.md` (≤ 40 lines): the choice,
   the two strongest reasons, the size cap (recommendation: 50 MB for
   `course-material`), and the revisit trigger. **Default when evidence is
   balanced: keep the proxy** (one transport, no client-visible tokens) with a
   50 MB cap and streaming to the provider — simplicity wins until lecture
   audio (plans/README roadmap) forces presign.

**Verify**: `docs/materials-storage.md` exists, states a single decision, and
`git status` shows only that file so far.

### Step 2: Schema

`apps/server/src/db/schema/materials.ts`:

```ts
export const materialFolders = sqliteTable(
  "material_folders",
  {
    id: text().notNull().primaryKey().$defaultFn(() => newId("mfold")),
    name: text().notNull(),
    /** Self-referencing tree; no self-FK, same deliberate choice as subjects (app.ts:270-275). */
    parentId: text(),
    subjectId: text().references(() => subjects.id, { onDelete: "set null", onUpdate: "cascade" }),
    /** "manual" today; "moodle" when sync lands. */
    origin: text().notNull().default("manual"),
    sortOrder: integer().notNull().default(0),
    yearId: text().notNull().references(() => years.id, { onDelete: "cascade", onUpdate: "cascade" }),
    userId: owner(),
    ...timestamps,
  },
  (t) => [index("material_folders_year_idx").on(t.yearId), index("material_folders_parent_idx").on(t.parentId)],
);

export type MaterialSourceType = "file" | "link" | "text";
// NotebookLM-style multi-type sources: "file" = uploaded/synced binary (PDF,
// image, later audio); "link" = a web URL ingested by plan 013; "text" =
// pasted text stored inline. Audio recordings stay their own entity (plan 012).

export const materialDocuments = sqliteTable(
  "material_documents",
  {
    id: text().notNull().primaryKey().$defaultFn(() => newId("mdoc")),
    title: text().notNull(),
    folderId: text().references(() => materialFolders.id, { onDelete: "cascade", onUpdate: "cascade" }),
    sourceType: text().$type<MaterialSourceType>().notNull().default("file"),
    /** Required when sourceType="file"; null otherwise. Router-enforced. */
    fileId: text().references(() => files.id, { onDelete: "restrict", onUpdate: "cascade" }),
    /** Required when sourceType="link". */
    sourceUrl: text(),
    /** Inline body when sourceType="text" (≤ 256 KiB, router-enforced). */
    textContent: text(),
    origin: text().notNull().default("manual"),
    /** Reserved for sync/OCR metadata; typed-JSON convention with version int. */
    metaVersion: integer(),
    metaJson: text({ mode: "json" }).$type<MaterialMetaV1>(),
    yearId: text().notNull().references(() => years.id, { onDelete: "cascade", onUpdate: "cascade" }),
    userId: owner(),
    ...timestamps,
  },
  (t) => [index("material_documents_folder_idx").on(t.folderId), index("material_documents_year_idx").on(t.yearId)],
);
```

`onDelete: "restrict"` on `fileId` is deliberate: deleting a document goes
through the router (which also `deleteFile`s); a dangling delete of the file
row out from under a document must fail loudly. The `sourceType` invariant
(file ⇒ fileId, link ⇒ sourceUrl, text ⇒ textContent; the other columns null)
is enforced in the router with `badRequest`, and this plan BUILDS only the
`"file"` and `"text"` paths (upload + paste-a-note); `"link"` rows can be
created but their fetching/ingestion is plan 013 — the create procedure
accepts a URL and leaves ingestion status to that plan. Define `MaterialMetaV1` (empty
object type with an index-signature-free placeholder field is fine) in the same
file — the typed-JSON + version convention follows
`dashboardCards.definitionJson` (`app.ts:507-508`).

Add `course-material` to `FILE_CONSTRAINTS` in `lib/storage.ts`:
`{ maxBytes: 50 * 1024 * 1024, mimeTypes: ["application/pdf", "image/png", "image/jpeg", "image/webp"] }`
(adjust maxBytes to the Step 1 decision). Add `requireMaterialFolder` /
`requireMaterialDocument` to `lib/ownership.ts`.

**Verify**: `bun run db:generate` + `bun run db:migrate` + `bun run check-types` → exit 0.

### Step 3: Routers

`apps/server/src/routers/materials/` per the social layout: `folders.ts`
(create/rename/move/reorder/delete — move re-validates same-year parent and
rejects cycles by walking `parentId` upward, cap 32 hops like a sane tree;
delete cascades children+documents via explicit collection then `db.batch`,
mirroring the subjects subtree-delete approach), `documents.ts` (upload =
`storeFile({ purpose: "course-material" })` + insert row; list by folder/year;
rename; move; delete = row delete + `deleteFile`; `download` returning the
`files.url`), `shared.ts` (tree helpers, pure). `documents.ts` additionally gets
`createText({ folderId?, title, textContent })` (paste-a-note source, cap
256 KiB) and `createLink({ folderId?, title?, url })` (stores the row with
`sourceType:"link"`; z.url() validation; ingestion deferred to plan 013 —
title defaults to the URL host+path until ingestion improves it). Namespace
file `routers/materials.ts`:

```ts
export const materialsRouter = {
  folders: materialFoldersRouter,
  documents: materialDocumentsRouter,
};
```

Register `materials: materialsRouter` in `routers/index.ts`. Every handler:
`protectedProcedure`, ownership first line, `assertSameYear` on cross-refs,
`badRequest`/`notFound` only.

**Verify**: `bun run check-types` → exit 0.

### Step 4: Server tests

`apps/server/src/routers/materials.test.ts` on the integration bootstrap:
folder CRUD + cycle rejection; cross-year parent/subject rejection; document
upload path with uploads disabled (`badRequest` from `storeFile` — no token in
tests); direct-row fixtures for list/move/delete; delete removes the `files`
row via `deleteFile` (assert `status="deleted"`); ownership isolation across
users for both entities.

**Verify**: `bun run --cwd apps/server test` → exit 0.

### Step 5: MCP surface

Scopes `avermate:materials.read` / `avermate:materials.write` in `MCP_SCOPES`;
`mcp/surfaces/materials.ts` registering `materials.folders.list`,
`materials.documents.list`, `materials.documents.get` (read) and
`materials.folders.create`, `materials.documents.rename`,
`materials.documents.move` (write); `materials.documents.delete` +
`materials.folders.delete` as destructive via `runDestructive` + uuid
idempotency key. Append the surface at the end of `surfaces/index.ts`; update
harness enumerations and `docs/mcp.md` tables. (Uploads over MCP are NOT
exposed — agents read and organize; humans upload.)

**Verify**: `bun run --cwd apps/server test` → exit 0 (harness green).

### Step 6: Web space

- `nav.ts`: add `{ href: "/materials", label: "Materials", icon: FolderOpenIcon }`
  after `/grades`.
- `apps/web/src/app/(app)/materials/page.tsx` per the announcements exemplar:
  prefetch `materials.folders.list` + `materials.documents.list` for the
  current year (factories in `route-query-inputs.ts`), hydrate a
  `MaterialsClient`.
- `apps/web/src/components/materials/`: two-pane browser (folder tree +
  document list), upload button using the plan-001 transport (hidden
  `<input type="file">` + oRPC `File` input, per
  `avatar-editor.tsx`'s mechanics but without cropping), rename/move dialogs
  via the existing form conventions, open/download linking `files.url` in a
  new tab. Pure tree/view-model logic in colocated `.test.ts`-covered modules
  (the `components/cards/` pattern). Invalidate only `orpc.materials.*` keys.
- en/fr messages together.

**Verify**: `bun run lint && bun run check-types` → exit 0; manual: upload a
PDF into a subject folder, see it listed, rename it, delete it (with
`UPLOADTHING_TOKEN` configured locally; otherwise verify the disabled-state
notice renders — the `storageEnabled` probe pattern from
`profile.uploadsEnabled`).

### Step 7: Mobile minimal

`apps/mobile/app/materials/index.tsx`: year-scoped folder/document list with
open-in-browser for documents (`Linking.openURL(files.url)`); entry point from
the dashboard like the agenda's (no sixth tab). Strings added to
`apps/mobile/lib/i18n.ts` with French entries. Upload from mobile is deferred
(document why in the screen header comment: transport decision + camera scan
flow arrive with the grade-copy plan 006 learnings).

**Verify**: from `apps/mobile`: `bunx expo export --platform all` → exit 0.

### Step 8: Full gate

**Verify**: `bun run format:check && bun run lint && bun run check-types && bun run test && bun run build` → all exit 0.

## Test plan

Server per Step 4 (≥10 cases). Web: colocated pure-module tests for the folder
tree (flatten/nest, cycle guard mirror, sort). MCP: harness enumerations only.
Manual smoke per Steps 6–7.

## Done criteria

Machine-checkable. ALL must hold:

- [ ] `docs/materials-storage.md` exists with a single stated decision
- [ ] Migration creates `material_folders` + `material_documents`; fresh migrate exits 0
- [ ] `materials` in `routers/index.ts`; both `requireX` helpers exist
- [ ] `materials.test.ts` passes; full `bun run --cwd apps/server test` exits 0 incl. harness
- [ ] `grep -n "avermate:materials" apps/server/src/lib/auth.ts docs/mcp.md` → matches in both
- [ ] `/materials` in `nav.ts`; web page prefetches materials queries; no `snapshot.get` reference under `apps/web/src/{app/(app)/materials,components/materials}`
- [ ] `bunx expo export --platform all` exits 0
- [ ] All root gates exit 0; `git status` clean outside scope
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back (do not improvise) if:

- Plan 001's `files`/`storage.ts` or plan 003's `surfaces/` layout is absent
  (dependencies not actually DONE).
- The Step 1 spike finds the proxy transport cannot carry 50 MB through the
  stack (oRPC `File` limits, Bun body limits) AND presign is not achievable
  with the installed UploadThing version — report with the evidence; do not
  invent a third transport.
- Cycle rejection or subtree deletion cannot reuse existing patterns and
  starts requiring recursive SQL (keep it in application code like subjects
  does; if that's impossible, STOP).
- The harness fails on anything but the new enumerated names.

## Maintenance notes

- The `origin` columns ("manual" | "moodle") and `metaJson` are the seams the
  Moodle-sync and OCR roadmap items plug into — sync will upsert
  folders/documents with `origin="moodle"` keyed on Moodle identity in
  `metaJson`, and OCR adds a sibling artifact entity (NOT a column here), per
  the prototype's proven separation.
- Deleting a year cascades everything; deleting a subject only nulls
  `subjectId` — reviewer should confirm both behaviors in the migration SQL.
- Deferred: per-user storage quotas (needs `files` listing — cheap now),
  mobile upload + camera scanning (plan 006 informs it), materials search.
