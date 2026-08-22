# Plan 026: Agent architecture v2, durable event protocol and stack proof

> **Executor instructions**: Read the full plan and plan 025's recorded baseline.
> Complete the three proof slices before enabling any production assistant
> route. Run the listed contract/full-repository gates and update the 026 row in
> `plans/README.md` when all done criteria hold. Do not push or open a PR unless
> requested.
>
> **Drift check (run first)**: plan 025 must have replaced every “plan 025
> baseline SHA” placeholder. Run the command below, then reconcile any changed
> contract/event/runtime path with this plan; an unresolved protocol or
> trust-boundary mismatch is a STOP condition.
>
> ```powershell
> git diff --stat <baseline>..HEAD -- docs packages apps/server/src/agent apps/server/src/routes apps/web/src/components/assistant-spike package.json bun.lock
> ```

> [!IMPORTANT]
> The earlier “MCP-first, no embedded agent” ADR reached its documented revisit
> condition. Supersede it; do not delete it. MCP remains a first-class public
> client of Avermate tools, while the embedded assistant becomes a second client
> of the same policy and domain boundaries.

## Status

- **Status**: TODO
- **Priority**: P0
- **Effort**: M–L
- **Risk**: HIGH
- **Depends on**: 025
- **Blocks**: 027, 028, 029, 030, 031 and 032
- **Category**: architecture, protocol, security, dependency spike
- **Planned at**: 2026-08-22, branch `rewrite`
- **Planning baseline**: replace `37f0aff` with plan 025's clean baseline SHA

## Scope

**In scope**: the v2 ADR/threat model, shared event/runtime/model contracts,
development-only assistant projection, LangGraph/Mastra comparison and mocked
provider normalization under the exact paths in “Required source changes.”

**Out of scope**: production chat tables/UI, domain mutations, corpus indexing,
real sandbox execution, node transport, billing and any React Native work. The
spikes may add dependencies but cannot make an external control plane mandatory.

## Decision to ratify

Use the following separation of responsibilities:

| Concern                 | Selected direction                                                              | Deliberate non-choice                                          |
| ----------------------- | ------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| Web conversation shell  | `assistant-ui` ExternalStoreRuntime behind an Avermate adapter                  | assistant-ui as database or server protocol                    |
| Visual AI parts         | existing Avermate Markdown renderer plus selected AI Elements/shadcn components | AI Elements as conversation runtime                            |
| Frontend ↔ agent stream | stable AG-UI semantics inside a versioned, persisted Avermate envelope          | framework-native ephemeral chunks as the contract              |
| Harness                 | LangGraph JS Core behind `AgentRuntime`                                         | LangGraph Agent Server as a required hosted dependency         |
| Model access            | Avermate `ModelGateway`; direct AI SDK and OpenAI-compatible adapters           | Vercel AI Gateway or LiteLLM as mandatory infrastructure       |
| Operational gateway     | optional LiteLLM for managed/multi-tenant routing and budgets                   | Python proxy in the default dev loop                           |
| Coding/artifact agents  | optional bounded OpenCode/OpenHands workers                                     | OpenCode/OpenHands as the school assistant's source of truth   |
| External agents         | existing scoped MCP                                                             | a second private tool API                                      |
| Transport               | resumable SSE for chat/tool/progress events                                     | WebSocket unless bidirectional realtime voice proves necessary |

The architecture must keep four histories distinct and link them explicitly:

1. conversation message DAG;
2. harness checkpoints;
3. sandbox/workspace snapshots;
4. domain action/compensation ledger.

No library supplies all four. A LangGraph checkpoint does not restore a deleted
grade or a filesystem. Contracts and columns must use these non-interchangeable
names everywhere:

- `conversationCheckpointRef`: Avermate-owned harness/conversation state from
  which a run can resume or fork;
- `workspaceSnapshotRef`: an immutable, committed workspace-filesystem snapshot;
- `sandboxRuntimeCheckpointRef`: an optional provider-native VM/container
  checkpoint, never treated as the conversation checkpoint or portable state;
- `domainCursorRef`: an ordered boundary in the domain action/compensation
  ledger.

An Avermate branch links whichever of those references exist at its boundary.
Do not introduce a generic `checkpointRef`, `snapshotId` or `cursor` column that
could silently cross these histories.

## Why the decision changed

`docs/ai-architecture.md` says no chat tables or streaming transport should ship
until a revisit trigger occurs. Those triggers now exist: OCR, transcription,
TTS and document generation already use paid/provider-backed inference, and the
product thesis explicitly requires an in-app learning assistant.

