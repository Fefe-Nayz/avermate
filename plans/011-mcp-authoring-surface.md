# Plan 011: Expose document authoring to agents — MCP tools and the fiche-methodology prompts

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat 46c966b..HEAD -- apps/server/src/mcp apps/server/src/lib/auth.ts apps/server/src/routers/documents.ts docs/mcp.md`
> REQUIRES plans 003 (MCP layout), 005 (materials) and 010 (documents) DONE —
> verify their Done criteria first. 009 (OCR) is soft but makes the prompts
> genuinely useful. On excerpt mismatch, STOP.

## Status

- **Priority**: P2 (wave 2)
- **Effort**: M
- **Risk**: LOW-MED (catalog determinism + revision-safe writes)
- **Depends on**: plans/003, 005, 010 (hard); 009 (soft)
- **Category**: direction
- **Planned at**: commit `46c966b`, 2026-08-14

## Why this matters

The ADR (`docs/ai-architecture.md`, plan 007) settled the question "tools or
skills?": MCP **tools** are the typed verbs, MCP **prompts** are the
server-shipped workflows, and any capable agent — Claude or another MCP
client — becomes the study assistant without avermate hosting inference. Plan
010 built the documents domain; this plan puts it in agents' hands: read and
write fiches (revision-fenced so concurrent edits stay safe), plus a prompt
catalog that encodes the CPGE fiche methodology the maintainer's prototype
validated. This is the moment "rédiger des fiches via n'importe quel agent"
becomes true.

## Current state

- Post-003 MCP layout: one module per surface under
  `apps/server/src/mcp/surfaces/`, each exporting an `McpSurface`
  (`{ scopes, requiresAdminRole?, register(ctx) }`), ordered in
  `surfaces/index.ts` (append-only to keep the deterministic catalog stable);
  shared kit (zod fragments, `meta(...scopes)`, `runDestructive`, MRTR codec)
  in `mcp/shared.ts`. Scopes declared in `lib/auth.ts:24-32` (`MCP_SCOPES`),
  short-lived entries in `scopeExpirations` (`:211-216`).
- Prompts and resources already exist as a mechanism (4 prompts + 5 resources
  + 3 templates registered pre-003 at `mcp/server.ts:1952-2159`, now in their
  surface modules) — extend, don't invent.
- The harness pins the catalog: deterministic-catalog test (near
  `protocol.harness.ts:371`) and scope-isolation test (near `:637`) both
  enumerate tool names; every new tool updates both.
- Plan 010's router surface (delegation targets): `documents.list/get/create/
  update/delete`, where `update` requires the current `revision` and rejects
  stale writes — the property that makes agent edits safe.
- Plan 005's materials read tools exist (`materials.folders.list`,
  `materials.documents.list/get`); plan 009 added
  `materials.documents.transcript`.
- The prototype's validated agent verbs (audit of `Fichr@prototype`,
  `chat.py:1089-1180`): list/get/search documents, project & document CRUD,
  build — this plan's catalog is that list minus `execute_command` (banned by
  the ADR) and minus build (exports deferred by plan 010).
- Fiche methodology content (for the prompts): the five callouts
  `[!DEF] [!THM] [!METH] [!PIEGE] [!CHECK]` (plan 010) descending from the
  prototype's `BoxDef/BoxThm/BoxMeth/BoxPit/BoxCheck` LaTeX vocabulary.

## Commands you will need

| Purpose | Command | Expected |
|---------|---------|----------|
| Tests (incl. MCP harness) | `bun run --cwd apps/server test` | exit 0 |
| Full gate | `bun run format:check && bun run lint && bun run check-types && bun run test && bun run build` | exit 0 |

## Scope

**In scope**:
- `apps/server/src/lib/auth.ts` (add `avermate:documents.read`, `avermate:documents.write` to `MCP_SCOPES`)
- `apps/server/src/mcp/surfaces/documents.ts` (create) + one appended entry in `surfaces/index.ts`
- `apps/server/src/mcp/surfaces/prompts.ts` (extend with the two new prompts)
- `apps/server/src/mcp/protocol.harness.ts` (enumeration updates ONLY)
- `docs/mcp.md` (scope + surface tables, prompt list)

**Out of scope**:
- Any change to `routers/documents.ts` beyond what plan 010 shipped — tools
  DELEGATE; if a verb is missing server-side, STOP rather than adding it here.
- Export tools (no export exists yet — plan 010 deferred it).
- A search tool (no search infra exists; the prompts instruct agents to browse
  via list/get/transcript instead).
- Embedded chat, streaming endpoints, any `execute_command`-shaped tool
  (banned by `docs/ai-architecture.md`).

## Git workflow

- Branch: `advisor/011-mcp-authoring`; conventional commit
  (`feat(server): MCP documents surface and fiche prompts`).
- Do NOT push or open a PR unless instructed.

## Steps

### Step 1: Scopes

Add `"avermate:documents.read"` and `"avermate:documents.write"` to
`MCP_SCOPES`. No `scopeExpirations` entry (default lifetime — same risk class
as planner/materials writes). `docs/mcp.md` scope table gains both rows.

**Verify**: `grep -n "avermate:documents" apps/server/src/lib/auth.ts docs/mcp.md` → matches in both.

### Step 2: The documents surface

`mcp/surfaces/documents.ts`, one `McpSurface` per the post-003 contract,
appended LAST in `surfaces/index.ts`:

- Read scope: `documents.list` (year + optional folder), `documents.get`
  (returns `bodyMarkdown`, `revision`, references, timestamps — the agent
  must echo `revision` back to write).
- Write scope: `documents.create` (kind/title/folder/subject/initial body),
  `documents.update` — thin delegation to the oRPC procedure; its
  description MUST tell the agent: "Read the document first; pass the
  `revision` you read. A stale revision is rejected — re-read and reapply."
  (the server enforces it regardless), and `sources` to maintain references.
- Destructive: `documents.delete` via `runDestructive` + required uuid
  `idempotencyKey`, copying the registration shape of an existing destructive
  tool.
- Every handler is `call(() => api.documents.x(input))` — no logic in the MCP
  layer.

Update the harness's deterministic-catalog and scope-isolation enumerations
with the five names.

**Verify**: `bun run --cwd apps/server test` → exit 0 (harness green: catalog
matches, documents tools invisible without the new scopes).

### Step 3: The prompt catalog

Extend the prompts surface with two prompts (registered in the existing
prompt style; keep names kebab-case):

1. `fiche-methodology` — no args. Returns the house method as instructions:
   structure a fiche as Définitions → Théorèmes → Méthodes → Pièges →
   Checklist using the `[!DEF] [!THM] [!METH] [!PIEGE] [!CHECK]` callouts,
   math in `$…$`/`$$…$$`, keep it one-screen-per-chapter, cite source
   documents by title. (This is the "skill" the server ships to every agent.)
2. `fiche-from-chapter` — args: `folderId` (the chapter's materials folder),
   optional `focus`. Returns instructions to: list the folder's documents,
   read available transcripts (`materials.documents.transcript`; note that
   untranscribed PDFs can be transcribed with `materials.documents.transcribe`
   when the write scope is granted), then `documents.create` a fiche in that
   folder following `fiche-methodology`, and report what it could not read.

Prompt text is English like the rest of the catalog (agents localize output
to the user; the existing 4 prompts set the precedent — verify and match).
`docs/mcp.md` prompt list updated.

**Verify**: harness enumerations updated for prompts if they are pinned
(check the deterministic-catalog test's prompt expectations); full server
suite exit 0.

### Step 4: Full gate

**Verify**: all root gates exit 0.

## Test plan

The protocol harness is the specification: catalog determinism, scope
isolation, and (add one case) a `documents.update` round-trip through the MCP
layer against the in-process client proving the revision fence surfaces as a
tool error the agent can react to — model on the harness's existing
ownership test ("oRPC remains authoritative", near `protocol.harness.ts:687`).

## Done criteria

- [ ] Both scopes in `MCP_SCOPES` and `docs/mcp.md`
- [ ] Five documents tools registered, appended last; harness green
- [ ] Both prompts registered and listed in `docs/mcp.md`
- [ ] Revision-fence round-trip covered in the harness
- [ ] `grep -rn "execute_command\|subprocess\|shell" apps/server/src/mcp` → no matches
- [ ] All root gates exit 0; `git status` clean outside scope; `plans/README.md` updated

## STOP conditions

- Plans 003/005/010 not actually DONE (missing layout, tree, or domain).
- The catalog test fails for anything other than the new enumerated names.
- A needed verb does not exist in `routers/documents.ts` — report; do not add
  server procedures from this plan.
- Prompt registration order changes existing prompt output (determinism).

## Maintenance notes

- When exports land (plan 010's deferred seam), add `documents.export` here
  as a write-scope tool returning a `jobId`.
- When the embedded agent ever ships (ADR triggers), it consumes exactly this
  surface — resist building it a private one.
- Reviewer attention: tool descriptions (they are agent-facing UX — the
  revision instruction and the transcribe hint carry real behavioral weight),
  and append-only ordering in `surfaces/index.ts`.
