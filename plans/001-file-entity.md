# Plan 001: Introduce a first-class `files` entity and a shared storage module

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat 46c966b..HEAD -- apps/server/src/db/schema apps/server/src/routers/profile.ts apps/server/src/routers/feedback.ts apps/server/src/lib`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: LOW-MED
- **Depends on**: none
- **Category**: tech-debt (foundation for course files, exam-copy scans, lecture audio)
- **Planned at**: commit `46c966b`, 2026-08-14

## Why this matters

Avermate is about to grow three file-heavy features (course materials, scanned
exam copies attached to grades, lecture recordings). Today the entire file
story is two ad-hoc TEXT URL columns — `users.avatarUrl`
(`apps/server/src/db/schema/auth.ts:16`) and `feedback.attachmentUrl`
(`apps/server/src/db/schema/app.ts:668`) — behind two independent UploadThing
call sites that each re-declare the same 2 MiB limit and MIME allowlist, and
recover the storage key by regex-parsing the URL. Nothing can list, quota,
garbage-collect, or re-process a file because nothing records that a file
exists. This plan adds one `files` table and one `lib/storage.ts` module, then
migrates the two existing call sites onto them, so every future file feature
references `files.id` by FK and inherits cleanup, constraints and listing.

## Current state

- `apps/server/src/routers/profile.ts:20-32` — avatar upload site:

  ```ts
  const uploads = env.UPLOADTHING_TOKEN
    ? new UTApi({ token: env.UPLOADTHING_TOKEN })
    : null;

  const MAX_BYTES = 2 * 1024 * 1024;
  const ALLOWED = ["image/png", "image/jpeg", "image/webp"];

  /** The file key inside an UploadThing URL, for deleting the old one. */
  function keyOf(url: string | null): string | null {
    if (!url) return null;
    const match = url.match(/\/f\/([^/?#]+)/);
    return match?.[1] ?? null;
  }
  ```

  The header comment at `profile.ts:11-18` records the deliberate decision to
  proxy the bytes through the API ("the upload token stays here, the file is
  already cropped and small by the time it is sent, and the previous avatar can
  be deleted in the same request"). Guards at `:63-71`: size, MIME,
  `!uploads || env.DISABLE_UPLOADS`. A capability probe exists at
  `profile.ts:117` (`uploadsEnabled`).

- `apps/server/src/routers/feedback.ts:113-158` — second, independent site:

  ```ts
  const uploads = env.UPLOADTHING_TOKEN
    ? new UTApi({ token: env.UPLOADTHING_TOKEN })
    : null;
  const MAX_IMAGE_BYTES = 2 * 1024 * 1024;
  const ALLOWED_IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp"];
  ```

  It uploads via `uploads.uploadFiles(new File([...]))`, keeps
  `upload.data.key` transiently for rollback (`:157`, `:175-183`), persists
  only `attachmentUrl` (`:168`), and discards the key.

- Schema conventions — `apps/server/src/db/schema/app.ts:24-36`:

  ```ts
  const timestamps = {
    createdAt: integer({ mode: "timestamp" }).notNull().$defaultFn(() => new Date()),
    updatedAt: integer({ mode: "timestamp" }).notNull().$defaultFn(() => new Date()),
  };

  const owner = () =>
    text()
      .notNull()
      .references(() => users.id, { onDelete: "cascade", onUpdate: "cascade" });
  ```

  IDs are prefixed nanoids: `newId(prefix)` from
  `apps/server/src/lib/id.ts:9-11` (see `$defaultFn(() => newId("ysetup"))` at
  `app.ts:175` for the usage shape). Schema files are re-exported flat from
  `apps/server/src/db/schema/index.ts`.

- Ownership convention — `apps/server/src/lib/ownership.ts` holds six
  near-identical `requireX(userId, id)` helpers, each
  `select().where(and(eq(t.id, id), eq(t.userId, userId))).limit(1)` throwing
  `notFound()`. The design note at `:14-20` says new routers must go through
  such helpers so "a new router can never forget the `userId` clause".
- Error helpers: `badRequest(msg)` / `notFound(what)` from
  `apps/server/src/lib/orpc.ts:35-41`. Procedures start from
  `protectedProcedure` (`lib/orpc.ts:11`).
- Env: `UPLOADTHING_TOKEN` optional at `apps/server/src/lib/env.ts:49`,
  `DISABLE_UPLOADS` at `:53`.
- Migrations: generated with `bun run db:generate`, applied with
  `bun run db:migrate`; 17 exist under `apps/server/drizzle/`.

## Commands you will need

| Purpose   | Command                          | Expected on success |
|-----------|----------------------------------|---------------------|
| Install   | `bun install --frozen-lockfile`  | exit 0              |
| Generate migration | `bun run db:generate`   | new SQL file under `apps/server/drizzle/` |
| Apply migrations | `bun run db:migrate`      | exit 0              |
| Typecheck | `bun run check-types`            | exit 0              |
| Server tests | `bun run --cwd apps/server test` | exit 0, all pass |
| All tests | `bun run test`                   | exit 0              |
| Lint/format | `bun run lint && bun run format:check` | exit 0        |

## Scope

**In scope** (the only files you should modify or create):
- `apps/server/src/db/schema/files.ts` (create)
- `apps/server/src/db/schema/index.ts` (add one export line)
- `apps/server/drizzle/*` (generated migration only — never hand-edit)
- `apps/server/src/lib/storage.ts` (create)
- `apps/server/src/lib/ownership.ts` (add `requireFile`)
- `apps/server/src/routers/profile.ts` (consume storage module)
- `apps/server/src/routers/feedback.ts` (consume storage module)
- `apps/server/src/lib/storage.test.ts` (create)

**Out of scope** (do NOT touch, even though they look related):
- Any client code (`apps/web`, `apps/mobile`) — the oRPC input/output shapes of
  `profile.uploadAvatar`, `profile.removeAvatar` and `feedback.submit` must not
  change; clients keep working unmodified.
- Presigned/direct-to-storage upload, resumable upload, per-user quotas, or a
  second storage provider — the presign-vs-proxy decision belongs to plan 005's
  spike. This plan keeps the existing proxy-through-API mechanics.
- Backfilling historical rows: existing `users.avatarUrl` /
  `feedback.attachmentUrl` values stay where they are and keep working; do NOT
  attempt a data migration of old URLs into `files` (deferred, see Maintenance
  notes).
- `apps/server/src/mcp/**` — no MCP exposure of files in this plan.

## Git workflow

- Branch: `advisor/001-file-entity` from `rewrite`.
- Conventional commits, e.g. `feat(server): first-class files table and shared storage module`.
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Create the `files` table

Create `apps/server/src/db/schema/files.ts`. Match the local dialect exactly
(`sqliteTable`, camelCase columns, `owner()`/`timestamps` spreads — copy the
import style from `app.ts`; note `owner` and `timestamps` are file-local consts
in `app.ts`, so re-declare them locally the same way or export them from a
shared location only if a trivial re-export exists — prefer local
re-declaration to keep the diff small):

```ts
export type FilePurpose = "avatar" | "feedback-attachment";
export type FileStatus = "stored" | "deleted";

export const files = sqliteTable(
  "files",
  {
    id: text().notNull().primaryKey().$defaultFn(() => newId("file")),
    /** Storage backend. Only "uploadthing" exists today. */
    provider: text().notNull().default("uploadthing"),
    /** Provider-native key — authoritative for deletion. Never regex a URL again. */
    storageKey: text().notNull(),
    url: text().notNull(),
    mimeType: text().notNull(),
    byteSize: integer().notNull(),
    purpose: text().$type<FilePurpose>().notNull(),
    status: text().$type<FileStatus>().notNull().default("stored"),
    userId: owner(),
    ...timestamps,
  },
  (t) => [
    index("files_user_id_idx").on(t.userId),
    index("files_purpose_idx").on(t.purpose),
    uniqueIndex("files_provider_key_unique").on(t.provider, t.storageKey),
  ],
);
```

Add `export * from "./files";` to `apps/server/src/db/schema/index.ts`.

**Verify**: `bun run db:generate` → a new migration SQL file appears creating
`files`; `bun run db:migrate` → exit 0; `bun run check-types` → exit 0.

### Step 2: Create `lib/storage.ts`

Create `apps/server/src/lib/storage.ts` owning:

1. The single `UTApi` instance (move the
   `env.UPLOADTHING_TOKEN ? new UTApi({...}) : null` construction here).
2. A per-purpose constraint map:

   ```ts
   export const FILE_CONSTRAINTS: Record<FilePurpose, { maxBytes: number; mimeTypes: readonly string[] }> = {
     avatar: { maxBytes: 2 * 1024 * 1024, mimeTypes: ["image/png", "image/jpeg", "image/webp"] },
     "feedback-attachment": { maxBytes: 2 * 1024 * 1024, mimeTypes: ["image/png", "image/jpeg", "image/webp"] },
   };
   ```

3. `storageEnabled(): boolean` — true when the client exists and
   `!env.DISABLE_UPLOADS` (single source for the current
   `!uploads || env.DISABLE_UPLOADS` checks and the `uploadsEnabled` probe).
4. `async storeFile(input: { userId: string; purpose: FilePurpose; file: File; nameHint?: string })`
   — validates size/MIME against `FILE_CONSTRAINTS[purpose]` with the existing
   `badRequest` messages, uploads via UTApi, inserts a `files` row
   (`storageKey` = `upload.data.key`, `url` = `upload.data.ufsUrl`), and
   returns the row. On DB insert failure, delete the uploaded object before
   rethrowing (preserve the rollback behavior at `feedback.ts:174-183`).
5. `async deleteFile(userId: string, fileId: string)` — `requireFile`, delete
   from the provider by `storageKey` (swallow provider errors the way
   `profile.removeAvatar` does today), then mark `status = "deleted"` and
   remove or keep the row (keep the row with `status="deleted"` so references
   stay resolvable; document this in the module header).
6. Keep a `legacyKeyOf(url)` helper — the current regex from
   `profile.ts:28-32`, verbatim, exported for the avatar transition path only,
   marked `@deprecated` with a pointer to the backfill deferral in this plan's
   Maintenance notes.

Add `requireFile` to `apps/server/src/lib/ownership.ts`, matching the shape of
the six existing helpers exactly (same naming, same `notFound("File")`).

**Verify**: `bun run check-types` → exit 0.

### Step 3: Migrate the avatar call site

In `apps/server/src/routers/profile.ts`:
- Delete the local `uploads`, `MAX_BYTES`, `ALLOWED`, `keyOf` declarations.
- `uploadAvatar`: call `storeFile({ userId, purpose: "avatar", file: input.image })`,
  then update `users.avatarUrl` to the new row's `url` as today. Deleting the
  previous avatar: if the old `avatarUrl` resolves to a `files` row (match on
  `url`), use `deleteFile`; otherwise fall back to `legacyKeyOf(oldUrl)` +
  provider delete, exactly as the current code does.
- `removeAvatar`: same dual path (files-row first, legacy regex fallback).
- `uploadsEnabled`: delegate to `storageEnabled()`.
- Do not change any input/output schema.

**Verify**: `bun run check-types` → exit 0;
`grep -n "new UTApi" apps/server/src/routers/profile.ts` → no matches.

### Step 4: Migrate the feedback call site

In `apps/server/src/routers/feedback.ts`: replace the local `uploads` /
`MAX_IMAGE_BYTES` / `ALLOWED_IMAGE_TYPES` and the inline `uploadFiles` +
rollback block (`:113-158`, `:174-185`) with one `storeFile({ userId, purpose:
"feedback-attachment", file: input.image, nameHint: ... })` call. Keep writing
`attachmentUrl` on the `feedback` row (same output shape); additionally the
`files` row now exists for future listing/GC. On the post-insert failure paths
that currently delete by `attachmentKey`, call `deleteFile` with the stored
row instead.

**Verify**: `bun run check-types` → exit 0;
`grep -rn "new UTApi" apps/server/src` → exactly one match, in `lib/storage.ts`.

### Step 5: Tests

Create `apps/server/src/lib/storage.test.ts`. Model the bootstrap after
`apps/server/src/routers/integrity.integration.test.ts:8-40` (force env before
imports, `DATABASE_URL="file::memory:"`, apply migrations from disk via
`$client.executeMultiple`, dynamic imports in `beforeAll`). Because no
UploadThing token is configured in tests, cover:

1. `storageEnabled()` is false without a token; `storeFile` throws the
   configured-error `badRequest` message.
2. Constraint validation: oversize file and disallowed MIME both throw before
   any provider call (construct `File` objects in-memory).
3. `FILE_CONSTRAINTS` covers every `FilePurpose` (compile-time via the
   `Record`, plus a runtime `Object.keys` assertion).
4. `requireFile` throws `notFound` for another user's row (insert a `files`
   row directly, query as a different user).
5. `legacyKeyOf` extracts the key from a representative UploadThing URL shape
   (`https://x.ufs.sh/f/<key>`) and returns null for junk.

**Verify**: `bun run --cwd apps/server test` → exit 0, including the new file.

### Step 6: Full gate

**Verify**: `bun run format:check && bun run lint && bun run check-types && bun run test && bun run build` → all exit 0.

## Test plan

Covered in Step 5. Structural pattern:
`apps/server/src/routers/integrity.integration.test.ts` (env-first bootstrap,
in-memory libSQL, migrations applied for real — so the new migration is itself
under test). No provider-network calls in tests; everything behind the missing
token guard or pure validation.

## Done criteria

Machine-checkable. ALL must hold:

- [ ] `files` table exists in a generated migration; `bun run db:migrate` exits 0 on a fresh DB
- [ ] `grep -rn "new UTApi" apps/server/src` → exactly 1 match (`lib/storage.ts`)
- [ ] `grep -rn "2 \* 1024 \* 1024" apps/server/src/routers` → no matches (constants live in `FILE_CONSTRAINTS`)
- [ ] `requireFile` exists in `lib/ownership.ts` and is used by `deleteFile`
- [ ] `bun run --cwd apps/server test` exits 0 with the new `storage.test.ts` passing
- [ ] `bun run format:check`, `bun run lint`, `bun run check-types`, `bun run test`, `bun run build` all exit 0
- [ ] No files outside the in-scope list are modified (`git status`)
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back (do not improvise) if:

- The oRPC input/output of `uploadAvatar`, `removeAvatar` or `feedback.submit`
  cannot be preserved exactly — client compatibility is a hard constraint.
- `owner()`/`timestamps` turn out to be exported from somewhere shared already
  (then use that export instead of re-declaring — but if neither exists as
  written at `app.ts:24-36`, the schema has drifted: STOP).
- The generated migration contains anything beyond creating `files` and its
  indexes (unexpected schema diff → the branch moved under you).
- UploadThing's `uploadFiles` response shape does not expose `key`/`ufsUrl` as
  used at `feedback.ts:156-157` (dependency drift).

## Maintenance notes

- Plans 005 (course materials) and 006 (grade↔copy attachments) add new
  `FilePurpose` values with larger `maxBytes` and PDF/audio MIME types — the
  constraint map and `files` table are designed for that; the *transport*
  (proxy vs presigned) is re-decided in plan 005's spike before any large-file
  purpose lands.
- Deferred deliberately: backfilling legacy `users.avatarUrl` /
  `feedback.attachmentUrl` into `files` (needs the same regex on historical
  URLs; do it opportunistically once file listing ships), per-user quotas, and
  a GC job for `status="deleted"` rows (plan 002's substrate is the natural
  home; see plans/README.md roadmap).
- Reviewer attention: the dual old/new avatar-deletion path in Step 3, and that
  no client bundle changed (`git status` should show no `apps/web`/`apps/mobile`
  modifications).
