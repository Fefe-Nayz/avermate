# Plan 014: Adopt `tailwind-clamp` for fluid type and spacing on the expressive web surfaces

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat 46c966b..HEAD -- apps/web/package.json apps/web/src/app apps/web/src/components/review`
> On excerpt mismatch, STOP.

## Status

- **Priority**: P3 (transversal, from the maintainer's TODO.md)
- **Effort**: S-M
- **Risk**: LOW
- **Depends on**: none
- **Category**: dx / design
- **Planned at**: commit `46c966b`, 2026-08-14

## Why this matters

The maintainer researched Tailwind v4 fluid-utility plugins (TODO.md at the
repo root, 2026) and concluded: `fluid-tailwind` is stale (npm 1.0.4, ~2
years old, no v4 story); the maintained v4-native choice is
**`tailwind-clamp` (nicolas-cusan, v4.5.1, 2026)**; the closest spiritual
successor (`@jalendport/tailwindcss-fluid`) is not yet published on npm —
wait; `fluidwind` has a more foreign API. The repo currently has NO fluid
system at all (verified: no fluid/clamp plugin in `apps/web/package.json`,
no `clamp(` in the theme CSS, no `~text-`/`fl-text-` classes) — so this is a
clean adoption, not a migration. Fluid scaling belongs on the *expressive*
surfaces (landing page, year-review story, auth/onboarding heroes) where
type jumps between phone and desktop; app-chrome sizes stay fixed.

## Current state

- `apps/web` is Tailwind CSS 4, CSS-first config:
  `apps/web/src/app/globals.css` imports `theme.css` + `app.css`, with
  `@theme inline` mapping `--color-*` tokens (audited). Tailwind v4 plugins
  load via `@plugin` in CSS, not a JS config.
- TODO.md's decision record (repo root, untracked): ranking ①
  `tailwind-clamp` (production/maintained/v4) ② `@jalendport/tailwindcss-fluid`
  (true successor, NOT on npm yet) ③ `fluidwind`. Syntax:
  `clamp-[text,lg,4xl]`, `clamp-[px,4,8]`.
- Expressive surfaces (targets): the public landing `apps/web/src/app/page.tsx`,
  the year-review story components under `apps/web/src/components/review/`,
  and the auth/onboarding shells under `apps/web/src/app/auth/` /
  `app/onboarding/`.
- Design-token discipline: colors/fonts/radius flow through tokens
  (`theme.ts`, `theme-presets.ts`, `appearance.ts`) — fluid sizing must not
  bypass or fork that system; it only touches size/spacing utilities.

## Commands you will need

| Purpose | Command | Expected |
|---------|---------|----------|
| Install | `bun install` | exit 0 |
| Build | `bun run build` | exit 0 |
| Gates | `bun run format:check && bun run lint && bun run check-types` | exit 0 |

## Scope

**In scope**:
- `apps/web/package.json` (add `tailwind-clamp` only)
- `apps/web/src/app/globals.css` (the `@plugin` line)
- Landing page, year-review story, auth/onboarding hero typography (class-level changes only)
- A 15-line "Fluid sizing" convention note appended to the most fitting doc (`docs/` — create `docs/design-notes.md` if none fits)

**Out of scope**:
- Any dashboard/app-chrome surface (tables, forms, cards, settings) — fixed
  sizes are deliberate there; desktop density is plan 016's concern.
- Mobile app (React Native does not consume Tailwind).
- `@jalendport/tailwindcss-fluid` — revisit ONLY when it is published on npm
  (record as the watch item).
- Any color/radius/font token change.

## Git workflow

- Branch: `advisor/014-tailwind-clamp`; commit
  `feat(web): fluid type via tailwind-clamp on expressive surfaces`.
- Do NOT push or open a PR unless instructed.

## Steps

### Step 1: Install and register

`bun add tailwind-clamp` in `apps/web` (accept the resolved ^4.5.x), then in
`globals.css` add `@plugin "tailwind-clamp";` next to the existing Tailwind
import lines.

**Verify**: `bun run build` exit 0; a scratch class `clamp-[text,lg,4xl]` on
the landing h1 produces a `clamp(...)` font-size in the built CSS
(`grep -r "clamp(" apps/web/.next/static/css | head -1` → a match).

### Step 2: Apply to the expressive surfaces

Landing hero + section headings, year-review story display text, auth/
onboarding titles: replace the responsive size ladders
(`text-3xl md:text-5xl`-style) with `clamp-[text,<min>,<max>]` pairs chosen
to match the CURRENT endpoints (smallest breakpoint value → min, largest →
max) so the design does not change at the extremes — only between them.
Same treatment for the heroes' vertical padding where a `py-x md:py-y`
ladder exists. Do not touch line-height unless the ladder did.

**Verify**: `bun run lint && bun run check-types && bun run build` exit 0;
visual check at 360px / 768px / 1440px: extremes match the before state
(screenshot pair in the PR), no layout shift elsewhere
(`grep -rn "clamp-\[" apps/web/src/components/{cards,grades,subjects}` → no
matches — app chrome untouched).

### Step 3: Write the convention

Append to `docs/design-notes.md` (create if absent): fluid sizing uses
`tailwind-clamp`; allowed on expressive surfaces (list them); forbidden on
app chrome; min/max must equal the old breakpoint endpoints when converting;
`@jalendport/tailwindcss-fluid` is the watched successor — reconsider when it
ships on npm.

**Verify**: `bun run format:check` exit 0.

## Test plan

No unit tests (class-level styling). The gates + the extreme-viewport visual
check in Step 2 are the verification. CI's build is the regression net for
the plugin's compatibility with the pinned Tailwind 4.

## Done criteria

- [ ] `tailwind-clamp` in `apps/web/package.json`; `@plugin` registered
- [ ] Built CSS contains `clamp(` for the converted utilities
- [ ] No `clamp-[` usage outside the listed expressive surfaces
- [ ] `docs/design-notes.md` convention exists
- [ ] All root gates exit 0; `git status` clean outside scope; `plans/README.md` updated

## STOP conditions

- `tailwind-clamp`'s current release does not support the pinned Tailwind 4
  minor (install or build error) — report the version matrix; do not switch
  to `fluidwind` on your own (different API, maintainer ranked it third).
- Converting a ladder changes the rendered size at 360px or 1440px (your
  min/max mapping is wrong — fix the mapping, not the design).

## Maintenance notes

- Plan 016 (cross-platform design system) may promote the chosen min/max
  pairs into named tokens; keep the pairs enumerable (grep-able
  `clamp-[text,` usage) until then.
- Watch item: `@jalendport/tailwindcss-fluid` npm publication.
