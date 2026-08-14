# Plan 004: Build the agenda/todo domain (planner items + unified agenda read model + kanban board + MCP surface)

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat 46c966b..HEAD -- apps/server/src/db/schema apps/server/src/routers apps/server/src/lib/ownership.ts apps/server/src/lib/auth.ts apps/server/src/mcp apps/web/src/lib/nav.ts apps/web/src/components/grades/grade-calendar.tsx docs/ssr-data-loading.md`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P2 (first user-visible increment of the study-companion merge)
- **Effort**: L
- **Risk**: MED
- **Depends on**: plans/003-mcp-modular-surfaces.md (for the MCP step; steps 1–6 can proceed without it)
- **Category**: direction
- **Planned at**: commit `46c966b`, 2026-08-14

## Why this matters

The product vision ("compagnon des études") starts with an agenda/todo:
homework due dates, exams ("DS"), and personal tasks alongside the grade data
avermate already has. The schema is unusually close: `periods` are named date
ranges (`app.ts:232`), `goals` carry `dueAt`/`achievedAt` (`app.ts:459-460`),
`grades.passedAt` is an indexed dated event (`app.ts:322`), and the web grades
screen already offers a calendar layout. What's missing is one table for
user-created planner items, a read model that unifies the four dated sources,
and the UI. This is the cheapest vision feature — it needs no file storage, no
jobs, no OCR — so it ships first and establishes the "feature-scoped read
model" convention that every later domain (materials, documents) will copy.

## Current state

### Server

- Schema conventions: `timestamps` + `owner()` at
  `apps/server/src/db/schema/app.ts:24-36`; prefixed nanoids via
  `newId(prefix)` (`lib/id.ts:9-11`); schema files re-exported from
  `db/schema/index.ts`.
- Router exemplar to copy — `apps/server/src/routers/goals.ts`:
  - input schema first (`goals.ts:19-31`), reused via
    `.partial().extend({...})` for update;
  - every handler starts with an ownership call
    (`await requireYear(context.session.user.id, input.yearId)` at `:64`);
  - cross-entity references re-checked with `assertSameYear`
    (`validateGoalScope`, `:33-58`);
  - errors via `badRequest`/`notFound` only; inserts write
    `userId: context.session.user.id`; multi-row writes use `db.batch`.
- Ownership helpers: `apps/server/src/lib/ownership.ts` (six `requireX`
  functions; add `requirePlannerItem` in that exact shape).
- Router registration: one key in `apps/server/src/routers/index.ts:19-37`.
- MCP: after plan 003, a new domain = one module under
  `apps/server/src/mcp/surfaces/` + one ordered entry in
  `surfaces/index.ts` + a scope in `lib/auth.ts:24-32` (`MCP_SCOPES`), plus
  harness enumeration updates and `docs/mcp.md` tables. Destructive tools wrap
  handlers in `runDestructive` (moved to `mcp/shared.ts` by plan 003) and take
  a required `idempotencyKey: z.string().uuid()`.
- Integration-test bootstrap to copy:
  `apps/server/src/routers/integrity.integration.test.ts:8-130`.

### Web

- Navigation is declared once — `apps/web/src/lib/nav.ts:14-20`:

  ```ts
  /**
   * The app's routes, declared once.
   *
   * The sidebar, the mobile tab bar, the breadcrumb and the command palette all
   * read from this list, so a new screen appears in every navigation surface at
   * the same time and can never be reachable from only one of them.
   */
  ```

  `NAV_ENTRIES` starts at `:34` (`/dashboard`, `/subjects`, `/grades`,
  `/goals`, `/insights`, `/social`, `/review`, `/settings`, …). Add `/agenda`
  after `/goals`.
- SSR data loading — `docs/ssr-data-loading.md` holds 5 numbered design rules;
  the cleanest page exemplar is
  `apps/web/src/app/(app)/announcements/page.tsx`: server page calls
  `prepareAuthenticatedShell()` (`apps/web/src/lib/authenticated-data.ts`),
  `queryClient.fetchQuery({ ...getServerOrpc().x.queryOptions({ input }), staleTime })`,
  returns `<HydrateClient queryClient={...}><XClient/></HydrateClient>`
  (`apps/web/src/lib/query-server.tsx`). Shared inputs are factored into
  `apps/web/src/lib/route-query-inputs.ts` so server and client hydrate the
  same key.
- **Constraint (recorded architecture decision)**: nearly all reads flow
  through the monolithic `snapshot.get` materialized by
  `apps/web/src/components/year/year-provider.tsx` (`useYear()`); ~94 mutation
  sites invalidate its key wholesale. The agenda must NOT join that snapshot —
  it is the first *feature-scoped read model*: its own oRPC namespace, its own
  query-input factory, its own page-level prefetch, and mutations invalidate
  ONLY agenda keys. Write this convention down (Step 6 adds design rule 6 to
  `docs/ssr-data-loading.md`).
- Calendar reuse — `apps/web/src/components/grades/grade-calendar.tsx`:
  - the header comment (`:24-38`) records the deliberate REMOVAL of a general
    scheduling calendar (time grids, drag/resize, recurrence) — colours must
    mean something and days bucket locally. An agenda here is a month grid +
    day list, NOT a time-grid scheduler. Honor that decision.
  - the grade-free pieces are already exported: `dayKey(date)` and
    `monthGrid(month, weekStartsOn)`; grade-specific pieces are
    `groupGradesByDay`, the `GradeCalendar({grades})` component and the
    `BAND_CHIP`/`BAND_DOT` palettes (`:40-54`).
  - covered by `grade-calendar.test.ts` beside it.
- Feature-folder exemplar: `apps/web/src/components/cards/` — logic in pure
  colocated modules with `.test.ts`, thin view components.
- Forms: shared multi-step `FormFlow` under
  `apps/web/src/components/forms/`; convention: choices may live in a sheet,
  input never does — create/edit are full-screen routes (`/grades/new` is the
  pattern; `apps/web/src/components/grades/grade-form.tsx:210-226` shows the
  mutation pattern: `useMutation({ ...orpc.x.y.mutationOptions(), onSuccess })`
  → `haptic()` → toast → targeted `invalidateQueries` → `router.push`).
- i18n: add English/French messages together
  (`apps/web/messages/{en,fr}.json`, used via next-intl `useExtracted`).

### Mobile

- Expo Router: five plain tabs at `apps/mobile/app/(tabs)/_layout.tsx`; other
  features are stack routes (e.g. `apps/mobile/app/goal/`). Mobile duplicates
  web UI by hand (only `@avermate/core` is shared); strings are hand-added to
  `apps/mobile/lib/i18n.ts` (missing entries silently fall back to English).
  Mobile scope in this plan is deliberately minimal: one list screen + CRUD.

## Commands you will need

| Purpose   | Command                          | Expected on success |
|-----------|----------------------------------|---------------------|
| Install   | `bun install --frozen-lockfile`  | exit 0              |
| Migration | `bun run db:generate` then `bun run db:migrate` | exit 0 |
| Typecheck | `bun run check-types`            | exit 0              |
| Server tests | `bun run --cwd apps/server test` | exit 0          |
| Web dev   | `bun run dev:web` (API via `bun run dev:server`) | serves on :3000 |
| All gates | `bun run format:check && bun run lint && bun run check-types && bun run test && bun run build` | exit 0 |

## Scope

**In scope**:
- `apps/server/src/db/schema/planner.ts` (create) + `db/schema/index.ts` export + generated migration
- `apps/server/src/lib/ownership.ts` (add `requirePlannerItem`)
- `apps/server/src/routers/planner.ts` (create) + `routers/index.ts` (one line)
- `apps/server/src/routers/planner.test.ts` (create)
- `apps/server/src/lib/auth.ts` (add `avermate:planner.read` + `avermate:planner.write` to `MCP_SCOPES`)
- `apps/server/src/mcp/surfaces/planner.ts` (create) + `surfaces/index.ts` (one entry) + harness enumerations + `docs/mcp.md` tables
- `docs/ssr-data-loading.md` (add design rule 6: feature-scoped read models)
- `apps/web/src/components/calendar/month-grid.ts` (create — extraction) and `grade-calendar.tsx` (consume it)
- `apps/web/src/app/(app)/agenda/**` (create: page, new/edit routes) + `apps/web/src/components/agenda/**` + `apps/web/src/lib/nav.ts` (one entry) + `route-query-inputs.ts` + `messages/{en,fr}.json`
- `apps/mobile/app/agenda/**` (create: list + create/edit screens) + `apps/mobile/lib/i18n.ts` strings

**Out of scope** (do NOT touch):
- Recurrence rules, reminders/notifications, ICS/CalDAV import-export — a
  later increment; the schema leaves room (see Step 1) but no code.
- The widget system (`packages/core/widget-registry.ts` is a closed world —
  `WIDGET_CAPABILITIES` size-asserts against `CARD_METRICS`; adding an agenda
  widget is a core change deferred to its own plan).
- `snapshot.get` and `year-provider.tsx` — the agenda must not be added to the
  snapshot.
- Time-grid/scheduler UI or any drag-resize calendar library — contradicts the
  recorded decision in `grade-calendar.tsx:24-38`.
- `goals`, `periods`, `grades` tables — read-only sources for the unified feed.

## Git workflow

- Branch: `advisor/004-agenda-domain` from `rewrite`.
- Conventional commits, e.g. `feat(server): planner items and agenda feed`,
  `feat(web): agenda space`, `feat(mobile): agenda screens`.
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: `plannerItems` table

`apps/server/src/db/schema/planner.ts`, matching local dialect:

```ts
export type PlannerItemKind = "task" | "event";
export type PlannerTaskStatus = "todo" | "doing" | "done";

export const plannerItems = sqliteTable(
  "planner_items",
  {
    id: text().notNull().primaryKey().$defaultFn(() => newId("plan")),
    kind: text().$type<PlannerItemKind>().notNull().default("task"),
    title: text().notNull(),                       // z-validated 1..160
    notes: text(),                                  // plain text, like grades.note
    /** Tasks: due date. Events: start. Nullable = unscheduled backlog task. */
    startsAt: integer({ mode: "timestamp" }),
    /** Events only; null for tasks and all-day events. */
    endsAt: integer({ mode: "timestamp" }),
    allDay: integer({ mode: "boolean" }).notNull().default(true),
    /** Tasks only — the kanban lane. Events stay "todo" and never surface it. */
    status: text().$type<PlannerTaskStatus>().notNull().default("todo"),
    /** Set exactly when status becomes "done"; cleared when it leaves "done". */
    completedAt: integer({ mode: "timestamp" }),
    subjectId: text().references(() => subjects.id, { onDelete: "set null", onUpdate: "cascade" }),
    /** Orders items within a day AND within a kanban lane. */
    sortOrder: integer().notNull().default(0),
    yearId: text().notNull().references(() => years.id, { onDelete: "cascade", onUpdate: "cascade" }),
    userId: owner(),
    ...timestamps,
  },
  (t) => [
    index("planner_items_year_starts_idx").on(t.yearId, t.startsAt),
    index("planner_items_user_id_idx").on(t.userId),
  ],
);
```

Doc-comment the deliberate exclusions (no recurrence column yet; when
recurrence arrives it is a separate `plannerRecurrences` table, not a JSON
column). Add `requirePlannerItem` to `lib/ownership.ts`.

**Verify**: `bun run db:generate` + `bun run db:migrate` + `bun run check-types` → exit 0.

### Step 2: `planner` router

`apps/server/src/routers/planner.ts` copied structurally from `goals.ts`:

- `plannerItemInput` zod schema (title 1..160 trimmed, kind enum, nullable
  dates, `allDay`, nullable `subjectId`, notes ≤ 2000).
- `list({ yearId, from?, to?, includeCompleted? })` — `requireYear` first;
  items of the year, filtered to the window when given (an item is in-window
  when `startsAt` is null and `includeCompleted`/backlog requested, or
  `startsAt <= to && (endsAt ?? startsAt) >= from`), ordered by
  `startsAt asc nulls last, sortOrder asc`.
- `create` — `requireYear`; when `subjectId` present:
  `const subject = await requireSubject(userId, subjectId); assertSameYear("Planner subject", input.yearId, subject.yearId);`
  (mirror `validateGoalScope`, `goals.ts:33-58`). Reject `endsAt` for
  `kind="task"` and `endsAt < startsAt` with `badRequest`.
- `update` — `plannerItemInput.partial().extend({ itemId })`;
  `requirePlannerItem` first; re-validate subject/year and date ordering on
  change.
- `setStatus({ itemId, status })` — tasks only (`badRequest` on events); sets
  the kanban lane; entering `"done"` stamps `completedAt`, leaving it clears
  it (mirror `goals.markAchieved`, `goals.ts:144`, for the stamp mechanics).
- `moveInBoard({ itemId, status, beforeId?: string | null })` — tasks only;
  one procedure for kanban drag-and-drop: sets the lane AND recomputes
  `sortOrder` relative to `beforeId` within that lane using `db.batch`
  (mirror the reorder procedures, e.g. `goals.reorder` at `goals.ts:161`).
- `delete({ itemId })` — `requirePlannerItem` then delete.
- `agenda({ yearId, from, to })` — **the unified read model**: one procedure
  returning a normalized list of `{ id, source: "planner" | "goal" | "grade" | "period", kind, title, startsAt, endsAt, allDay, status?, completed, subjectId?, href-ish refs }`
  (`status` present only for planner tasks — the kanban lane)
  projecting: plannerItems in window; goals with `dueAt` in window
  (`completed` = `achievedAt != null`); grades with `passedAt` in window;
  period boundaries (start/end as all-day markers). Read-only projection — no
  denormalization into `plannerItems`. Cap the window server-side at 62 days
  (`badRequest` beyond), so the payload stays bounded.

Register `planner: plannerRouter` in `routers/index.ts`.

**Verify**: `bun run check-types` → exit 0.

### Step 3: Server tests

`apps/server/src/routers/planner.test.ts` on the
`integrity.integration.test.ts` bootstrap: CRUD happy path; ownership
(`notFound` across users); `assertSameYear` rejection for a subject from
another year; task/event validation (`endsAt` on task rejected; inverted range
rejected); `setStatus` on an event rejected; `setStatus` to `done` stamps
`completedAt` and back to `doing` clears it; `moveInBoard` reorders within a
lane and across lanes (assert resulting `status` + `sortOrder` sequence);
`agenda` window merge returns all four sources correctly ordered; window cap
enforced.

**Verify**: `bun run --cwd apps/server test` → exit 0.

### Step 4: MCP surface (requires plan 003 DONE)

- Add `"avermate:planner.read"` and `"avermate:planner.write"` to `MCP_SCOPES`
  (`lib/auth.ts:24-32`). No entry in `scopeExpirations` (default lifetime) —
  planner writes are low-risk.
- Create `apps/server/src/mcp/surfaces/planner.ts` exporting an `McpSurface`
  registering: `planner.agenda`, `planner.list` (read scope);
  `planner.create`, `planner.update`, `planner.setStatus` (write scope);
  `planner.delete` as a **destructive** tool via `runDestructive` with a
  required uuid `idempotencyKey` — copy the registration shape of an existing
  destructive tool (e.g. `years.delete`). Every handler is a thin
  `call(() => api.planner.x(input))`.
- Add the surface to `surfaces/index.ts` **at the end** of the ordered array
  (appending keeps existing catalog prefixes stable; the harness enumerations
  are updated to include the new names).
- Update the two harness enumerations (deterministic catalog, scope isolation)
  and `docs/mcp.md` scope + surface tables.

**Verify**: `bun run --cwd apps/server test` → exit 0 (harness green with the
new tools; scope isolation proves planner tools invisible without the scopes).

### Step 5: Extract the month grid, then build the web agenda

1. Create `apps/web/src/components/calendar/month-grid.ts`; move `dayKey` and
   `monthGrid` out of `grade-calendar.tsx` verbatim; `grade-calendar.tsx`
   imports them (behavior-preserving — `grade-calendar.test.ts` must pass
   unchanged; move any purely-grid test cases beside the new module).
2. Add `{ href: "/agenda", label: "Agenda", icon: CalendarDaysIcon }` to
   `NAV_ENTRIES` after `/goals` (`nav.ts:53-57` area). Import the icon from
   `lucide-react` like its neighbors.
3. `apps/web/src/app/(app)/agenda/page.tsx` — server page per the
   `announcements/page.tsx` exemplar: `prepareAuthenticatedShell()`, prefetch
   `orpc.planner.agenda` for the current month window via a factory added to
   `route-query-inputs.ts`, hydrate an `AgendaClient`.
4. `apps/web/src/components/agenda/` — THREE persisted view modes, mirroring
   the grades screen's `ViewMode` + `useStickyState("avermate:grades-view")`
   pattern (persist under `"avermate:agenda-view"`):
   - **Calendar** — month grid (consume `monthGrid`/`dayKey`; colour by
     SOURCE, not hashed ids: planner-task, planner-event, goal, grade, period
     each get one semantic colour token) with a day list below (same
     local-day bucketing).
   - **List** — the same feed grouped by day, with a status control on tasks.
   - **Board (kanban)** — three lanes `todo / doing / done` showing planner
     TASKS only (events, goals, grades never appear on the board). Drag
     between/within lanes calls `planner.moveInBoard`; build the DnD on
     `@dnd-kit` EXACTLY as `apps/web/src/components/cards/card-grid.tsx`
     already does for dashboard cards (the dependency is already installed —
     do not add another DnD library). Keyboard reordering must work (dnd-kit
     sensors, as in `card-grid.tsx`); done-lane cards render with the
     completed treatment.
   Plus `/agenda/new` + `/agenda/[itemId]/edit` full-screen create/edit routes
   per the forms convention. Mutations invalidate ONLY `orpc.planner.*` query
   keys — never `snapshot.get`.
5. Add en/fr messages together.

**Verify**: `bun run lint && bun run check-types` → exit 0;
`bun run --cwd apps/web test` if a web test script exists (else skip);
manual: `bun run dev:server` + `bun run dev:web`, open `/agenda`, create a
task, see it on the grid, complete it, delete it.

### Step 6: Write down design rule 6

Append to `docs/ssr-data-loading.md`, after rule 5, a short "6. Feature-scoped
read models" rule: new entity families that are not part of the year graph get
their own oRPC namespace, their own input factory in `route-query-inputs.ts`,
their own page-level prefetch, and their mutations invalidate only their own
keys; the planner is the reference implementation. Keep it under 15 lines,
match the doc's voice.

**Verify**: `grep -n "Feature-scoped" docs/ssr-data-loading.md` → 1 match.

### Step 7: Mobile minimal parity

`apps/mobile/app/agenda/index.tsx` (list grouped by day, month header,
complete/uncomplete swipe or button) and `agenda/new.tsx` / `agenda/[id].tsx`
(create/edit forms), navigated from the dashboard screen (add an entry point
button; do NOT add a sixth tab — the five-tab layout is a recorded decision in
`(tabs)/_layout.tsx:13-19`). Reuse the mobile query-client patterns from the
goals screens (`apps/mobile/app/goal/`). Add every new string to
`apps/mobile/lib/i18n.ts` with a French entry.

**Verify**: `bun run check-types` → exit 0; from `apps/mobile`:
`bunx expo export --platform all` → exit 0.

### Step 8: Full gate

**Verify**: `bun run format:check && bun run lint && bun run check-types && bun run test && bun run build` → all exit 0.

## Test plan

- Server: `planner.test.ts` per Step 3 (≥8 cases listed there), modeled on
  `integrity.integration.test.ts`.
- Web: pure agenda view-model logic (bucketing, source colours, window math)
  goes in colocated `.test.ts` files per the `components/cards/` pattern;
  `grade-calendar.test.ts` must pass unchanged after the extraction.
- MCP: harness enumerations updated; no bespoke MCP tests beyond the pinned
  catalog/scopes.

## Done criteria

Machine-checkable. ALL must hold:

- [ ] Migration creates `planner_items`; fresh `bun run db:migrate` exits 0
- [ ] `planner` registered in `routers/index.ts`; `requirePlannerItem` exists
- [ ] `planner.test.ts` passes; `bun run --cwd apps/server test` exits 0 (incl. MCP harness with planner tools)
- [ ] `grep -n "avermate:planner" apps/server/src/lib/auth.ts docs/mcp.md` → matches in both
- [ ] `/agenda` present in `nav.ts`; `apps/web/src/app/(app)/agenda/page.tsx` exists and prefetches `planner.agenda`
- [ ] The three view modes (calendar, list, board) render and persist; the board drags with `@dnd-kit` (no new DnD dependency in `apps/web/package.json`)
- [ ] `grep -rn "snapshot.get" apps/web/src/components/agenda apps/web/src/app/\(app\)/agenda` → no matches (no snapshot coupling)
- [ ] `dayKey`/`monthGrid` live in `components/calendar/month-grid.ts`; `grade-calendar.test.ts` passes unchanged
- [ ] `docs/ssr-data-loading.md` contains rule 6
- [ ] `bunx expo export --platform all` (from `apps/mobile`) exits 0
- [ ] All root gates exit 0; `git status` clean outside scope
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back (do not improvise) if:

- Plan 003 is not DONE and the MCP step would have to edit the monolithic
  `mcp/server.ts` if-chain — do steps 1–3 and 5–8, mark the MCP step BLOCKED in
  `plans/README.md`, and report.
- The harness's deterministic-catalog test fails for any reason other than the
  expected new planner tool names.
- `grade-calendar.test.ts` fails after the extraction (the move was not
  behavior-preserving — fix or STOP; never adjust the test).
- The agenda projection needs a column that does not exist on
  `goals`/`grades`/`periods` (schema drift).
- You find yourself adding a scheduling-calendar dependency or time-grid UI —
  that contradicts a recorded decision; STOP.

## Maintenance notes

- Recurrence, reminders and ICS export are the named next increments; each is
  additive (new table / new job kind once plan 002 lands / new export
  procedure).
- The agenda read model is the template for plan 005's materials read model —
  keep its invalidation discipline exemplary.
- A "next up" dashboard widget needs the closed widget registry opened
  (`packages/core/src/widget-registry.ts` size assertion) — separate plan;
  the `card-view.tsx` result-shape renderer means a `list`-shaped capability
  reuses existing rendering.
- Reviewer attention: window-cap enforcement in `planner.agenda` (unbounded
  ranges are the payload risk), `onDelete: "set null"` on `subjectId` (subject
  deletion must not take planner history with it), and that no mutation
  invalidates the snapshot key.