Plan 025 preserves the historical Fichr POC findings as the sanitized and
portable `docs/references/fichr-chat-poc.md`, with source commit `b8c5714` and no
conversation data, credentials, absolute developer path or copied source. Use
only that committed note as evidence. It records the desired search,
model-selection, branch, streaming-tool and copy/export interactions, together
with the persistence/runtime coupling, post-execution approval and unsafe shell
boundary that must not be ported. If that note is absent or failed plan 025's
release guard, this plan stops rather than reaching into a private local repo.

## Required source changes

Expected implementation areas:

- `docs/ai-architecture.md` — supersede the old decision and link the v2 ADR;
- `docs/ai-architecture-v2.md` — complete decision and threat model;
- `docs/satellite-protocol.md` — mark storage-only v1 as superseded by plan 032,
  without inventing plan 032's final wire contract here;
- `packages/agent-contracts/` — versioned Zod/TypeScript contracts with no
  provider SDK dependency;
- `apps/server/src/agent/` — runtime and gateway interfaces plus spike adapters;
- `apps/server/src/routes/agent-events.ts` — spike-only authenticated resumable
  stream;
- `apps/web/src/components/assistant-spike/` — development-only proof surface;
- dependency manifests and lockfile with exact pins for pre-1.0 packages.

If a separate package is not justified after the spike, the contracts may live
under `packages/core/src/agent/`, but they must remain usable by Web, server and
the future node without importing server code.

## Protocol contract

### Event envelope

The selected placement's `ConversationStore` is the sole canonical store for
message DAGs, run state and event payloads. It must durably append each event
before that placement publishes it. Core-placed conversations use the Core
implementation; node-placed conversations use the paired node implementation.
The minimum envelope is:

```ts
type AvermateAgentEventV1 = {
  protocolVersion: 1;
  eventId: string;
  sequence: number;
  threadId: string;
  branchId: string;
  runId: string;
  emittedAt: string;
  type: string;
  payload: unknown;
  terminal: boolean;
};
```

Rules:

- `sequence` is strictly increasing within one run and uniquely constrained;
- `eventId` is globally opaque and replay-safe;
- the authoritative `ConversationStore` atomically appends an event before its
  placement makes the event visible on SSE or a relay;
- reconnect accepts `Last-Event-ID` and/or an explicit cursor;
- a run has exactly one terminal event (`finished`, `failed` or `cancelled`);
- duplicate delivery is legal, duplicate side effects are not;
- clients ignore unknown additive payload fields and fail closed on an unknown
  major protocol version;
- persisted payloads are already redacted and safe for the owning user to read.

Define the placement-neutral boundary now:

```ts
interface ConversationStore {
  appendEvent(input: AppendConversationEvent): Promise<StoredConversationEvent>;
  replayEvents(
    input: ReplayConversationEvents,
  ): AsyncIterable<StoredConversationEvent>;
  getRun(input: GetConversationRun): Promise<ConversationRunRecord | null>;
}
```

For a node-placed conversation, Avermate Core is a routing relay, not a second
canonical conversation store. The first protocol may expose event plaintext
transiently to that relay; it must state this honestly. Core persists only
placement/routing identifiers, run/sequence cursors, acknowledgements and
redacted operational metadata, never node-owned message or event payloads.
Reconnect asks the node's `ConversationStore` to replay; if the node is offline,
history is unavailable rather than reconstructed from incomplete Core metadata.
A later explicitly versioned end-to-end encrypted relay may retain ciphertext,
but no v1 test or product copy may claim Core cannot observe plaintext unless
that cryptographic protocol actually ships.

Map stable AG-UI lifecycle, text, tool, state and activity events into this
envelope. Namespaced Avermate events cover:

- `avermate.context.snapshot`;
- `avermate.usage.delta` and `avermate.cost.snapshot`;
- `avermate.approval.requested/resolved`;
- `avermate.citation.added`;
- `avermate.artifact.proposed/adopted`;
- `avermate.workspace.snapshot`;
- `avermate.todo.snapshot`;
- `avermate.capabilities.snapshot`.

Do not adopt AG-UI draft branch or interrupt extensions as the persistent schema.
Translate them at the adapter edge until stable.

### Transport

The authenticated SSE route must:

- enforce ownership before opening;
- cap concurrent streams per user and per run;
- send heartbeat comments through proxies;
- set `X-Accel-Buffering: no` and no-store caching;
- resume by cursor without replaying an unbounded history;
- close after the terminal event;
- fall back to cursor polling in clients without EventSource;
- expose neither provider keys nor raw model responses.

Reuse lessons from `apps/server/src/routes/transcription-events.ts`; do not copy
its one-second database polling loop as the final agent publisher. Agent events
are appended by the running process/worker and can wake subscribers directly,
with database replay as recovery.

### Runtime interface

Define a provider-independent boundary such as:

