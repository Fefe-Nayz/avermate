# Plan 016: Consolidate the cross-platform design system (shared tokens, platform idioms, desktop density)

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat 46c966b..HEAD -- packages/core/src apps/web/src/lib apps/mobile/lib docs/`
> On excerpt mismatch, STOP.

## Status

- **Priority**: P3 (transversal, from the maintainer's TODO.md)
- **Effort**: L (spike + extraction; intentionally NOT a restyle)
- **Risk**: MED (touches theming consumed on every screen of both apps)
- **Depends on**: none (014 composes with it)
- **Category**: tech-debt / design
- **Planned at**: commit `46c966b`, 2026-08-14

## Why this matters

The maintainer's TODO.md states the goal: mobile apps that feel native while
staying feature-par with web, under ONE coherent cross-platform,
cross-device design system — web-on-phone should feel close to the native
app, and desktop web must not "subir les limitations du téléphone" (oversized
touch controls on a pointer device). Today the system exists twice by hand:
`theme.ts` + `theme-presets.ts` are DUPLICATED in `apps/web/src/lib/` and
`apps/mobile/lib/` (audited — parallel files maintained manually), so every
palette/season/radius change is a two-place edit that can silently drift.
This plan extracts the shared tokens into the one package both apps already
consume (`@avermate/core`), writes the platform-idiom rules down, and gives
desktop web a pointer-aware density pass — without changing how anything
looks today (extraction first, then one bounded density change).

## Current state

- Duplicated by hand between `apps/web/src/lib/` and `apps/mobile/lib/`
  (same names both sides): `theme.ts`, `theme-presets.ts` — plus parallel
  `query-client.ts`, `year-review-window.ts`, widget editor models (audited
  list; only theming is in scope here).
- Web theming: Tailwind 4 CSS-first — `apps/web/src/app/globals.css` imports
  `theme.css` + `app.css`; `@theme inline` maps `--color-*` to CSS variables;
  `.dark` variant; runtime presets applied via `apps/web/src/lib/theme.ts`,
  `theme-presets.ts`, `appearance.ts` (cookie-driven; ~17 fonts wired in
  `app/layout.tsx`; guarded custom CSS feature exists). Semantic result-band
  tokens: `--band-{excellent,good,fair,weak,poor}`.
- Mobile theming: `usePalette()` from `apps/mobile/lib/theme.ts` +
  `theme-presets.ts`; preferences synced server-side.
- `packages/core` is pure TS with zero runtime deps, consumed as source by
  all three apps (`README.md:121-123`) — token DATA (hex ramps, radius
  scale, band colors, seasonal accents, font list) is pure data and fits;
  anything importing React/CSS does NOT belong there.
- Release gates already include "light/dark/custom themes and both catalogs"
  (`docs/feature-parity.md` release-gates section) — the extraction must keep
  those passing unchanged.
- No `docs/design-system.md` exists. Plan 014 may have created
  `docs/design-notes.md`.

## Commands you will need

| Purpose | Command | Expected |
|---------|---------|----------|
| Core tests | `bun run --cwd packages/core test` | exit 0 |
| Full gate | `bun run format:check && bun run lint && bun run check-types && bun run test && bun run build` | exit 0 |
| Expo bundles | `bunx expo export --platform all` (from `apps/mobile`) | exit 0 |

## Scope

**In scope**:
- Phase 1 (report): a drift inventory written to `plans/016-drift-report.md`
- Phase 2: `packages/core/src/design-tokens.ts` (create) + `packages/core/src/index.ts` export + a `design-tokens.test.ts`
- `apps/web/src/lib/theme-presets.ts` and `apps/mobile/lib/theme-presets.ts` (become thin re-exports/adapters over core tokens)
- `apps/web/src/lib/theme.ts` / `apps/mobile/lib/theme.ts` (ONLY the lines that read preset data)
- Phase 3: `apps/web/src/app/app.css` (or `theme.css`) — the pointer-density tokens; the handful of shared control components under `apps/web/src/components/ui/` that hardcode touch-height paddings
- `docs/design-system.md` (create)

**Out of scope**:
- ANY visual redesign, palette change, or new preset — extraction is
  behavior-preserving; the density pass changes desktop control sizing ONLY
  via the new tokens.
- The guarded custom-CSS feature, fonts pipeline, seasonal triggers.
- Mobile i18n parity testing (real gap, separate concern — noted in
  `plans/README.md` roadmap, not smuggled in here).
- Navigation/idiom refactors on mobile (the five-tab decision stands).
- `query-client.ts` and other non-theming duplicates.

## Git workflow

- Branch: `advisor/016-design-tokens`; conventional commits per phase
  (`chore: inventory theme drift`, `refactor(core): shared design tokens`,
  `feat(web): pointer-aware density`).
- Do NOT push or open a PR unless instructed.

## Steps

### Step 1: Drift inventory (read-only spike)

Diff the two `theme-presets.ts` files structurally: list every preset and
token that differs (name, hex, radius, missing entries) in
`plans/016-drift-report.md` with a verdict per difference — `intentional
(platform idiom)` or `drift (fix in extraction)`. Do the same for the token
names web CSS exposes vs mobile palette keys (map table). No code changes.

**Verify**: the report exists and every difference row carries a verdict.

### Step 2: Extract `design-tokens.ts` into core

Create `packages/core/src/design-tokens.ts` holding the SHARED data:
palette ramps per preset, band colors, radius scale, seasonal accents, the
font catalog (names/stacks only — loading stays per-platform), spacing
steps if presets carry them. Shape it as plain typed constants
(`export const THEME_PRESETS = {...} as const satisfies ...`) — no React, no
CSS, no platform imports (core purity is a hard rule; its test asserts
`JSON.stringify` round-trips and that every preset defines every token key —
the exhaustiveness assertion style the repo already uses in
`widget-registry.ts`).

Rewire both `theme-presets.ts` files to import from `@avermate/core` and
re-export in their current platform shape (web keeps emitting CSS variable
maps; mobile keeps its palette objects). Fix only the differences marked
`drift` in Step 1; `intentional` ones stay platform-side, explicitly, next to
a comment naming them.

**Verify**: `bun run --cwd packages/core test` exit 0 (new test included);
`bun run check-types` exit 0; `bun run build` exit 0;
`bunx expo export --platform all` exit 0; manual: switch 3 presets + dark
mode on web and mobile — identical appearance to before (screenshots in PR).

### Step 3: Desktop density pass (bounded)

In the web theme CSS, introduce density tokens:
`--control-h`, `--control-px`, `--control-text` with touch defaults, and a
`@media (pointer: fine)` override reducing them one step (e.g. 40px→32px
heights). Convert ONLY the shared control primitives that hardcode
touch-sized values — buttons, inputs, select triggers, list rows in
`apps/web/src/components/ui/` (enumerate the exact files in the PR) — to
consume the tokens. Screens inherit automatically; no per-screen edits.

**Verify**: `bun run build` exit 0; manual matrix: desktop pointer (denser
controls), touch device / narrow viewport (unchanged), keyboard focus rings
intact; before/after screenshots of the grades table + a form on desktop.

### Step 4: Write `docs/design-system.md`

≤ 80 lines, matching the docs' voice: where tokens live
(`packages/core/src/design-tokens.ts` = data; web CSS + mobile palette =
platform adapters); the platform-idiom rules from TODO.md made explicit
(mobile follows native navigation patterns; web-on-phone mirrors the mobile
look; desktop gets `pointer: fine` density and never inherits touch sizing);
the change protocol (a preset/token change happens in core ONCE; adding a
platform-intentional divergence requires the inline comment naming it); a
pointer to plan 014's fluid-sizing convention for expressive surfaces.

**Verify**: `bun run format:check` exit 0.

## Test plan

Core: `design-tokens.test.ts` (exhaustiveness per preset, no platform
imports — assert the module graph stays pure by importing it in a bare bun
test). The two visual verifications (Step 2 identical-before/after, Step 3
density matrix) are manual with PR screenshots — the release gates
(themes × light/dark on both apps) are the acceptance bar.

## Done criteria

- [ ] `plans/016-drift-report.md` exists with verdicts
- [ ] `packages/core/src/design-tokens.ts` exists, tested, imported by BOTH `theme-presets.ts` files (`grep -l "design-tokens" apps/web/src/lib/theme-presets.ts apps/mobile/lib/theme-presets.ts` → both)
- [ ] No preset/token data literal remains duplicated (spot-check: a hex changed in core shows up on both platforms)
- [ ] Density tokens exist with a `pointer: fine` override; only `components/ui/` primitives changed for it
- [ ] `docs/design-system.md` exists
- [ ] All root gates + core tests + Expo export exit 0; `git status` clean outside scope; `plans/README.md` updated

## STOP conditions

- The two `theme-presets.ts` diverge SO much that a shared shape needs
  redesign rather than extraction (report with the drift table — that's a
  product decision).
- Core purity would break (something in the token data needs a platform
  import) — restructure the data, never core's dependency rule.
- The density pass visually breaks a screen that composed hardcoded sizes —
  revert that primitive to hardcoded, list it in the PR, continue (partial
  adoption is acceptable; broken layout is not).
- Theme QA gates (light/dark/custom on either app) fail after extraction.

## Maintenance notes

- Future presets/tokens are added in core once; CI catches a platform
  forgetting to consume them only via the exhaustiveness test — keep it
  updated.
- The remaining hand-duplicated non-theme modules (`query-client.ts`,
  `year-review-window.ts`, widget editor models) are candidates for the same
  treatment — separate plans, same recipe (inventory → extract → adapters).
- Plan 014's fluid pairs can graduate into named core tokens once both plans
  have landed.
- Reviewer attention: bundle impact on mobile (core stays tree-shakeable
  data), and that the density override rides `pointer: fine` — not viewport
  width — so touch laptops keep touch sizing.
