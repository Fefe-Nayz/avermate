# Plan 006: Attach scanned exam copies to grades

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat 46c966b..HEAD -- apps/server/src/db/schema apps/server/src/routers/grades.ts apps/server/src/lib apps/web/src/app apps/web/src/components/grades`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition. This plan REQUIRES plan 001 DONE
> (`files` + `lib/storage.ts`); verify its Done criteria first.

## Status

- **Priority**: P2
- **Effort**: S-M
- **Risk**: LOW
- **Depends on**: plans/001-file-entity.md (hard); plans/003-mcp-modular-surfaces.md (soft — only for the optional MCP read exposure)
- **Category**: direction
- **Planned at**: commit `46c966b`, 2026-08-14

## Why this matters

"Associer une note à une copie" is a named product goal of the study-companion
merge: when a graded paper comes back, photograph or upload the PDF of the
copy and find it later from the grade. The schema seam already exists —
`grades.note` (`apps/server/src/db/schema/app.ts:320`) is the only free-text
field on a grade, and a grade already carries `subjectId` + `periodId` +
`yearId` + `passedAt` — so the whole feature is one join table onto the
plan-001 `files` entity plus UI on the grade detail screens. It is the
smallest user-visible payoff of the new file infrastructure and exercises it
end to end (multi-attachment, image+PDF, deletion cleanup) before the larger
materials flows land.

## Current state

- `grades` table — `apps/server/src/db/schema/app.ts:304-346`: `value`,
  `outOf`, `coefficient`, `passedAt` (indexed at `:344`), `note: text()` at
  `:320`; owned via `userId` + `yearId` FKs.
- Grades router — `apps/server/src/routers/grades.ts`: `get:82`, `recent:94`,
  `create:121`, `update:189`, `reassign:291`, `delete:368`. `delete`
  currently removes the grade row (components cascade); it must now also clean
  provider objects (Step 3).
- Plan-001 kit (verify present): `files` table, `FILE_CONSTRAINTS`,
  `storeFile`, `deleteFile`, `requireFile` in
  `apps/server/src/lib/{storage.ts,ownership.ts}`.
- Ownership convention: `requireGrade(userId, gradeId)` at
  `apps/server/src/lib/ownership.ts:42`.
- Web grade detail: `apps/web/src/app/(app)/grades/[gradeId]/` (detail) and
  `.../edit`; the mutation pattern exemplar is
  `apps/web/src/components/grades/grade-form.tsx:210-226`
  (`useMutation({ ...orpc.grades.x.mutationOptions(), onSuccess })` → haptic →
  toast → invalidate → navigate). Grade mutations today invalidate
  `orpc.snapshot.get` — attachment mutations must NOT (attachments are not in
  the snapshot; invalidate only the new attachment query keys).
- Upload UI mechanics exemplar: `apps/web/src/components/settings/avatar-editor.tsx:156`
  (hidden `<input type="file">` → `File` → oRPC input). Feedback's optional
  image (`apps/web/src/components/feedback/feedback-provider.tsx:199`) shows
  the no-crop variant.
- Mobile grade screens live under `apps/mobile/app/grade/`;
  `apps/mobile/lib/image-file.ts` wraps `expo-image-picker` (library
  permission only; camera permission is NOT currently requested —
  `apps/mobile/app.json:57` sets `"microphonePermission": false` in the
  image-picker plugin block and no camera-permission string exists).
- i18n: en/fr together on web (`apps/web/messages/`), hand-map on mobile
  (`apps/mobile/lib/i18n.ts`).

## Commands you will need

| Purpose   | Command                          | Expected on success |
|-----------|----------------------------------|---------------------|
| Install   | `bun install --frozen-lockfile`  | exit 0              |
| Migration | `bun run db:generate` then `bun run db:migrate` | exit 0 |
| Typecheck | `bun run check-types`            | exit 0              |
| Server tests | `bun run --cwd apps/server test` | exit 0          |
| All gates | `bun run format:check && bun run lint && bun run check-types && bun run test && bun run build` | exit 0 |

## Scope

**In scope**:
- `apps/server/src/db/schema/files.ts` (extend `FilePurpose` with `"grade-copy"`) — or wherever plan 001 declared the type
- `apps/server/src/lib/storage.ts` (add the `grade-copy` constraint entry)
- `apps/server/src/db/schema/app.ts` OR a new `db/schema/grade-attachments.ts` (prefer the new file) + index export + migration
- `apps/server/src/routers/grades.ts` (attachment procedures + delete cleanup)
- `apps/server/src/routers/grades-attachments.test.ts` (create)
- `apps/web/src/app/(app)/grades/[gradeId]/**` + `apps/web/src/components/grades/**` (attachment section) + `messages/{en,fr}.json`
- `apps/mobile/app/grade/**` (attachment list + add from library) + `apps/mobile/lib/i18n.ts`
- OPTIONAL (only if plan 003 DONE): `apps/server/src/mcp/surfaces/` read tool + harness/docs updates

**Out of scope** (do NOT touch):
- Camera capture / document-scanning UX on mobile (needs a camera permission
  + plugin change and a prebuild — deferred; library picker only).
- OCR of the copy, annotation, or any processing.
- `gradeComponents`, `snapshot.get`, the widget system.
- Changing any existing `grades.*` procedure input/output shape (additive
  only; `delete` keeps its shape, gains cleanup).

## Git workflow

- Branch: `advisor/006-grade-copy-attachments` from `rewrite`.
- Conventional commits, e.g. `feat(server): grade copy attachments`,
  `feat(web): attach copies to a grade`.
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Schema + purpose

Create `apps/server/src/db/schema/grade-attachments.ts`:

```ts
export const gradeAttachments = sqliteTable(
  "grade_attachments",
  {
    id: text().notNull().primaryKey().$defaultFn(() => newId("gatt")),
    gradeId: text().notNull().references(() => grades.id, { onDelete: "cascade", onUpdate: "cascade" }),
    fileId: text().notNull().references(() => files.id, { onDelete: "restrict", onUpdate: "cascade" }),
    /** Display label; defaults to the uploaded file name client-side. */
    label: text(),
    sortOrder: integer().notNull().default(0),
    userId: owner(),
    ...timestamps,
  },
  (t) => [
    index("grade_attachments_grade_idx").on(t.gradeId),
    uniqueIndex("grade_attachments_grade_file_unique").on(t.gradeId, t.fileId),
  ],
);
```

Extend `FilePurpose` with `"grade-copy"` and add to `FILE_CONSTRAINTS`:
`{ maxBytes: 25 * 1024 * 1024, mimeTypes: ["application/pdf", "image/png", "image/jpeg", "image/webp", "image/heic"] }`.
(HEIC because iPhone photos of paper copies arrive as HEIC; if plan 001's
validation rejects unknown-to-UploadThing types, drop HEIC and note it.)

**Verify**: `bun run db:generate` + `bun run db:migrate` + `bun run check-types` → exit 0.

### Step 2: Router procedures

In `apps/server/src/routers/grades.ts`, add (following the file's existing
style — ownership first, `badRequest`/`notFound`):

- `attachments: protectedProcedure.input(z.object({ gradeId: z.string() }))`
  → `requireGrade` → join `gradeAttachments` ↔ `files`, return
  `{ id, label, sortOrder, file: { id, url, mimeType, byteSize } }[]` ordered
  by `sortOrder, createdAt`.
- `attachCopy: protectedProcedure.input(z.object({ gradeId: z.string(), file: z.instanceof(File), label: z.string().trim().max(120).optional() }))`
  → `requireGrade` → `storeFile({ userId, purpose: "grade-copy", file })` →
  insert row (sortOrder = max+1, the `goals.ts:95-98` reduce pattern). Cap:
  `badRequest` when the grade already has 10 attachments.
- `removeCopy: protectedProcedure.input(z.object({ attachmentId: z.string() }))`
  → load the attachment row filtered by `userId` (`notFound` otherwise) →
  delete row → `deleteFile(userId, fileId)`.
- Extend `grades.delete` (at `:368`): before deleting the grade, collect its
  attachment `fileId`s, delete the grade (row cascade removes attachment
  rows), then `deleteFile` each collected id (provider cleanup; swallow
  per-file provider errors the way plan 001's `deleteFile` does).

**Verify**: `bun run check-types` → exit 0.

### Step 3: Server tests

`apps/server/src/routers/grades-attachments.test.ts` on the
`integrity.integration.test.ts:8-130` bootstrap: attach with uploads
unconfigured → `badRequest`; fixture-insert `files` + `gradeAttachments` rows
directly, then: `attachments` returns the join shape; ownership isolation
(user B `notFound` on user A's grade/attachment); the 10-cap; `removeCopy`
marks the file row deleted; `grades.delete` leaves no attachment rows and
marks all files deleted; unique `(gradeId, fileId)` enforced.

**Verify**: `bun run --cwd apps/server test` → exit 0.

### Step 4: Web UI

On the grade detail screen (`apps/web/src/app/(app)/grades/[gradeId]/`), add a
"Copies" section: thumbnail/row list from `orpc.grades.attachments`, an add
button (hidden file input per the avatar/feedback mechanics — no crop), a
remove action with confirm dialog, open-in-new-tab on click (`file.url`).
Prefetch `grades.attachments` in the detail page's server component beside its
existing queries (factory in `route-query-inputs.ts`). Mutations invalidate
ONLY `orpc.grades.attachments` for that grade — not the snapshot. Show the
uploads-disabled state via the existing capability probe pattern. en/fr
messages together.

**Verify**: `bun run lint && bun run check-types` → exit 0; manual: with a
token configured, attach a PDF and an image to a grade, reload, both listed,
remove one.

### Step 5: Mobile UI

In the grade detail screen under `apps/mobile/app/grade/`, add the same
section: list, add via `expo-image-picker` (library; reuse
`apps/mobile/lib/image-file.ts`), open via `Linking.openURL`, remove with
confirm. PDF picking from mobile is allowed if `expo-document-picker` is
ALREADY a dependency — check `apps/mobile/package.json`; if absent, image-only
on mobile and note it in the screen comment (adding deps is out of scope).
Strings to `apps/mobile/lib/i18n.ts` with French.

**Verify**: `bun run check-types` → exit 0; from `apps/mobile`:
`bunx expo export --platform all` → exit 0.

### Step 6 (OPTIONAL — only if plan 003 is DONE): MCP read exposure

Add `grades.attachments` as a read tool on the existing academic read surface
(`mcp/surfaces/read.ts`), returning labels + URLs. No new scope (covered by
`avermate:read`); update harness enumerations + `docs/mcp.md` surface list.
Skip entirely if 003 is not DONE; note the skip in `plans/README.md`.

**Verify**: `bun run --cwd apps/server test` → exit 0.

### Step 7: Full gate

**Verify**: `bun run format:check && bun run lint && bun run check-types && bun run test && bun run build` → all exit 0.

## Test plan

Server per Step 3 (≥8 cases; structural pattern
`integrity.integration.test.ts`). Web/mobile: manual smoke per Steps 4–5; any
pure list/ordering logic extracted into colocated tested modules per the
`components/cards/` convention.

## Done criteria

Machine-checkable. ALL must hold:

- [ ] Migration creates `grade_attachments`; fresh `bun run db:migrate` exits 0
- [ ] `grade-copy` present in `FILE_CONSTRAINTS`
- [ ] `grades.attachments` / `attachCopy` / `removeCopy` exist; `grades.delete` cleans provider files
- [ ] `grades-attachments.test.ts` passes; `bun run --cwd apps/server test` exits 0
- [ ] Web grade detail shows the Copies section; attachment mutations do not invalidate `snapshot.get` (grep the new components for `snapshot`)
- [ ] `bunx expo export --platform all` exits 0
- [ ] All root gates exit 0; `git status` clean outside scope
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back (do not improvise) if:

- Plan 001's kit is absent or `FilePurpose` is not extensible as described.
- `z.instanceof(File)` uploads fail for PDFs at the 25 MB cap in local testing
  (transport ceiling — report; the fix belongs to plan 005's storage decision,
  not here).
- Extending `grades.delete` would change its observable success/error shape.
- The mobile picker cannot produce a `File`-compatible payload for the oRPC
  input without new dependencies.

## Maintenance notes

- The camera/document-scan capture flow (mobile) is the natural follow-up and
  will need an `expo-camera`/scanner plugin + permission strings + prebuild —
  plan it together with lecture recording (same permission/prebuild wave; see
  plans/README.md roadmap).
- OCR of copies (searchable text, error analysis against the course) plugs in
  later via the jobs substrate; the `gradeAttachments.fileId` →
  future-artifact seam mirrors materials' design.
- Reviewer attention: provider cleanup ordering in `grades.delete` (collect
  before cascade), and the `(gradeId, fileId)` unique index protecting against
  double-attach replays.
