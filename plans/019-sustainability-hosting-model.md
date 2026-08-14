# Plan 019: Decide and seam the sustainability model — free core, BYOK, self-hosted satellites, optional paid tier

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat 46c966b..HEAD -- docs/ apps/server/src/db/schema apps/server/src/lib deploy.yml`
> REQUIRES plan 007 (AI ADR) DONE (this extends its key policy) and plan 008's
> `lib/crypto.ts` sealing helper (or ships it identically if 008 hasn't
> landed — see Step 3). On excerpt mismatch, STOP.

## Status

- **Priority**: P2* (decision plan — cheap, and it unblocks how 009/012/017's
  costly features are offered; run early in wave 2, right after 007)
- **Effort**: M (ADR + one concrete increment: per-user BYOK; satellite = design doc)
- **Risk**: LOW-MED
- **Depends on**: plans/007 (hard); 008's crypto helper (soft); 001/002 referenced
- **Category**: direction (ADR + spike + one build increment)
- **Planned at**: commit `46c966b`, 2026-08-14

## Why this matters

The maintainer's constraint set is now explicit: the product stays **free
and open source**, but some capabilities cost real money per user — file
storage at course-archive scale, OCR, transcription, and any future
inference — and cannot be offered unlimited on the operator's wallet. The
candidate answers are (a) per-user **BYOK** (user's own API keys), (b)
**BYOS** — the user self-hosts a small "satellite" for costly capabilities
(storage, inference) while keeping the official interface at avermate.fr and
the mobile app, (c) an optional **paid tier** on the hosted instance, and
(d) **full self-host** (already possible via `deploy.yml` "avec pas mal de
tinkering"). These change schema seams (per-user keys, per-user storage
provider) that plans 009/012/017 will otherwise hardcode around — so the
decision must be recorded NOW, with one concrete increment (per-user BYOK)
built, the satellite protocol designed on paper, and self-host polished from
tinkering to documented path.

## The decision to record (advisor recommendation — maintainer may amend)

1. **The core is free, forever, on the hosted instance**: everything whose
   marginal cost is rows in libSQL — grades, subjects, analytics, goals,
   agenda/kanban, fiches/mindmaps/slides authoring, social, MCP access.
   Costly capabilities are the exception, not the product.
2. **Costly capabilities ship BYOK-first**: OCR (plan 009), transcription
   (plan 012), and future inference read a per-user sealed key BEFORE the
   operator env key; the operator key (plan 007's policy) becomes an
   instance-level default the operator may quota or disable. Storage stays
   operator-paid within a per-user quota (roadmap #10); beyond quota →
   BYOS or paid tier.
3. **BYOS "satellite" is the open-source answer to premium**: a small,
   separately-shipped container the user runs (home server, free-tier VPS)
   exposing versioned HTTP APIs for `storage` (S3-compatible or filesystem)
   and later `inference` (OpenAI-compatible proxy to their local model). The
   hosted app calls the user's satellite server-to-server for those
   capabilities; data lives on the user's hardware. Wave-scope: PROTOCOL
   DESIGN ONLY (Step 4) — building it is its own future plan.
4. **A paid tier is legitimate but LAST**: only after BYOK + quotas exist,
   only covering metered costs (storage/AI minutes), never gating core
   features. No billing code in this plan.
5. **Full self-host is a supported path, not a dark art**: `deploy.yml` +
   env docs get a "Self-hosting" doc pass so the whole stack (including
   every "premium" capability with the user's own keys) runs on one compose
   file. Ties to the open-source license decision (roadmap #8) — a hosted
   product with self-host parity is the AGPL sweet spot; record the license
   question as REQUIRED-BEFORE-PUBLIC in the ADR.

## Current state

- Plan 007's ADR set operator-env keys + `DISABLE_*` hatches
  (`lib/env.ts:46-53` pattern) and named per-user BYOK as the follow-up —
  this plan IS that follow-up.
- Key seams already planned to consume a per-user lookup: `lib/ocr.ts`
  (plan 009 maintenance notes), `lib/transcription.ts` (plan 012).
- Sealing helper: plan 008 ships `lib/crypto.ts` (AES-256-GCM, HKDF from
  `BETTER_AUTH_SECRET`, `v1.<iv>.<ct>.<tag>` format).
- Storage indirection seam already exists in plan 001's schema:
  `files.provider` (default `"uploadthing"`) + `storageKey` — a satellite
  storage backend is a second provider value, which is why the satellite can
  be designed without rewriting the files domain.
- Settings surface: `apps/web/src/app/(app)/settings/integrations/` exists
  (plan 008 uses it for sync connections; BYOK keys belong beside them).
- Self-host today: `deploy.yml` (Traefik + api + web), README "Production
  and deployment" section with 5 manual prerequisites; no dedicated
  self-host doc.
- Precedent for user-level config with server secrets: `syncConnections`
  (sealed credentials, never returned to clients).

## Commands you will need

| Purpose | Command | Expected |
|---------|---------|----------|
| Migration | `bun run db:generate` && `bun run db:migrate` | exit 0 |
| Tests | `bun run --cwd apps/server test` | exit 0 |
| Full gate | `bun run format:check && bun run lint && bun run check-types && bun run test && bun run build` | exit 0 |

## Scope

**In scope**:
- `docs/sustainability.md` (create — the ADR, Step 1)
- `apps/server/src/db/schema/user-service-keys.ts` (create) + export + migration
- `apps/server/src/lib/service-keys.ts` (create: sealed CRUD + resolution order) + `requireServiceKey`-style ownership
- `apps/server/src/routers/service-keys.ts` (create) + `routers/index.ts`
- Wiring: the key-resolution call in `lib/ocr.ts` and `lib/transcription.ts` IF plans 009/012 have landed (else their plans inherit the helper — note in README which applied)
- `apps/web/src/app/(app)/settings/integrations/**` — "Mes clés API" section
- `docs/satellite-protocol.md` (create — design only, Step 4)
- `docs/self-hosting.md` (create — Step 5)
- Tests: `service-keys.test.ts`

**Out of scope**:
- Building the satellite container, any billing/Stripe code, storage quotas
  enforcement (roadmap #10), the license file itself (maintainer decision —
  the ADR only records that it blocks going public).
- Changing plan 001's storage provider implementation.
- Client-side key entry for direct-to-provider calls (keys are used
  server-side only; they never reach the browser).

## Git workflow

- Branch: `advisor/019-sustainability`; conventional commits
  (`docs: sustainability model ADR`, `feat(server): per-user BYOK service keys`).
- Do NOT push or open a PR unless instructed.

## Steps

### Step 1: Write `docs/sustainability.md`

The five decisions above, in the repo docs' voice, plus: the capability→
funding matrix (core=free / OCR=BYOK→operator-default / transcription=BYOK→
operator-default / storage=quota→BYOS-or-paid / inference=BYOK-or-satellite,
embedded agent stays governed by `docs/ai-architecture.md` triggers), and
the explicit note that the LICENSE decision (AGPL-3.0 vs MIT, roadmap #8)
must precede any public "open source" claim — README currently forbids
redistribution by omission.

**Verify**: file exists; `grep -n "BYOK\|satellite\|AGPL" docs/sustainability.md` → all three present.

### Step 2: Per-user service keys schema

```ts
export type ServiceKeyKind = "mistral" | "transcription" | "inference";

export const userServiceKeys = sqliteTable("user_service_keys", {
  id: text().notNull().primaryKey().$defaultFn(() => newId("ukey")),
  kind: text().$type<ServiceKeyKind>().notNull(),
  /** AES-256-GCM sealed — same helper and format as syncConnections. */
  sealedKey: text().notNull(),
  /** Last 4 chars, for the settings UI ("…x4f2"). Never more. */
  hint: text().notNull(),
  status: text().$type<"active" | "invalid">().notNull().default("active"),
  userId: owner(),
  ...timestamps,
}, (t) => [uniqueIndex("user_service_keys_user_kind_unique").on(t.userId, t.kind)]);
```

**Verify**: migration + `bun run check-types` exit 0.

### Step 3: Resolution helper + router + UI

`lib/service-keys.ts`: `setKey(userId, kind, plaintext)` (seal + upsert +
hint), `clearKey`, and THE function everything consumes —
`resolveServiceKey(userId, kind): Promise<{ key: string; source: "user" | "operator" } | null>`
— user key first, operator env fallback (`MISTRAL_API_KEY` /
`TRANSCRIPTION_API_KEY`), null when neither (callers keep their existing
`badRequest` disabled-messages, now mentioning "ajoutez votre clé dans
Réglages → Intégrations"). If plan 008's `lib/crypto.ts` is absent, create it
here EXACTLY as plan 008 specifies (same file path, format, tests) so the two
plans converge on one helper. Router `serviceKeys` (`list` returns kind+
hint+status ONLY, `set`, `clear`); settings UI section with masked inputs.
Wire `resolveServiceKey` into `lib/ocr.ts`/`lib/transcription.ts` where they
exist; mark key `invalid` on a provider 401 (one status write, no retry
storm).

**Verify**: `service-keys.test.ts`: seal/hint roundtrip, resolution order
(user beats operator; operator when no user key; null when neither),
`list` never contains sealed material (assert response shape), 401→invalid
transition. `grep -rn "sealedKey" apps/server/src/routers/service-keys.ts`
shows writes only.

### Step 4: `docs/satellite-protocol.md` (design only)

≤ 120 lines: the satellite is a user-run container exposing `/v1/health`,
`/v1/storage/*` (put/get/delete by key — S3-subset semantics) and reserved
`/v1/inference/*` (OpenAI-compatible passthrough); auth = a pairing token
minted in avermate settings, sealed server-side like sync credentials, sent
as a bearer from the MAIN SERVER ONLY (browser never talks to the
satellite); registration UX sketch (paste satellite URL + pairing code,
health-check, capability discovery); failure semantics (satellite down ⇒
feature degrades with a clear banner, core app unaffected); how it plugs the
existing seams (`files.provider = "satellite"`, `resolveServiceKey` kind
`"inference"` pointing at the satellite). End with the open questions list
(TLS for home servers / tunneling, bandwidth, backup story) — the future
build plan's starting point.

**Verify**: doc exists; browser-never-contacts-satellite stated explicitly.

### Step 5: `docs/self-hosting.md`

From README's production section + `deploy.yml`: a start-to-finish self-host
walkthrough (compose up, env checklist incl. every optional key, migration
behavior, upgrade procedure, backup note for libSQL file/Turso), and a
"parity statement": self-hosters get every capability with their own keys —
nothing is license-gated. Link it from README's deployment section (one line
added there).

**Verify**: `grep -n "self-hosting" README.md` → 1 match; format gate passes.

### Step 6: Full gate

**Verify**: all root gates exit 0.

## Test plan

Step 3's list (≥6 cases) on the standard in-memory bootstrap. Docs verified
by grep + format gate. No billing, no satellite code to test.

## Done criteria

- [ ] `docs/sustainability.md` records the five decisions + funding matrix + license blocker
- [ ] `user_service_keys` migrates; resolution order test-proven; responses never contain sealed material
- [ ] Settings UI manages keys (masked, hint-only display)
- [ ] `docs/satellite-protocol.md` (design) and `docs/self-hosting.md` (walkthrough) exist; README links the latter
- [ ] All root gates exit 0; `git status` clean outside scope; `plans/README.md` updated

## STOP conditions

- Plan 007's ADR absent (the policy this extends) — run 007 first.
- A second sealing implementation already exists diverging from plan 008's
  spec — reconcile to ONE helper, or STOP if formats conflict on disk.
- Anyone (including the plan reader) proposes returning a decrypted key to
  any client or browser — that is a design violation, not an option.

## Maintenance notes

- The satellite BUILD plan (future) starts from `docs/satellite-protocol.md`
  and plan 001's `files.provider` seam; the paid tier starts from the
  funding matrix + quota enforcement (roadmap #10).
- When the embedded agent's ADR trigger fires, `"inference"` keys +
  satellites are its funding path — the seams are now in place.
- Reviewer attention: hint length (4 chars max), the 401→invalid single
  transition, and that operator-key fallback keeps working for existing
  deployments with zero migration.