```ts
interface AgentRuntime {
  start(input: AgentRunInput): Promise<AgentRunHandle>;
  resume(input: AgentResumeInput): Promise<AgentRunHandle>;
  cancel(input: AgentCancelInput): Promise<void>;
  fork(input: AgentForkInput): Promise<ConversationCheckpointRef>;
  inspect(input: AgentInspectInput): Promise<AgentRuntimeState>;
}
```

The interface owns neither domain authorization nor model credentials. It
receives a scoped `ToolBroker`, `ModelGateway`, context manifest and optional
sandbox handle.

### Model gateway

Define a first-party interface with explicit provider capabilities:

```ts
interface ModelGateway {
  listModels(context: ModelAccessContext): Promise<ModelDescriptor[]>;
  stream(request: ModelRequest): AsyncIterable<ModelGatewayEvent>;
  embed(request: EmbedRequest): Promise<EmbedResult>;
  transcribe(request: TranscriptionRequest): Promise<TranscriptionResult>;
  estimate(request: ModelRequest): Promise<UsageEstimate>;
}
```

Initial adapters:

1. `AiSdkDirectGateway` for per-user BYOK and instance keys;
2. `OpenAICompatibleGateway` for Ollama, vLLM, OpenRouter, user gateways and
   future nodes;
3. `LiteLLMProxyGateway`, optional, for the managed service's virtual keys,
   fallbacks, rate limits and spend budgets.

Use explicit AI SDK provider instances. Do not make model-name strings silently
route through Vercel AI Gateway. Normalize usage as separate input, output,
reasoning, cached-read and cached-write counts where the provider supplies them;
preserve `unknown` rather than inventing zero.

Endpoint placement is a security boundary, not a free-form URL setting:

- hosted Avermate Core accepts only administrator-curated public HTTPS origins;
  it rejects URL credentials, non-HTTPS schemes, loopback, private, link-local,
  multicast, carrier-grade NAT, IPv4-mapped IPv6 and cloud metadata targets;
- resolve every hostname immediately before connection, validate every returned
  address, pin the validated address for that request, and repeat validation for
  every redirect; a redirect to a different normalized origin is rejected by
  default;
- bind each API secret to the normalized `(scheme, hostname, port)` origin and
  never forward it across an origin-changing redirect;
- user-configured LAN endpoints such as Ollama/vLLM over HTTP are allowed only
  on a paired Avermate Node or in a full-self-host deployment where an instance
  administrator explicitly enables that origin; browser clients never call
  those endpoints directly;
- enforce connect/read/total deadlines and response byte limits before parsing.

Tests must cover decimal/hex/octal IP spellings where the URL parser accepts
them, IPv6 and IPv4-mapped IPv6, DNS rebinding between validation and connect,
redirects to `localhost`, link-local/cloud metadata addresses, credentialed
URLs, a secret-changing origin redirect, and the allowed node-local case.

## Security and trust model

### Trust labels

Every context block is typed:

```ts
type ContextTrust =
  | "system-policy"
  | "user-instruction"
  | "application-data"
  | "retrieved-untrusted"
  | "tool-result";
```

Course documents, web pages, PDFs, chat attachments, repository files and prior
conversation excerpts are data, even when they contain imperative text. They
cannot change scopes, approval mode, model routing, tool risk or system policy.
The tool broker makes final authorization decisions deterministically.

Add adversarial tests in French and English for source text that asks the model
to reveal keys, disable confirmations, call deletion tools or fetch private
network addresses.

### Reasoning display

Do not promise or persist private raw chain-of-thought. Cross-provider support is
neither reliable nor an appropriate product contract. Display instead:

- an agent-authored plan and todo list;
- concise status updates;
- provider-authorized reasoning summaries when available;
- tool calls, parameters after redaction and results;
- sources/citations;
- context and usage accounting.

Encrypted provider reasoning items remain opaque continuation state and are not
rendered as hidden thoughts.

### Telemetry

- External tracing is opt-in and disabled by default for self-host/private
  profiles.
- OpenAI Agents SDK tracing, LangSmith and any comparable vendor telemetry must
  not become transitive defaults.
- Logs reference user/run/resource IDs, not prompts, files, keys or full model
  responses.
- Add a redaction test around every event serialization boundary.

## Time-boxed proof work

### Spike A — resumable shell projection

Build a dev-only page using a pinned assistant-ui ExternalStoreRuntime adapter.
The server emits a deterministic scripted run:

1. text begins;
2. a status activity starts;
3. a read-only tool call starts and completes;
4. a citation and usage snapshot arrive;
5. text completes and the run finishes.

Interrupt the network after event N, reconnect with the cursor, and prove the UI
contains each event exactly once. Refresh the page and reconstruct from server
state. The UI adapter must support branch navigation without owning the branch
data.

Acceptance:

