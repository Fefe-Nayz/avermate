# Plan 015: Ship the card gallery — a store of preconfigured dashboard and insight cards

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat 46c966b..HEAD -- apps/server/src/db/schema apps/server/src/routers packages/core/src apps/web/src/app apps/web/src/components/cards`
> On excerpt mismatch, STOP.

## Status

- **Priority**: P3 (transversal, from the maintainer's TODO.md: "Store for preconfigured datacards and insight cards")
- **Effort**: M-L
- **Risk**: LOW-MED
- **Depends on**: none (003 for the optional MCP read tool)
- **Category**: direction
- **Planned at**: commit `46c966b`, 2026-08-14

## Why this matters

The craftable-widget engine is powerful and therefore intimidating: 21
metrics, a recursive formula/chart editor, versioned definitions. Most
students want "the good cards" without building them. The TODO.md asks for a
store: admin-curated, preconfigured card definitions that any user can browse
and install onto their dashboard or insights in one tap. The governance
machinery already exists in spirit — managed presets are admin-published,
immutable, versioned artifacts (`presetDefinitions`/`presetVersions`), and a
dashboard card is already a self-contained versioned JSON document — so the
store is a catalog table plus a browse-and-install UI, not a new engine.

## Current state

- Card storage: `dashboardCards` with `definitionVersion` +
  `definitionJson: text({mode:"json"}).$type<WidgetDefinitionV1>()`
  (`apps/server/src/db/schema/app.ts:507-508`) and the
  `dashboardCardReferences` shadow table (`:529-545`). **Key constraint: a
  definition may reference user-specific entities (subjects, custom averages,
  goals, periods)** — the reference kinds at `app.ts:522-523`. A TEMPLATE
  must therefore only contain definitions whose scope needs no
  user-specific reference (general scope / metric-only), or declare required
  slots; v1 of the store takes the simple road: reference-free definitions
  only (validated at publish).
- Two card surfaces exist: Dashboard and Insights
  (`apps/web/src/app/(app)/dashboard/**`, `(app)/insights/**`), sharing
  `WIDGET_SURFACES` in `packages/core/src/widget-types.ts` and the editor
  flow (`cards/new`, generated from `widget-flow-schema.ts`).
- Card CRUD: `apps/server/src/routers/cards.ts` (`list:224`, `create:245`,
  `update:292`, `reorder:357`, `delete:419`, `reset:434`) — install = the
  EXISTING `cards.create` with a template's definition; no new write path.
- Governance exemplar: `presetDefinitions` (`app.ts:84`, with
  `createdByUserId` at `:93` already anticipating non-admin authorship) +
  immutable `presetVersions` (`:101`, unique `(presetId, version)`); admin
  editors live under `apps/web/src/app/(app)/admin/presets/**`.
- Evaluation is client-side from the year graph — a card template renders a
  LIVE PREVIEW on the browsing user's own data by just evaluating its
  definition (`packages/core/src/widget-evaluator.ts`), which is the store's
  killer detail and costs nothing server-side.
- `adminProcedure` gate: `apps/server/src/lib/orpc.ts:26-33`.

## Commands you will need

| Purpose | Command | Expected |
|---------|---------|----------|
| Migration | `bun run db:generate` && `bun run db:migrate` | exit 0 |
| Tests | `bun run --cwd apps/server test` && (core) `bun run --cwd packages/core test` | exit 0 |
| Full gate | `bun run format:check && bun run lint && bun run check-types && bun run test && bun run build` | exit 0 |

## Scope

**In scope**:
- `apps/server/src/db/schema/card-templates.ts` (create: `cardTemplates`) + export + migration
- `apps/server/src/routers/card-templates.ts` (create: public list/get + admin CRUD/publish) + `routers/index.ts`
- `packages/core/src/widget-definition.ts` — add `definitionReferenceIds(def)` helper ONLY if one does not already exist (check first: the shadow-table writer in `routers/cards.ts` must already compute references — REUSE that function, moving it to core only if it lives in the router)
- Tests: `card-templates.test.ts`
- Web: gallery tab in the add-card flow (`apps/web/src/app/(app)/dashboard/cards/new/**` and the insights equivalent) + admin authoring screen under `(app)/admin/**`
- Mobile: gallery list + install in the existing card-add screen (`apps/mobile/app/settings/cards.tsx` area)
- MCP (optional, 003 DONE): `cardTemplates.list` read tool

**Out of scope**:
- Community/user-submitted templates and moderation — v1 is admin-curated
  (the `presetDefinitions.createdByUserId` precedent shows the later path).
- Templates with user-specific reference slots ("pick your subject") — the
  install-time slot-filling UX is real design work; v1 publishes
  reference-free definitions only and REJECTS others at publish time.
- Any change to the widget engine, registry, or `CARD_METRICS` (closed world
  stays closed).
- Screenshots/thumbnails pipeline — the live preview on the user's own data
  replaces static previews.

## Git workflow

- Branch: `advisor/015-card-store`; conventional commits
  (`feat(server): card template catalog`, `feat(web): card gallery`).
- Do NOT push or open a PR unless instructed.

## Steps

### Step 1: Catalog schema

`apps/server/src/db/schema/card-templates.ts`:

```ts
export const cardTemplates = sqliteTable("card_templates", {
  id: text().notNull().primaryKey().$defaultFn(() => newId("ctpl")),
  title: text().notNull(),
  description: text(),
  /** Which surface(s) it fits — subset of WIDGET_SURFACES. */
  surfaces: text({ mode: "json" }).$type<string[]>().notNull(),
  category: text().notNull().default("general"),      // grouping in the gallery
  definitionVersion: integer().notNull(),
  definitionJson: text({ mode: "json" }).$type<WidgetDefinitionV1>().notNull(),
  status: text().$type<"draft" | "published" | "archived">().notNull().default("draft"),
  sortOrder: integer().notNull().default(0),
  createdByUserId: text().notNull().references(() => users.id, { onDelete: "cascade", onUpdate: "cascade" }),
  ...timestamps,
});
```

No shadow-reference table needed: publish-time validation guarantees the
definition is reference-free (Step 2), so there is nothing to relationally
observe. Templates are global (no `yearId`), read by everyone, written by
admins.

**Verify**: migration + `bun run check-types` exit 0.

### Step 2: Router

`routers/card-templates.ts`:

- `list` / `get` — `protectedProcedure`; `published` only, ordered by
  `category, sortOrder`. (Full definition included — the client needs it for
  live preview and install.)
- Admin (all `adminProcedure`): `adminList` (all statuses), `create`,
  `update` (drafts only — published templates are immutable like preset
  versions; to change one, archive and re-create, mirroring the
  `presetVersions` philosophy — enforce with `badRequest`), `publish`
  (draft→published; VALIDATION: definition parses against
  `WidgetDefinitionV1`, `definitionVersion` matches the current
  `WIDGET_DEFINITION_VERSION`, surfaces ⊆ `WIDGET_SURFACES`, and the
  reference extractor returns ZERO user-specific references), `archive`.
- Install path: none server-side — the client calls the existing
  `cards.create` with the template's `definitionJson` (+ its own
  title/accent defaults). Do NOT add a `cardTemplates.install` procedure; one
  write path for cards is the invariant.

Register `cardTemplates` in `routers/index.ts`.

**Verify**: `card-templates.test.ts` (in-memory bootstrap): non-admin denied
on admin procs; publish rejects a definition WITH references (build one
referencing a subject id) and accepts a metric-only one; published templates
immutable; `list` hides drafts.

### Step 3: Web gallery + admin authoring

- Add-card flow gains a "Galerie" tab beside the from-scratch editor (both
  `dashboard/cards/new` and the insights equivalent): category-grouped cards,
  each rendered as a LIVE widget on the user's current year via the existing
  `widget-view` components (evaluation is already client-side), an "Ajouter"
  button calling `cards.create` (then the standard invalidate + navigate from
  the mutation convention, `grade-form.tsx:210-226` shape).
- Admin screen under `(app)/admin/` (nav follows the existing admin section
  pattern): list + "create from my current cards" shortcut (pick one of the
  admin's own `dashboardCards`, strip title/accent, save as draft — the
  cheapest authoring path since the card editor already exists), publish/
  archive actions surfacing the validation errors.
- en/fr messages.

**Verify**: `bun run lint && bun run check-types` exit 0; manual: publish a
metric-only template as admin, see it live-previewed in the gallery on a
demo account, install it, find it on the dashboard.

### Step 4: Mobile + optional MCP

Mobile: the card-add screen lists published templates (title/description +
install); live preview reuses `apps/mobile/components/widgets/`
`widget-renderer` if trivially wirable, else text-only v1 (note it). MCP (if
003): `cardTemplates.list` on the academic read surface; harness + docs
updated.

**Verify**: `bunx expo export --platform all` exit 0; server suite exit 0.

### Step 5: Full gate

**Verify**: all root gates exit 0.

## Test plan

Step 2's list (≥6 cases) on the standard bootstrap, plus one core-side test
if the reference extractor moved into `packages/core` (reference-free vs
referencing definitions). Model on `integrity.integration.test.ts` and the
existing `packages/core/src/widgets.test.ts`.

## Done criteria

- [ ] `card_templates` migrates; publish-time validation test-proven (incl. reference rejection)
- [ ] Gallery tab installs via the EXISTING `cards.create` (`grep -n "install" apps/server/src/routers/card-templates.ts` → no install procedure)
- [ ] Published templates immutable (test-proven)
- [ ] Admin authoring path works from an existing card
- [ ] All root gates + Expo export exit 0; `git status` clean outside scope; `plans/README.md` updated

## STOP conditions

- No existing function computes a definition's references (the shadow-table
  writer must — find it in `routers/cards.ts`; if it truly does not exist,
  STOP and report, because publish validation depends on it).
- `WidgetDefinitionV1` cannot express a useful reference-free card for BOTH
  surfaces (would gut the store's value — report with examples).
- The live preview requires server evaluation (contradicts the audited
  client-side evaluator — re-read `widget-evaluator.ts` usage before
  concluding).

## Maintenance notes

- v2 candidates, in order: reference SLOTS with install-time pickers
  ("choose your subject"), user-submitted templates behind moderation
  (reuse the social-report/admin-triage muscles), template categories tied to
  managed presets (a preset ships its recommended cards).
- `WIDGET_DEFINITION_VERSION` bumps must migrate or archive published
  templates — add that to whatever plan bumps it.
- Reviewer attention: publish validation completeness (a template that
  references another user's entity must be impossible), and gallery
  evaluation cost on large years (memoize like the dashboard does).
