# Plan 002: Add a durable background-job substrate (table, in-process runner, oRPC status surface)

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat 46c966b..HEAD -- apps/server/src/db/schema apps/server/src/index.ts apps/server/src/lib/env.ts apps/server/src/routers/index.ts apps/server/Dockerfile deploy.yml`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: L
- **Risk**: MED
- **Depends on**: none (001 recommended first only for plans that combine both)
- **Category**: tech-debt (foundation for OCR, transcription, Moodle sync, retention jobs)
- **Planned at**: commit `46c966b`, 2026-08-14

## Why this matters

The server has **no deferred-execution primitive at all**: no queue, cron,
worker or scheduler (verified by grep — the only `setInterval`/`Bun.spawn` hits
in `apps/server/src` are a test launcher). The runtime is a single Bun fetch
handler (`apps/server/src/index.ts:107-113`), the container runs one process
(`apps/server/Dockerfile` entrypoint: migrate then `exec bun run start`), and
`deploy.yml` defines exactly two services (`api`, `web`). Yet the
study-companion roadmap is dominated by minute-scale work: Mistral OCR of PDFs,
lecture-audio transcription, Moodle sync, LaTeX compilation. Without a
substrate these would run inline in oRPC handlers, holding HTTP connections
past proxy timeouts with no retry, progress or cancellation. Two existing
maintenance gaps also want it today: `mcpOperations` rows are written and never
reaped (`apps/server/src/db/schema/mcp.ts:18`), and the only retention job,
`purgeExpiredAutomaticFeedback` (`apps/server/src/routers/admin-feedback.ts:583-598`),
is a button an admin must remember to press.

## Current state

- Server entry — `apps/server/src/index.ts:107-113`:

  ```ts
  export default {
    port: env.PORT,
    // Every interface, so a phone on the same network can reach the API. ...
    hostname: "0.0.0.0",
    fetch: app.fetch,
  };
  ```

- The proven idempotency-ledger shape to copy —
  `apps/server/src/db/schema/app.ts:169-193` (`yearSetupRequests`): prefixed
  nanoid PK via `newId("ysetup")`, `idempotencyKey`, `inputHash`, `owner()`
  userId, `uniqueIndex(...).on(t.userId, t.idempotencyKey)`.
- Schema conventions: `timestamps` and `owner()` spreads at
  `apps/server/src/db/schema/app.ts:24-36`; schema files re-exported from
  `apps/server/src/db/schema/index.ts`; IDs via `newId(prefix)`
  (`apps/server/src/lib/id.ts:9-11`).
- Router registration: flat object at `apps/server/src/routers/index.ts:19-37`
  (17 keys); one new key registers a domain.
- Procedure/authz vocabulary: `protectedProcedure` / `adminProcedure` /
  `badRequest` / `notFound` in `apps/server/src/lib/orpc.ts` (41 lines).
- Ownership helpers in `apps/server/src/lib/ownership.ts` (six `requireX`
  functions; add `requireJob` in the same shape).
- Multi-row writes use `db.batch([...])`, not `db.transaction` — rationale
  recorded at `apps/server/src/routers/periods.ts:241` (libSQL batches are
  atomic). Match it.
- Env pattern — optional integrations plus `DISABLE_*` escape hatches declared
  in `apps/server/src/lib/env.ts` (see `DISABLE_EMAIL`/`DISABLE_UPLOADS` at
  `:52-53` with the comment "Escape hatches for local development").
- Integration-test bootstrap to copy:
  `apps/server/src/routers/integrity.integration.test.ts:8-40` — env forced
  before imports, `DATABASE_URL="file::memory:"`, migrations applied from disk,
  dynamic imports in `beforeAll`, `createRouterClient(appRouter, { context: {...} })`.
- `mcpOperations` (never reaped) — `apps/server/src/db/schema/mcp.ts:18`,
  unique `(userId, toolName, idempotencyKey)`, `status: pending|completed`.
- Manual retention job — `admin-feedback.ts:583-598`
  (`purgeExpiredAutomaticFeedback`, an `adminProcedure`).

## Commands you will need

| Purpose   | Command                          | Expected on success |
|-----------|----------------------------------|---------------------|
| Install   | `bun install --frozen-lockfile`  | exit 0              |
| Generate migration | `bun run db:generate`   | new SQL file under `apps/server/drizzle/` |
| Apply migrations | `bun run db:migrate`      | exit 0              |
| Typecheck | `bun run check-types`            | exit 0              |
| Server tests | `bun run --cwd apps/server test` | exit 0          |
| All gates | `bun run format:check && bun run lint && bun run check-types && bun run test && bun run build` | exit 0 |

## Scope

**In scope** (the only files you should modify or create):
- `apps/server/src/db/schema/jobs.ts` (create)
- `apps/server/src/db/schema/index.ts` (one export line)
- `apps/server/drizzle/*` (generated migration only)
- `apps/server/src/lib/jobs.ts` (create — queue API + runner)
- `apps/server/src/lib/jobs.test.ts` (create)
- `apps/server/src/lib/ownership.ts` (add `requireJob`)
- `apps/server/src/lib/env.ts` (+ `apps/server/.env.example`) — add `DISABLE_JOBS`
- `apps/server/src/routers/jobs.ts` (create) and `apps/server/src/routers/index.ts` (one line)
- `apps/server/src/index.ts` (start the runner)
- `apps/server/src/jobs/handlers.ts` (create — registry with the two seed handlers)

**Out of scope** (do NOT touch, even though they look related):
- `deploy.yml`, `apps/server/Dockerfile` — the runner is **in-process** in this
  plan; a dedicated worker container is a documented follow-up, not now.
- Any OCR / transcription / Moodle logic — those are future consumers.
- `apps/server/src/mcp/**` — no MCP job tools yet (plan 003 restructures that
  file first).
- Client apps — no UI in this plan; the oRPC surface is enough for later use.
- `admin-feedback.ts` — do not remove the manual purge procedure; the seed
  handler *calls* the same underlying logic (import/reuse), the button stays.

## Git workflow

- Branch: `advisor/002-jobs-substrate` from `rewrite`.
- Conventional commits, e.g. `feat(server): durable job queue with in-process runner`.
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: `jobs` table

Create `apps/server/src/db/schema/jobs.ts` following the `yearSetupRequests`
shape (`app.ts:169-193`) and local conventions:

```ts
export type JobStatus = "queued" | "running" | "succeeded" | "failed" | "cancelled";

export const jobs = sqliteTable(
  "jobs",
  {
    id: text().notNull().primaryKey().$defaultFn(() => newId("job")),
    kind: text().notNull(),                       // e.g. "maintenance.reapMcpOperations"
    payload: text({ mode: "json" }).$type<unknown>(),
    payloadVersion: integer().notNull().default(1),
    status: text().$type<JobStatus>().notNull().default("queued"),
    attempts: integer().notNull().default(0),
    maxAttempts: integer().notNull().default(3),
    runAt: integer({ mode: "timestamp" }).notNull().$defaultFn(() => new Date()),
    lockedUntil: integer({ mode: "timestamp" }),  // lease; null when unclaimed
    lockedBy: text(),                             // runner instance id
    idempotencyKey: text(),
    result: text({ mode: "json" }).$type<unknown>(),
    error: text(),
    userId: owner(),                              // system jobs use a dedicated system user? NO —
                                                  // see Step 1 note below
    ...timestamps,
  },
  (t) => [
    index("jobs_status_run_at_idx").on(t.status, t.runAt),
    index("jobs_user_id_idx").on(t.userId),
    uniqueIndex("jobs_user_kind_key_unique").on(t.userId, t.kind, t.idempotencyKey),
  ],
);
```

Note on `userId`: maintenance jobs have no owning user. Make `userId`
**nullable** (`text().references(() => users.id, { onDelete: "cascade" })`
without `.notNull()` — i.e. do NOT use the `owner()` spread here) and adjust
the unique index accordingly; document in the table's doc comment that
user-null rows are system jobs, invisible to the user-facing router. The
JSON columns follow the repo's typed-JSON rule (`text({ mode: "json" })
.$type<T>()` + a version integer — the `dashboardCards.definitionJson`
convention at `app.ts:507-508`).

**Verify**: `bun run db:generate` → migration creating `jobs`;
`bun run db:migrate` → exit 0; `bun run check-types` → exit 0.

### Step 2: Queue API and runner in `lib/jobs.ts`

Implement:

- `registerJobHandler(kind: string, handler: (ctx: { payload: unknown; jobId: string; signal?: AbortSignal }) => Promise<unknown>)`
  — module-level registry map; throws on duplicate kind.
- `enqueueJob({ kind, payload, userId?, idempotencyKey?, runAt?, maxAttempts? })`
  — inserts with `onConflictDoNothing()` against the unique index; on conflict,
  return the existing row (mirrors the replay-fence read at
  `mcp/server.ts:302-311`). Returns the row.
- `claimNextJob(instanceId, now)` — the lease claim, one conditional UPDATE:
  set `status='running'`, `lockedBy=instanceId`,
  `lockedUntil = now + LEASE_MS`, `attempts = attempts + 1` on the oldest row
  where `status='queued' AND runAt <= now`, OR `status='running' AND
  lockedUntil < now` (lease expired → retryable takeover). Use a single
  `db.update(...).where(...)` with a subquery/`returning()`; with libSQL there
  is one writer, so the conditional update is the race guard.
- `completeJob(jobId, result)` / `failJob(jobId, error)` — `failJob` re-queues
  (`status='queued'`, `runAt = now + backoff(attempts)`) while
  `attempts < maxAttempts`, else `status='failed'`. Exponential backoff capped
  at 5 minutes.
- `startJobRunner({ instanceId, intervalMs = 2000 })` — `setInterval` loop:
  claim → look up handler by `kind` → run → complete/fail. Unknown kind →
  `failJob` immediately with a clear error (no retry). Guard the whole tick in
  try/catch so the loop never dies. Return a `stop()` handle (clearInterval)
  for tests.
- Respect `env.DISABLE_JOBS` (Step 4): `startJobRunner` becomes a no-op
  returning a dummy handle.

Lease constant `LEASE_MS = 60_000`. Handlers longer than the lease must be
split by their own plans; document this limit in the module header comment.

**Verify**: `bun run check-types` → exit 0.

### Step 3: Seed handlers

Create `apps/server/src/jobs/handlers.ts` exporting `registerAllJobHandlers()`
which registers two maintenance handlers:

1. `"maintenance.reapMcpOperations"` — delete `mcpOperations` rows with
   `status='completed'` older than 30 days, and rows with `status='pending'`
   older than 7 days (a pending row that old is a dead confirmation; the MRTR
   codec TTL is 10 minutes, so nothing legitimate survives 7 days). Return
   `{ deleted: n }`.
2. `"maintenance.purgeExpiredAutomaticFeedback"` — reuse the exact logic of
   `admin-feedback.ts:583-598` (import the shared helper if one exists;
   otherwise extract the query into a small function both call — extraction is
   allowed inside `admin-feedback.ts` for this purpose only, keeping the
   procedure's behavior identical).

In `apps/server/src/index.ts`, before the `export default`, call
`registerAllJobHandlers()` and `startJobRunner({ instanceId: crypto.randomUUID() })`,
and schedule the two maintenance jobs on boot with `enqueueJob` using
`idempotencyKey` = the current UTC date (`YYYY-MM-DD`) so restarts within a day
do not duplicate them, with a self-re-enqueue at the end of each handler for
the next day (`runAt` = now + 24h, key = next date). Keep this block ~10 lines;
the point is the substrate, not a cron DSL.

**Verify**: `bun run check-types` → exit 0.

### Step 4: Env switch

In `apps/server/src/lib/env.ts`, add `DISABLE_JOBS: bool` beside
`DISABLE_EMAIL`/`DISABLE_UPLOADS` (`:52-53`) with the same comment style, and
document it in `apps/server/.env.example`. The two integration-test bootstraps
must not start a runner: they import the app module? They do NOT import
`index.ts` (they build `createRouterClient(appRouter, ...)` directly), so no
test change is required — verify that assumption by grepping the two test
bootstraps for `from "../index"` / `from "./index"`; if any test imports the
server entry, set `DISABLE_JOBS` there.

**Verify**: `grep -rn "DISABLE_JOBS" apps/server/src/lib/env.ts apps/server/.env.example` → both present.

### Step 5: `jobs` router

Create `apps/server/src/routers/jobs.ts` modeled on
`apps/server/src/routers/goals.ts` (input schema first, `protectedProcedure`,
ownership as the first line):

- `get: protectedProcedure.input(z.object({ jobId: z.string() }))` →
  `requireJob(userId, jobId)` (add to `lib/ownership.ts` in the six-helper
  shape; it must also exclude `userId IS NULL` system rows) → return the row
  minus `lockedBy`/`lockedUntil`.
- `list: protectedProcedure.input(z.object({ kinds: z.array(z.string()).optional(), limit: z.number().int().min(1).max(50).default(20) }))`
  → the caller's jobs, newest first.
- `cancel: protectedProcedure.input(z.object({ jobId: z.string() }))` →
  `requireJob`, allowed only from `queued` (set `status='cancelled'`);
  `badRequest` otherwise. (Cancelling `running` jobs needs cooperative
  cancellation — deferred; document in Maintenance notes.)

Register `jobs: jobsRouter` in `apps/server/src/routers/index.ts`.

**Verify**: `bun run check-types` → exit 0.

### Step 6: Tests

Create `apps/server/src/lib/jobs.test.ts` using the
`integrity.integration.test.ts` bootstrap pattern (env-first, in-memory DB,
migrations from disk, dynamic imports). Do NOT start the interval runner in
tests — drive `claimNextJob`/handlers manually. Cover:

1. enqueue → claim → complete happy path (status transitions, result stored).
2. Idempotent enqueue: same `(userId, kind, idempotencyKey)` twice → one row.
3. Retry: handler throws → `failJob` re-queues with backoff until
   `maxAttempts`, then `failed` with `error` set.
4. Lease takeover: a `running` row with expired `lockedUntil` is claimable; an
   unexpired one is not.
5. Unknown kind → immediate `failed`, no retry.
6. Router ownership: user A cannot `get`/`cancel` user B's job (`notFound`);
   system rows (`userId` null) are invisible to `list`.
7. The two seed handlers: insert an old completed `mcpOperations` row and an
   expired automatic feedback row directly, run the handlers, assert deletion
   — model fixture insertion on `integrity.integration.test.ts:43-122`.

**Verify**: `bun run --cwd apps/server test` → exit 0 including the new file.

### Step 7: Full gate

**Verify**: `bun run format:check && bun run lint && bun run check-types && bun run test && bun run build` → all exit 0.

## Test plan

Covered in Step 6; structural pattern is
`apps/server/src/routers/integrity.integration.test.ts`. The migration is
exercised for real by the bootstrap. No timers in tests (drive ticks manually)
— the repo's suites must stay deterministic.

## Done criteria

Machine-checkable. ALL must hold:

- [ ] `jobs` table exists via generated migration; fresh `bun run db:migrate` exits 0
- [ ] `grep -n "startJobRunner" apps/server/src/index.ts` → 1 match
- [ ] `jobs` key present in `apps/server/src/routers/index.ts`
- [ ] `DISABLE_JOBS` declared in `env.ts` and `.env.example`
- [ ] `bun run --cwd apps/server test` exits 0 with `jobs.test.ts` passing (≥7 tests)
- [ ] All root gates (`format:check`, `lint`, `check-types`, `test`, `build`) exit 0
- [ ] No files outside the in-scope list are modified (`git status`)
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back (do not improvise) if:

- Either integration-test bootstrap imports the server entry module (then the
  runner would start inside tests — apply the `DISABLE_JOBS` note in Step 4
  and report the deviation).
- `db.batch` / conditional-UPDATE claiming cannot express the lease takeover
  atomically against libSQL (evidence: a failing concurrent test) — do not
  substitute `db.transaction` without reporting; the repo deliberately avoids
  open transactions (`periods.ts:241`).
- The `purgeExpiredAutomaticFeedback` logic cannot be reused without changing
  the admin procedure's observable behavior.
- Migration generation produces unrelated diffs.

## Maintenance notes

- Future consumers (planned): Moodle sync, Mistral OCR, transcription, LaTeX
  compilation — each registers a handler and enqueues with an idempotency key;
  none should raise `LEASE_MS` without splitting work into resumable steps.
- The runner is deliberately in-process. When job volume or CPU isolation
  demands it, the follow-up is a second container running the same image with a
  `bun run worker` entrypoint and the HTTP server disabled — at that point add
  the service to `deploy.yml` and make `instanceId` meaningful in ops.
- Cooperative cancellation of `running` jobs (AbortSignal plumbed to handlers)
  is stubbed in the handler signature but not enforced — wire it when the first
  minutes-long handler (OCR) lands.
- Reviewer attention: the claim UPDATE's WHERE clause (both branches), and that
  boot-time scheduling cannot double-run after a same-day restart.
