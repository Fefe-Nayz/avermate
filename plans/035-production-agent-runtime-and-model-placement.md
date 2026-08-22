# Plan 035: Production agent runtime and model placement

> **Executor instruction**
>
> Read this file, plans 025–034, `docs/ai-architecture-v2.md`, and the current
> implementations under `packages/agent-contracts`, `apps/server/src/agent`,
> `apps/server/src/assistant`, `apps/server/src/tools`, and
> `apps/web/src/components/assistant` before editing source. Start with the drift
> commands below. If an invariant, migration number, provider contract, or
> production wiring described here has changed, update this plan with evidence
> before implementation. Do not substitute framework-owned persistence for the
> Avermate stores and do not include React Native work.

## Status

- **Status**: TODO — execute only after the 025–034 implementation wave is
  committed and its remaining blockers are recorded
- **Priority**: P0
- **Effort**: XL
- **Risk**: CRITICAL
- **Depends on**: 025–032; consumes the safe artifact commands from 033 and the
  accounting boundary from 034
- **Blocks**: production activation of the embedded assistant and plans 036–039
- **Category**: agent runtime, model routing, placement, Web product
- **Planned at**: 2026-08-22, branch `rewrite`
- **Evidence baseline**: `15a8897ce1eb82c2807f5547d9f558a59ad9a2e1`

## Outcome

Make the existing Web assistant a production client of one durable Avermate
`AgentRuntime`. A run may execute on an explicitly selected Core/BYOK, paired
Node, or managed placement, but it keeps the same event protocol, conversation
DAG, tool broker, citations, approval ledger, usage records, cancellation and
crash-recovery semantics everywhere.

The plan is complete only when production no longer instantiates the temporary
read-only orchestration loop directly, every advertised model is backed by a
validated placement, and a killed run can be resumed without duplicating a
provider dispatch or tool effect.

## Current-state evidence and gaps

1. `docs/ai-architecture-v2.md:15-23` ratifies LangGraph behind the Avermate
   `AgentRuntime`, not as a domain model or persistence authority.
2. `apps/server/src/assistant/services.ts:219-225` still constructs
   `ReadOnlyAssistantRunService` directly for production.
3. `apps/server/src/assistant/run-service.ts:205-966` contains a second manual
   model/tool loop. Its safety checks are useful, but the loop duplicates the
   runtime seam proved by plan 026.
4. `apps/server/src/assistant/services.ts:50-111` advertises only Mistral Small
   and resolves only the Mistral service key, although settings already validate
   Mistral, OpenAI, OpenRouter and ElevenLabs keys.
5. `apps/server/src/assistant/run-service.ts:899-914` forces broker execution to
   `read-only`; plan 030 already has the authoritative approval/action path for
   the reviewed mutation allowlist.
6. The current Web shell already implements thread navigation/search, rename,
   star/archive/trash, attachments, references, dictation, model/skill/plan
   controls, streaming events, tool/status/usage parts, citations, edit/retry
   branches, snapshots, export and project save. This plan wires and hardens
   those surfaces; it does not rebuild them.
7. Plan 029's deterministic citation evaluation and UI tests are green, but no
   pinned real-provider annotated evaluation has yet justified production
   rollout.
8. Plan 031 has provider and snapshot contracts, but no live attested sandbox is
   available in this checkout. Sandbox-requiring tools must remain unavailable
   until that independent conformance gate passes.

## Mandatory drift check

Run and attach the output to the implementation PR or local evidence record:

```text
git rev-parse HEAD
git status --short
rg -n "new ReadOnlyAssistantRunService|class ReadOnlyAssistantRunService" apps/server/src
rg -n "AgentRuntime|ModelGateway|approvalMode" packages/agent-contracts apps/server/src
rg -n "mistral-small-latest|openrouter|openai" apps/server/src/assistant apps/server/src/lib
bun run verify:029:citations
bun run --cwd packages/agent-contracts test
```

STOP and amend this plan before coding if production already uses a different
runtime, if another service owns the conversation DAG, or if plan 030's action
ledger has been bypassed.

## Product and security invariants

- `CoreConversationStore` or the selected Node `ConversationStore` remains the
  canonical conversation authority. LangGraph checkpoints are execution state,
  not message history.
- One run has immutable `modelKey`, `providerKey`, placement, policy revision,
  tool-catalog revision, context-manifest digest and branch identity.
- Provider dispatch uses a persisted claim/CAS. A crash may resume or require
  inspection; it may never silently issue the same non-idempotent request twice.
- All domain reads and writes cross `ToolBroker`. The harness and model provider
  never receive a database client, school credential, storage credential or
  long-lived node secret.
- Approval modes mean exactly `read-only`, `confirm-writes` and
  `auto-reversible`. The last mode is allowed only for a descriptor whose
  compensation and resource fences passed plan 030.
