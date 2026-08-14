# Plan 018: Spike the Pronote / EcoleDirecte / Skolengo connectors (Papillon-ecosystem evaluation)

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat 46c966b..HEAD -- apps/server/src/sync apps/server/src/db/schema/sync.ts`
> REQUIRES plan 008 (provider framework + Moodle) DONE — the whole point is
> to evaluate the second provider against the interface 008 shipped. On
> excerpt mismatch, STOP.

## Status

- **Priority**: P3 (wave 2 extension; spike, not a build)
- **Effort**: M (time-boxed investigation + report + optional prototype)
- **Risk**: MED (unofficial reverse-engineered APIs; legal/stability caveats are part of the deliverable)
- **Depends on**: plans/008 (hard)
- **Category**: direction (design/spike)
- **Planned at**: commit `46c966b`, 2026-08-14

## Why this matters

The Papillon half of the vision is aggregating the services French schools
impose — Pronote and EcoleDirecte above all. Plan 008 built the
`SyncProvider` interface with a `SyncCapability` model (`"files"` shipped;
`"homework" | "timetable" | "grades"` declared) precisely so these
connectors can exist. But Pronote-class providers are UNOFFICIAL,
reverse-engineered ecosystems that break with school-year updates, their
auth is device-based (QR/PIN), and their richest capabilities (grades!)
collide with avermate's own domain model. That is spike territory: evaluate
the Papillon ecosystem's libraries, map capabilities onto avermate domains,
prove ONE read-only capability end to end if viable, and produce a
go/no-go per capability — instead of betting a build plan on unverified
libraries.

## Current state

- Plan 008 shipped: `SyncProvider` (`parseCredentialInput`, `listCourses`,
  `listFiles`, `download`), `SYNC_PROVIDERS` registry,
  `syncConnections` (sealed credentials via `lib/crypto.ts` AES-GCM,
  `capabilities` JSON column), `syncedResources`, the `sync.run` job, and
  the settings/integrations UI. Widening points: the `SyncProviderId` and
  `SyncCapability` unions.
- Known ecosystem (to VERIFY, not assume — knowledge may be stale):
  Papillon (`github.com/PapillonApp`) maintains TS clients — `pawnote`
  (Pronote), `pawdirecte` (EcoleDirecte), and Skolengo libraries. Versions,
  maintenance status, auth flows and API coverage MUST be read from their
  repos/docs during this spike.
- Avermate landing zones per capability:
  - `files` → materials (plan 005), like Moodle.
  - `homework` → `plannerItems` kind `"task"` (plan 004) with
    `origin`-style provenance (planner has no origin column yet — the spike
    must propose the minimal change).
  - `timetable` → agenda events (plan 004) — recurring lessons vs one-shot
    events is an open modelling question (plan 004 deferred recurrence!).
  - `grades` → the HARD one: avermate years/subjects/periods are user-owned
    structures with domain invariants (`docs/feature-parity.md` invariants
    section); imported grades need subject-mapping UX and conflict rules.
    Related prior art: `preferences.exportData` exists but importData does
    not (roadmap #7).
- Legal/ToS posture: these are reverse-engineered clients of proprietary
  services; the spike's report must state the risk plainly (account
  lockouts, breakage cadence, ToS) — Papillon's public existence is
  precedent, not immunity.

## Commands you will need

| Purpose | Command | Expected |
|---------|---------|----------|
| Gates (if prototype code lands) | `bun run format:check && bun run lint && bun run check-types && bun run test` | exit 0 |

## Scope

**In scope**:
- `plans/018-connector-report.md` (create — THE deliverable)
- OPTIONAL prototype (only if Step 2 verdict is GO): `apps/server/src/sync/pronote.ts` behind the 008 interface, `"homework"` capability only, read-only, behind a `PRONOTE_CONNECTOR_ENABLED` env flag defaulting off; + minimal `plannerItems` provenance change IF the report's proposal is approved by the maintainer first (STOP gate)
- `apps/server/package.json` — AT MOST one evaluated client library, and only with the GO verdict

**Out of scope**:
- Grades import (report-only — it needs its own plan with mapping UX).
- Timetable/recurrence (report-only — collides with plan 004's deferred
  recurrence decision).
- EcoleDirecte/Skolengo prototypes (evaluate in the report; one prototype
  provider is enough to validate the interface).
- Any write operation against school services. Read-only, always.
- Shipping the connector on by default.

## Git workflow

- Branch: `advisor/018-pronote-spike`; commits
  (`docs: connector ecosystem evaluation`, optional `feat(server): experimental pronote homework connector`).
- Do NOT push or open a PR unless instructed.

## Steps

### Step 1: Ecosystem evaluation (read-only, time-boxed)

For each of `pawnote`, `pawdirecte`, and the Skolengo option, read the repo
and record in `plans/018-connector-report.md`: npm publication + version +
last release, license, runtime compatibility (Bun/Node, no native deps?),
auth flow (device registration: QR code / PIN / token — what a user must do
in OUR settings UI), capability coverage table (files, homework, timetable,
grades — per library), breakage history (issues around school-year
rollovers), and community health. Then write the ToS/risk paragraph.

**Verify**: the report exists with the per-library table and every cell
sourced (link or file reference) — no cell filled from memory.

### Step 2: Capability mapping + verdicts

In the same report, map each capability to its avermate landing zone with the
minimal schema deltas required (e.g. `plannerItems` provenance:
`origin: "manual" | "sync"` + `syncedResources.localKind: "plannerItem"` —
propose, don't implement), the conflict rules (user edited a synced homework
→ never overwrite; provider deleted it → mark, don't delete), and a
per-capability verdict: GO (prototype-able now) / LATER (needs plan X first)
/ NO-GO (with reason). Expected shape (to be validated, not assumed):
homework = GO candidate; timetable = LATER (recurrence); grades = LATER
(own plan); files = depends on library coverage.

**Verify**: every capability has a verdict + rationale + named schema deltas.

### Step 3 (ONLY if homework = GO **and** the maintainer approves the schema delta): prototype

Implement `sync/pronote.ts` behind the 008 interface for `"homework"`:
`parseCredentialInput` wraps the library's device-registration flow (sealed
via `lib/crypto.ts`, exactly like Moodle tokens), a `listHomework`-shaped
extension added to the interface AS PROPOSED IN THE REPORT, the `sync.run`
handler branch upserting planner tasks with provenance, all behind
`PRONOTE_CONNECTOR_ENABLED` (env, default false, declared in `env.ts` +
`.env.example`). Tests with stubbed library responses (no live school
account in CI); one manual run against the maintainer's real account,
results (counts, latency, breakages) appended to the report.

**Verify**: `bun run --cwd apps/server test` exit 0; flag off ⇒ provider
absent from the settings UI picker.

## Test plan

The report IS the deliverable; prototype tests are stub-based only. No CI
dependency on live school services, ever.

## Done criteria

- [ ] `plans/018-connector-report.md` exists: per-library table (sourced), capability verdicts, schema-delta proposals, ToS/risk paragraph
- [ ] Zero live-service calls in CI; at most one library dependency added, and only with a GO
- [ ] If prototyped: flag-gated, read-only, stub-tested, real-account results recorded
- [ ] All root gates exit 0 (if code landed); `git status` clean outside scope; `plans/README.md` updated

## STOP conditions

- Plan 008's interface is absent or shaped differently (drift).
- No evaluated library is npm-published + maintained + Bun-compatible —
  report NO-GO for now; do NOT vendor or fork one in this spike.
- The homework prototype requires more than the report's proposed minimal
  schema delta — back to the report, re-propose, wait for approval.
- Any path would require storing school PASSWORDS instead of device
  tokens — STOP; sealed device credentials only.

## Maintenance notes

- Grades import is the highest-value LATER — when planned, pair it with
  roadmap #7 (`importData`) since both need subject-mapping UX.
- Expect annual breakage: the connector must fail visible-and-soft
  (connection `status:"error"` + lastError, never a crash loop) — 008's
  status columns are the seam.
- Reviewer attention (prototype): sealed credentials never logged; the
  never-overwrite conflict rule; the env flag actually gating the picker.
