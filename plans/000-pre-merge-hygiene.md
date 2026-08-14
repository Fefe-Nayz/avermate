# Plan 000: Fix documentation drift, dead switches and unwired mobile entry points before the study-companion merge

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat 46c966b..HEAD -- README.md docs/mcp.md docs/feature-parity.md apps/server/src/lib/env.ts apps/server/.env.example apps/server/src/routers/feedback.ts apps/mobile/components/tab-bar.tsx apps/mobile/components/quick-add.tsx "apps/mobile/app/(tabs)/_layout.tsx" apps/mobile/app/_layout.tsx apps/web/src/lib/nav.ts`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: docs | tech-debt
- **Planned at**: commit `46c966b`, 2026-08-14

## Why this matters

The repository is about to grow several new domains (course materials, agenda,
documents). Three documents currently describe a social privacy model that was
deliberately removed, two documents describe a mobile chart architecture that
no longer exists, a `DISABLE_FEEDBACK` switch is set by three test files but
read by nothing, and the mobile quick-add entry point — where every future
"add course file / record lecture / new task" action will hang — is dead code.
Fixing these first means the merge plans are written against documentation that
tells the truth, and new mobile features have a live entry point.

## Current state

- `README.md:29-32` — promises "friends, **circles**, and invite-only study
  groups or classes. Profile fields and derived comparison metrics are shared
  only after explicit consent". Circles and the consent machinery were removed
  by migration `apps/server/drizzle/0011_demonic_purifiers.sql:26-40` (drops
  `friend_circles`, `group_policy_versions`, `group_member_consents`,
  `social_profile_grants`, `guardian_consent_requests`, and 10 more).
- `apps/server/src/lib/social-policy.ts:5-13` — the authoritative statement of
  what remains:

  ```ts
  /**
   * The few invariants the social feature still enforces.
   *
   * The first iteration of this file was a privacy rulebook — age bands,
   * consent ledgers, policy digests, k-anonymity thresholds. The feature it
   * protected was unusable, so the rulebook went with it. What remains is the
   * arithmetic of identity: pair canonicalisation, handle normalisation, and
   * opaque invitation tokens of which only a hash is ever stored.
   */
  ```

- `docs/mcp.md:160-179` — claims tools pass "eligibility/guardian consent,
  field-grant, group-policy, cohort-threshold" checks and lists "circles",
  "immutable sharing policies, re-consent, threshold-protected aggregate
  statistics". None of these exist any more.
- `docs/feature-parity.md` — "Domain invariants preserved" section claims "a
  new group policy version stops projections until each member reconsents to
  its exact digest; undersized aggregate/ranking cohorts are suppressed"
  (around line 80). Same stale model.
- `README.md:41-42` — "Interactive analytics use TanStack Charts on the web and
  inside an Expo DOM surface on native." and `docs/feature-parity.md:33` —
  "TanStack Charts Expo DOM surface with touch, wheel and keyboard viewport
  controls". The DOM/WebView surface was removed:
  `apps/mobile/components/charts/time-series-chart.tsx:38` states "This used to
  be an Expo DOM component — a WebView…" and the renderer is now
  `react-native-svg` + `react-native-gesture-handler`. No `"use dom"` remains
  anywhere under `apps/mobile`.
- `DISABLE_FEEDBACK` — set in exactly three test files:
  - `apps/server/src/routers/integrity.integration.test.ts:16`
  - `apps/server/src/mcp/protocol.harness.ts:17`
  - `apps/server/scripts/migrate-legacy.integration.test.ts:141`

  It is NOT declared in `apps/server/src/lib/env.ts` (the declared escape
  hatches are only `DISABLE_EMAIL`/`DISABLE_UPLOADS` at `env.ts:52-53`), not in
  `apps/server/.env.example`, and no non-test code reads it. Compare with the
  wired pattern: `feedback.ts:140` guards uploads with
  `if (!uploads || env.DISABLE_UPLOADS)`.
- `apps/mobile/components/tab-bar.tsx` — exports `TabBar(props: BottomTabBarProps)`;
  imported by nothing (`grep -r "tab-bar" apps/mobile/app` → no hits;
  `grep -rn "tabBar=" apps/mobile/app` → no hits). It declares a `"more"` tab
  that has no route under `apps/mobile/app/(tabs)/`.
- `apps/mobile/components/quick-add.tsx` — `QuickAddProvider` / `useQuickAdd`
  referenced only from `tab-bar.tsx:5`, therefore unreachable at runtime.
- `apps/mobile/app/(tabs)/_layout.tsx:13-19` — renders the default Expo Router
  `<Tabs>` with five screens (`index, subjects, grades, goals, settings`) and
  carries a doc comment beginning "Five destinations, and every screen in the
  app hangs off one of them." — treat the five-destination shape as a decision;
  the *default tab bar renderer* vs the custom one is the open question.
- `apps/web/src/lib/nav.ts:32` — an orphaned JSDoc line inside `NavEntry`:

  ```ts
  /** Hidden until the request-prefetched eligibility projection is active. */}
  ```

  The property it documented was deleted; the comment now sits against the
  interface's closing brace.
- Two empty untracked directories exist on disk:
  `apps/web/src/app/card-fill-check-internal/` and
  `apps/web/src/app/__card-fill-check/`.

## Commands you will need

| Purpose   | Command                        | Expected on success |
|-----------|--------------------------------|---------------------|
| Install   | `bun install --frozen-lockfile` | exit 0             |
| Typecheck | `bun run check-types`          | exit 0              |
| Tests     | `bun run test`                 | exit 0, all pass    |
| Lint      | `bun run lint`                 | exit 0              |
| Format    | `bun run format:check`         | exit 0              |
| Server tests only | `bun run --cwd apps/server test` | exit 0     |

## Scope

**In scope** (the only files you should modify):
- `README.md`
- `docs/mcp.md`
- `docs/feature-parity.md`
- `apps/server/src/routers/integrity.integration.test.ts` (one line)
- `apps/server/src/mcp/protocol.harness.ts` (one line)
- `apps/server/scripts/migrate-legacy.integration.test.ts` (one line)
- `apps/mobile/components/tab-bar.tsx` (delete)
- `apps/mobile/components/quick-add.tsx` (delete)
- `apps/web/src/lib/nav.ts` (one comment line)
- Removal of the two empty directories listed above

**Out of scope** (do NOT touch, even though they look related):
- `apps/server/src/lib/social-policy.ts` and everything under
  `apps/server/src/routers/social/` — the code is correct; only the docs lie.
- `apps/server/src/lib/env.ts` / `.env.example` — do NOT add `DISABLE_FEEDBACK`
  here; the chosen resolution is deletion of the dead assignments (see Step 3).
- `apps/mobile/app/(tabs)/_layout.tsx` — the five plain tabs are a recorded
  design decision; leave the layout alone.
- `docs/mcp.md` sections other than the social paragraphs (the transport,
  OAuth, scope-table and MRTR sections were verified accurate).
- Migration files under `apps/server/drizzle/`.

## Git workflow

- Branch: `advisor/000-pre-merge-hygiene` created from `rewrite`.
- Commit style follows the repo's conventional prefixes, e.g.
  `docs: describe the current social model and native chart renderer` and
  `chore(mobile): remove unwired tab bar and quick add`.
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Rewrite the three stale social-privacy passages

In `README.md:29-32`, replace the social bullet so it describes the current
model per `social-policy.ts` and `db/schema/social.ts`: an optional private
social space with friends and invite-only groups; users choose to share their
general average and/or selected subjects; groups compare figures their owner
configures; membership is the only lock; no Internet-public grade profile.
Delete the words "circles" and "explicit consent"-based framing.

In `docs/mcp.md:160-179`, rewrite the two paragraphs: keep the catalogue
isolation claims (they are true), and replace the sentence listing
"feature flag, eligibility/guardian consent, field-grant, group-policy,
cohort-threshold, ownership, and moderation checks" with the real chain:
the global social feature flag, ownership checks, sharing configuration
(general average / selected subjects), and moderation checks. Keep the final
sentence about never exposing raw grades/notes/subject names/emails — it is
accurate.

In `docs/feature-parity.md`, fix the "Social access fails closed" invariant
bullet: remove "a new group policy version stops projections until each member
reconsents to its exact digest; undersized aggregate/ranking cohorts are
suppressed" and state the real invariant (sharing is off until the member
enables it; leaving a group stops all projections).

**Verify**: `grep -rn -i "circle\|guardian consent\|cohort-threshold\|field-grant\|reconsent" README.md docs/` → no matches.

### Step 2: Fix the native-chart claims

- `README.md:41-42`: replace "inside an Expo DOM surface on native" with a
  claim matching `apps/mobile/components/charts/time-series-chart.tsx` — the
  native renderer draws with `react-native-svg` and
  `react-native-gesture-handler`.
- `docs/feature-parity.md:33` (Charts row, Expo column): replace "TanStack
  Charts Expo DOM surface with touch, wheel and keyboard viewport controls"
  with wording for the native SVG renderer with touch viewport controls.

**Verify**: `grep -rn "Expo DOM" README.md docs/` → no matches.

### Step 3: Delete the three dead `DISABLE_FEEDBACK` assignments

Remove the single line in each of:
- `apps/server/src/routers/integrity.integration.test.ts:16`
- `apps/server/src/mcp/protocol.harness.ts:17`
- `apps/server/scripts/migrate-legacy.integration.test.ts:141`

Rationale for deletion rather than wiring: no product requirement exists for
disabling feedback, and a switch that only tests set is a false promise. (If a
maintainer later wants the switch, the wired exemplar to copy is
`DISABLE_UPLOADS` — declared at `env.ts:53`, enforced at
`routers/feedback.ts:140`.)

**Verify**: `grep -rn "DISABLE_FEEDBACK" apps/ packages/` → no matches.
**Verify**: `bun run --cwd apps/server test` → exit 0 (the three test files
still pass without the assignment).

### Step 4: Delete the unwired mobile tab bar and quick add

Delete `apps/mobile/components/tab-bar.tsx` and
`apps/mobile/components/quick-add.tsx`.

Rationale: `(tabs)/_layout.tsx` documents five plain destinations as the
decision; the custom bar and its quick-add sheet never shipped. Plans 004/005
reintroduce create-actions through ordinary screens and headers, and a future
quick-add should be rebuilt against those real routes rather than resurrected.
Before deleting, confirm they are still unreferenced:

```bash
grep -rn "quick-add\|tab-bar" apps/mobile --include="*.tsx" --include="*.ts" -l
```

Expected: only the two files themselves.

**Verify**: `bun run check-types` → exit 0 (nothing imported them).

### Step 5: Remove the orphaned JSDoc in `nav.ts` and the empty directories

- In `apps/web/src/lib/nav.ts:32`, delete the orphaned comment
  `/** Hidden until the request-prefetched eligibility projection is active. */`
  so the interface ends with a plain `}`.
- Remove the empty directories `apps/web/src/app/card-fill-check-internal/`
  and `apps/web/src/app/__card-fill-check/`.

**Verify**: `grep -n "eligibility projection" apps/web/src/lib/nav.ts` → no
matches; `ls apps/web/src/app | grep -i "card-fill"` → no matches.

### Step 6: Full gate

**Verify**: `bun run format:check && bun run lint && bun run check-types && bun run test` → all exit 0.

## Test plan

No new tests: this plan changes documentation, deletes dead code, and removes
inert env assignments. The existing suites are the regression net — in
particular `bun run --cwd apps/server test` must stay green after Step 3
(proves `DISABLE_FEEDBACK` really was inert) and `bun run check-types` after
Step 4 (proves the mobile components really were unreferenced).

## Done criteria

Machine-checkable. ALL must hold:

- [ ] `grep -rn -i "circle" README.md docs/mcp.md docs/feature-parity.md` → no matches
- [ ] `grep -rn "Expo DOM" README.md docs/` → no matches
- [ ] `grep -rn "DISABLE_FEEDBACK" apps/ packages/` → no matches
- [ ] `apps/mobile/components/tab-bar.tsx` and `quick-add.tsx` do not exist
- [ ] `bun run format:check`, `bun run lint`, `bun run check-types`, `bun run test` all exit 0
- [ ] No files outside the in-scope list are modified (`git status`)
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back (do not improvise) if:

- Any non-test file turns out to read `DISABLE_FEEDBACK` (grep before Step 3;
  if a runtime consumer exists, the deletion decision is wrong — report).
- `grep` in Step 4 shows a new importer of `tab-bar.tsx` or `quick-add.tsx`
  (the branch has moved; wiring may have landed — do not delete).
- The social passages in the three docs no longer match the excerpts above
  (someone already rewrote them; reconcile instead of overwriting).
- A test fails after Step 3.

## Maintenance notes

- Plans 004 and 005 add new surfaces to `apps/web/src/lib/nav.ts` and new
  mobile screens; they assume this plan's cleanups are in place but do not
  depend on them mechanically.
- Reviewer attention: the `docs/mcp.md` rewrite must not weaken the *true*
  claims (catalogue isolation, no raw-grade exposure) while removing the false
  ones.
- Deferred: a real mobile quick-add rebuilt on the new create routes (see plan
  004/005 maintenance notes); wiring `DISABLE_FEEDBACK` if a product need
  appears.