- Conversation events expose visible plan, todo, status, tool calls, sources,
  usage and provider-approved summaries. Raw hidden chain of thought is never
  stored or rendered.
- BYOK, Node and managed placements are explicit. There is no silent paid
  fallback, provider substitution or Core mirror of a Node-owned conversation.
- LiteLLM is an optional OpenAI-compatible managed adapter. It is not the domain
  gateway and is not required for self-hosting.
- OpenCode/OpenHands may later run as bounded specialist workers in a sandbox;
  neither is the Avermate harness.

## In scope

- One production `AgentRuntime` interface and LangGraph adapter behind it.
- Migration of the current read-only loop into runtime nodes while preserving
  its citation, context, tool and finalization protections.
- Provider-neutral model catalogue and placement resolution for configured
  direct/BYOK, Node-local, and future managed adapters.
- Persisted run claims, runtime checkpoint references, cancellation and resume.
- Reviewed plan-030 mutation modes through the same event stream.
- Web readiness/error/placement projections needed to make existing controls
  truthful.
- Real-provider quality, reliability, security and load gates.

## Out of scope

- New academic-domain mutations beyond the reviewed plan-030 catalogue.
- A general shell, arbitrary package install or code execution in the API.
- Replacing the Web renderer or redesigning the assistant shell.
- React Native.
- Enabling checkout, managed billing, or unattested sandbox profiles.
- Making one embedding/model vendor mandatory.

## Target architecture

```text
Web assistant / external MCP
            |
            v
  versioned Avermate run API
            |
            v
       AgentRuntime
    (LangGraph adapter)
      /      |       \
Conversation ToolBroker  Retrieval/Artifact jobs
Store        |             |
             v             v
       domain services  durable queue + SandboxProvider
            \
             v
          ModelGateway
      direct | node | managed
```

`assistant-ui` remains a projection of server-owned state through its
ExternalStore adapter. Vercel AI SDK adapters may normalize provider streams;
they do not own the DAG, checkpoint store, approval state or usage ledger.

## Required implementation slices

### 1. Freeze runtime and placement contracts

- Extend `packages/agent-contracts` with versioned schemas for:
  `AgentRunRequest`, `AgentRunLease`, `AgentCheckpointRef`, `ModelPlacement`,
  `ProviderDispatchClaim`, `NormalizedUsage`, and typed terminal reasons.
- Require exact owner/thread/branch/run, conversation placement, model revision,
  provider revision, context digest, tool-catalog revision and approval mode.
- Add compatibility tests that reject unknown protocol major versions and
  preserve unknown additive event fields only where the envelope allows them.
- Keep framework types out of schemas and persisted tables.

### 2. Make `AgentRuntime` the only production entrypoint

- Add a production runtime factory under `apps/server/src/agent`.
- Move prompt/context construction, model invocation, tool routing,
  finalization and checkpoint transitions out of direct service wiring and into
  explicit graph nodes.
- Adapt existing `CoreConversationCheckpointStore`; do not create a second
  checkpoint table.
- Persist a dispatch claim before the first provider byte. Record whether the
  provider supports a stable request/idempotency key and classify uncertain
  crash windows as `inspect-required`.
- Reconcile `queued`, `running`, `waiting-approval`, `cancelling`, interrupted
  and orphaned runs at startup and from a durable maintenance job.
- Delete the duplicate production loop only after parity tests compare events,
  citations, usage and tool decisions for the same fixtures.

### 3. Generalize model discovery and credentials

- Define provider adapters behind the existing `ModelGateway` for Mistral,
  OpenAI, OpenRouter/OpenAI-compatible endpoints and paired Node models.
- Derive the per-user catalogue from validated service keys plus available Node
  capabilities. Never advertise a model whose credential/endpoint/placement is
  unavailable.
- Keep hosted custom endpoints public-HTTPS-only with DNS snapshot pinning,
  redirect restrictions, byte/time limits and origin-bound credentials.
- Support local/private endpoints only through a paired Node transport; hosted
  Core must not SSRF into a user's LAN.
- Store model/provider revision and normalized input/output/cached/reasoning
  token accounting with every run. Unknown provider usage is visible as unknown,
  never guessed.
- Add LiteLLM only as an optional adapter selected by configuration; direct
  adapters and Node-local OpenAI-compatible models must remain first-class.

### 4. Route tools, approvals and artifacts without privilege drift

- Build the runtime tool list only from the exact ToolBroker catalogue revision.
- Preserve plan 029's read-only default and explicit citation protocol.
- When a user selects `confirm-writes`, emit a persisted approval request and
  suspend the graph. Resume only from the sealed, single-use plan-030
  continuation.
- In `auto-reversible`, filter to descriptors proven reversible at that exact
  version; all other writes still require confirmation.
- Route artifact generation to durable jobs. A sandbox-required descriptor is
  unavailable until its exact plan-031 profile and image evidence are current.