- no lost or duplicated visible content after reconnect;
- terminal state is stable after refresh;
- unknown namespaced event is ignored safely;
- polling fallback reaches the same projection;
- the existing Avermate Markdown renderer can render the final content.
- a mock Core-placed store and mock node-placed store both prove append-before-
  publish and cursor replay, while Core's node relay fixture contains no durable
  event/message payload;
- node-offline replay returns an explicit placement-unavailable state and never
  fabricates partial history from relay metadata.

### Spike B — runtime checkpoint, fork and approval

Implement the same tiny tool loop with LangGraph JS Core:

1. user asks a question;
2. model chooses one read tool;
3. runtime emits a checkpoint;
4. a synthetic medium-risk action produces an interrupt;
5. approval resumes the same run;
6. forking at the checkpoint with edited input creates a distinct branch.

Persist `conversationCheckpointRef` data in a store Avermate controls. SQLite is
acceptable for the local spike; production storage selection belongs to the
implementation plan. Record the graph schema version with every conversation
checkpoint. If the provider also yields a runtime-native checkpoint, store it
separately as `sandboxRuntimeCheckpointRef`; never pass it where the conversation
contract expects `conversationCheckpointRef`.

Time-box a Mastra implementation of exactly this scenario. LangGraph remains the
default unless Mastra demonstrates all of:

- arbitrary checkpoint fork rather than restart-from-input only;
- durable resume after process death;
- explicit interrupt/approval state;
- portable, self-hostable storage without enterprise-only dependencies;
- event mapping without leaking its internal schema into the Web contract.

Document results and delete neither spike until the ADR is reviewed. Do not run
both harnesses in production.

### Spike C — model gateway

Run one deterministic mocked stream through direct AI SDK and through an
OpenAI-compatible endpoint. Assert identical normalized events for:

- content deltas;
- tool call arguments arriving in fragments;
- finish reason;
- usage with cached-token fields present and absent;
- provider error and cancellation;
- provider-authorized reasoning summary versus opaque reasoning state.

No live paid key is required in CI. A separately opt-in live smoke may use BYOK
without logging or snapshotting it.

## ADR contents

The final v2 ADR must explicitly answer:

1. which data remains authoritative on Avermate core;
2. which data may be placed on a user node;
3. how MCP and embedded chat share tools and permissions;
4. why assistant-ui is a projection only;
5. why LangGraph is behind `AgentRuntime`;
6. why AG-UI is adapted rather than copied as the database schema;
7. why LiteLLM is optional;
8. how the four histories relate;
9. what “undo” can and cannot mean;
10. how prompt-injected source content is contained;
11. why raw chain-of-thought is not a feature contract;
12. which revisit signal would justify WebSocket/realtime voice.
13. how `ConversationStore` authority follows placement and what Core can
    transiently observe for node conversations;
14. how model endpoint validation prevents SSRF, DNS rebinding and credential
    forwarding.

## Verification

Run targeted contract tests plus repository gates:

```powershell
bun run --cwd packages/agent-contracts test
bun run --cwd apps/server test src/agent
bun run --cwd apps/web test src/components/assistant-spike
bun run format:check
bun run lint
bun run check-types
bun run test
bun run build
```

Dependency review must record exact versions, licences, bundle impact and any
postinstall/native behavior. Pin pre-1.0 assistant-ui and AG-UI packages exactly;
upgrade only through an explicit contract test.

## Done criteria

- The v2 ADR is accepted and the old ADR clearly points to it.
- The stack table above is either ratified or changed with recorded spike
  evidence.
- Versioned shared contracts compile without provider/runtime imports.
- SSE reconnect, refresh reconstruction and polling fallback pass.
- Core and node mock stores satisfy the same append-before-publish/replay
  contract without duplicate canonical persistence.
- LangGraph checkpoint, resume, approval and fork pass after process restart.
- Model gateway normalization passes with at least two adapters.
- Hosted endpoint SSRF/redirect/DNS-rebinding tests and node-local allow tests
  pass.
- Prompt-injection and event-redaction tests pass.
- No user-facing production chat route is enabled yet.

## STOP conditions

- Plan 025 has no clean baseline SHA.
- The runtime requires a proprietary control plane or mandatory external
  telemetry for normal self-host operation.
- Reconnect can produce duplicate tool execution.
- Core durably stores a node-owned message/event payload or claims end-to-end
  confidentiality without a shipped encrypted relay protocol.
- The selected UI runtime requires its own canonical message store.
- An event payload can contain provider credentials, raw secret headers or
  unredacted private source content.
- The implementation tries to expose raw private chain-of-thought.

## Rollback and maintenance

All spike routes remain behind a development-only gate and can be removed by an
ordinary revert. Protocol changes are additive within v1; incompatible changes
create v2 and retain replay readers for persisted v1 runs. Runtime adapters must
declare compatible checkpoint schema versions before an upgrade resumes an
in-flight run.
