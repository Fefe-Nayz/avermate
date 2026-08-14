# Plan 007: Record the AI-access architecture decision (MCP-first, embedded agent deferred, key policy)

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat 46c966b..HEAD -- docs/ apps/server/src/mcp apps/server/src/lib/env.ts`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1 (first of wave 2 — its decisions shape plans 009–012)
- **Effort**: S-M (writing + one small schema-spec section; no feature code)
- **Risk**: LOW
- **Depends on**: none
- **Category**: direction (ADR / design record)
- **Planned at**: commit `46c966b`, 2026-08-14

## Why this matters

Three open product questions block the AI-facing half of the study-companion
merge: (1) should avermate ship an embedded chat agent, or stay MCP-only and
let external agents (Claude, any MCP client) do the driving? (2) should
authoring workflows (fiches, exports) be exposed as MCP *tools* or as
"skills"? (3) for paid AI services (OCR, transcription, inference), whose key
pays — the instance operator, the user (BYOK), or a bundled offering?
Leaving these implicit means each of plans 009–012 would re-litigate them.
The maintainer has asked for a recommendation to be recorded; this plan writes
the ADR with the decision below, plus the two pieces of groundwork that keep
the deferred option cheap (the branching chat schema spec and the server-side
approval principle).

## The decision to record (advisor recommendation — maintainer may amend)

1. **MCP-first; no embedded agent in wave 2.** The MCP server is already
   protocol-tested with OAuth 2.1, 7 scopes, and multi-round destructive
   confirmation, and it delegates 100% to oRPC procedures — every capable MCP
   client gets the full study-companion surface at zero inference cost to the
   project. An embedded agent adds hosting/inference cost, a streaming
   transport, and a chat UI for capability that MCP clients already have.
2. **Revisit triggers** (any one is enough to green-light the embedded agent):
   (a) mobile-first users with no MCP-capable client become a real audience;
   (b) a server-side AI feature ships anyway (transcript summaries,
   auto-titling) so inference cost is already accepted; (c) the fiche editor
   needs an inline copilot UX that out-of-app clients cannot deliver.
3. **Tools + prompts, not "skills".** MCP tools are the typed verbs
   (create/read/update/build); MCP *prompts* are the server-shipped packaged
   workflows — the fiche methodology, "build a revision sheet from chapter X"
   — and MCP *resources* carry the course context. "Skills" are a
   client-side concept the server cannot install; the server-side equivalent
   IS the prompt catalog (4 prompts already exist at `mcp/server.ts:2070-2159`
   — pre-003 layout — proving the mechanism). If an embedded agent lands
   later, it consumes the same tools/prompts.
4. **Key policy: operator-configured now, per-user BYOK when social rollout
   demands, bundled billing only with a hosted embedded agent.** The repo's
   existing pattern is operator env keys for optional integrations
   (`RESEND_API_KEY`, `UPLOADTHING_TOKEN` at `lib/env.ts:46-53`, each with a
   `DISABLE_*` escape hatch); OCR (plan 009) and transcription (plan 012)
   follow it (`MISTRAL_API_KEY`, `TRANSCRIPTION_API_KEY`). Per-user encrypted
   BYOK becomes a follow-up once instances host users the operator won't pay
   for; it is out of wave 2.

## Current state

- MCP server: `apps/server/src/mcp/` — scopes at `lib/auth.ts:24-32`;
  destructive MRTR primitive `runDestructive` (pre-003: `mcp/server.ts:257-353`);
  tools delegate via `createRouterClient(appRouter, { context })`
  (`server.ts:372`). `docs/mcp.md` documents the surface.
- Prompt catalog exists: 4 prompts registered (pre-003 layout at
  `mcp/server.ts:2070-2159`).
- Env integration pattern: `apps/server/src/lib/env.ts:46-53` (optional keys +
  `DISABLE_EMAIL`/`DISABLE_UPLOADS` escape hatches).
- Prototype evidence to cite in the ADR (from the deleted prototype at
  `github.com/Fefe-Nayz/Fichr`, commit `b8c5714`, audited 2026-08-14):
  - Branching message schema that worked:
    `messages(parent_message_id, branch_index, client_message_id, parent_client_message_id, tool_calls, ...)`
    (`webapp/backend/app/database.py:28-31` at that commit). Client-ID pairs
    solved optimistic-UI reconciliation for streamed messages.
  - 12-tool agent catalogue validated by real use (list/get/search documents,
    project & document CRUD, build, workspace info) — maps onto plans 005/010/011.
  - Negative lesson: `execute_command` ran `subprocess.run(shell=True)` on
    model-chosen strings with a 4-substring denylist and an "approval" flag
    that was UI-only decoration (`chat.py:751-773`). The ADR must forbid this
    shape: **approval is enforced server-side or the tool does not exist.**
    The MRTR primitive is the compliant mechanism.
- No ADR directory exists; `docs/` holds 5+ flat topic files (`mcp.md`,
  `charts.md`, `ssr-data-loading.md`, `social-privacy.md`,
  `feature-parity.md`, plus any added by plans 005+). Match that flat style.

## Commands you will need

| Purpose | Command | Expected on success |
|---------|---------|---------------------|
| Format gate (docs are prettier-checked via web workspace) | `bun run format:check` | exit 0 |
| Full gate | `bun run lint && bun run check-types && bun run test` | exit 0 (nothing should change) |

## Scope

**In scope**:
- `docs/ai-architecture.md` (create — the ADR)
- `plans/README.md` (status row)

**Out of scope** (do NOT touch):
- Any code, schema, or MCP registration — this plan writes a decision, not a
  feature. The chat schema below is a SPEC section inside the ADR, not a
  migration.
- `docs/mcp.md` — untouched until plans 010/011 change the surface.

## Git workflow

- Branch: `advisor/007-ai-architecture-adr` from `rewrite`.
- One commit, e.g. `docs: record the AI access architecture decision`.
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Write `docs/ai-architecture.md`

Structure (≤ ~180 lines, match the existing docs' plain, first-person-plural
prose style — see `docs/mcp.md` for voice):

1. **Decision** — the four numbered points from "The decision to record"
   above, stated as decisions (not options).
2. **Context** — one paragraph: the study-companion merge makes avermate an
   AI-legible workspace; the question is where the agent lives.
3. **Consequences** — what each wave-2 plan inherits: plans 009/012 use
   operator env keys with `DISABLE_*` hatches; plan 010's authoring surface is
   tools + prompts; plan 011 registers prompts, not bespoke chat endpoints; no
   chat tables ship in wave 2.
4. **Embedded-agent readiness spec** (the part that keeps the deferred option
   cheap) — two short subsections:
   - *Chat schema, when it comes*: messages carry `parentMessageId`,
     `branchIndex`, `clientMessageId`, `parentClientMessageId`, `toolCalls`
     from day one (cite the prototype's proof); conversations are
     year-scoped and user-owned like every other entity.
   - *Approval rule*: any AI-triggered mutating action goes through a
     server-enforced approval (the MRTR pattern) or a scope the user granted;
     client-side approval flags are forbidden. `execute_command`-shaped tools
     are banned outright.
5. **Revisit triggers** — the three from the decision, verbatim, plus "review
   this ADR when any fires".

**Verify**: file exists; `grep -n "MCP-first" docs/ai-architecture.md` → ≥1
match; `grep -in "execute_command" docs/ai-architecture.md` → ≥1 match (the
ban is stated).

### Step 2: Gates

**Verify**: `bun run format:check && bun run lint && bun run check-types && bun run test` → all exit 0 (no code changed; this catches accidental edits).

## Test plan

None — documentation only. The full gate run proves no code was touched.

## Done criteria

- [ ] `docs/ai-architecture.md` exists with the four decisions, the readiness
      spec, and the revisit triggers
- [ ] No file outside the in-scope list modified (`git status`)
- [ ] All root gates exit 0
- [ ] `plans/README.md` status row updated

## STOP conditions

- A `docs/ai-architecture.md` or ADR directory already exists with a
  conflicting decision — reconcile with the maintainer instead of overwriting.
- You find an embedded agent or chat table already landed in the codebase
  (the decision has been overtaken by events).

## Maintenance notes

- Plans 009–012 cite this ADR; if the maintainer amends a decision here,
  re-read those plans for consistency before executing them.
- When a revisit trigger fires, the embedded-agent build plan should lift the
  readiness spec into a real schema and reuse plan 010's tools as its tool
  belt — that was the point of writing it down now.