- Project action IDs and compensation state into the existing tool-call UI so
  undo calls the authoritative action service rather than mutating local state.

### 5. Complete the Web production wiring

- Keep `apps/web/src/components/assistant` and the existing app route as the
  shell. Remove or clearly label any remaining development-only projection.
- Hydrate a server-provided capability/readiness model before enabling send.
- Make provider/placement unavailable states actionable: missing key, Node
  offline, model removed, sandbox unavailable, quota denied, approval expired.
- Display model and placement on each run; changing the selector affects only a
  new branch/run and never rewrites historical metadata.
- Preserve edit/retry branching, cursor replay, SSE-to-poll fallback, dictation
  cleanup, attachments, export, citations and rich rendering.
- Add accessibility coverage for streaming announcements, approval focus,
  keyboard thread navigation and reduced motion.

### 6. Production evaluation and rollout

- Create a redacted, versioned school corpus covering grades, average semantics,
  materials, OCR, planning and provider-owned fields.
- Record at least two pinned real provider/model configurations. Score citation
  faithfulness/precision/coverage, abstention, tool selection, mutation-policy
  compliance and French answer quality.
- Add fault injection at every provider dispatch/checkpoint/finalization window,
  plus SSE disconnect/replay, Node reconnect and approval expiry.
- Load-test concurrent runs with bounded per-owner fairness, cancellation latency
  and no event sequence gaps.
- Roll out in stages: staff fixture accounts, opt-in development, invite-only
  read-only, invite-only confirmed writes. Each stage has a kill switch and
  rollback to read-only without data migration.

## Data and migration rules

- Prefer existing assistant tables. Add a migration only for facts that cannot
  be represented by current run/checkpoint/usage records.
- Any new provider-dispatch table must have owner/run foreign keys, immutable
  request digest, state check constraints, uniqueness for the dispatch key and
  no raw prompt/credential duplication.
- Migrations are append-only after the plan-025 history decision. Test fresh DB,
  latest DB, pre-agent DB and a populated 025–034 fixture.
- Conversation deletion/export must include new checkpoint and provider metadata
  without leaking sealed continuations or provider secrets.

## Verification matrix

Minimum automated gates:

```text
bun run --cwd packages/agent-contracts test
bun run --cwd apps/server test src/agent src/assistant src/tools src/actions
bun run verify:029:citations
bun run --cwd apps/web test
bun run --cwd apps/web e2e -- assistant
bun run check-types
bun run lint
bun run format:check
bun run test
bun run build
```

Add dedicated machine-readable gates for:

- runtime parity against the old loop before deletion;
- exactly-once/inspect-required dispatch crash windows;
- every provider adapter's normalized event and usage contract;
- placement matrix: Core/BYOK, Node online/offline/reconnect, managed disabled;
- approval suspend/restart/resume and action undo projection;
- provider endpoint SSRF, redirect, body, deadline and secret-redaction attacks;
- real-provider annotated evaluation with pinned model and prompt revisions;
- 100 concurrent runs with no cross-owner event, context, usage or credential
  contamination.

## STOP conditions

STOP, preserve evidence and ask for a product/security decision if:

- a framework requires owning or reshaping the canonical conversation/domain
  tables;
- exactly-once provider behavior is claimed without a dispatch claim or an
  honest uncertain state;
- any placement requires hosted Core to contact a private user endpoint;
- the runtime needs a raw database/storage/school credential;
- an unreviewed mutation or unattested sandbox capability would have to be
  enabled to make a demo pass;
- a provider exposes only opaque reasoning and the implementation proposes to
  store/render it as chain of thought;
- a fallback would incur managed cost or move durable data without explicit user
  selection;
- plan-025 migration or licence blockers are being hidden as runtime success.

## Definition of done

- Production creates runs only through the versioned `AgentRuntime` factory.
- The duplicate manual orchestration loop is removed or retained solely as a
  test fixture with no production call site.
- At least one direct/BYOK provider and one paired-Node model placement pass the
  same conversation, tool, citation, cancellation, restart and usage contract.
- Read-only, confirmed writes and auto-reversible filtering behave exactly as
  plan 030 specifies; every other mutation fails closed.
- Existing Web assistant features work against the production runtime in
  Chromium, including edit/retry branches and reconnect replay.
- Real-provider annotated quality thresholds and security/load gates are stored
  as artifacts; deterministic fixtures are not presented as model quality.
- No raw chain of thought, long-lived secret, signed object URL or cross-owner
  content reaches messages, events, logs or exports.
- Documentation and capability UI state every unavailable provider/placement
  truthfully.

## Maintenance trigger

Re-run the provider, event, checkpoint, security and annotated evaluation matrix
whenever a model/provider SDK, prompt revision, ToolBroker catalogue, LangGraph
version, placement protocol or assistant event schema changes.
