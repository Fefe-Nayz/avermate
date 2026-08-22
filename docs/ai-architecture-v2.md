# AI architecture v2

**Status:** accepted architecture, amended by the plan 035 production audit.

**Decision date:** 2026-08-22.

This ADR supersedes the direction in
[`ai-architecture.md`](./ai-architecture.md). It does not remove MCP. MCP and
the future embedded assistant are two clients of the same Avermate policy and
domain boundaries.

## Decision summary

| Concern         | Decision                                                                                                                                                     |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Conversation UI | Use assistant-ui through `ExternalStoreRuntime` as a projection of Avermate state.                                                                           |
| Durable stream  | Persist an Avermate v1 event envelope, then adapt stable lifecycle, text, tool, state and activity semantics to AG-UI.                                       |
| Harness         | Put one explicit Avermate graph executor behind `AgentRuntime`; keep LangGraph as a replaceable conformance spike, not a second production checkpoint owner. |
| Model access    | Put explicit AI SDK and OpenAI-compatible adapters behind `ModelGateway`; ship LiteLLM as an implemented, explicitly activated deployment option.            |
| Tools           | Give embedded chat, MCP and background jobs the same typed registry and deterministic policy broker.                                                         |
| Transport       | Use authenticated resumable SSE plus cursor polling. Revisit WebSocket only for measured bidirectional realtime needs.                                       |
| Placement       | Keep academic truth on the Core role. Place conversation, file and inference data on Core or a paired user node according to an explicit placement record.   |

The interfaces in `packages/agent-contracts` are the stable boundary. They do
not import assistant-ui, AG-UI, LangGraph or a model provider SDK.

## The fourteen decisions

### 1. What remains authoritative on Avermate Core

The Core role remains authoritative for identity, accounts, ownership,
academic years, periods, subjects, grades and averages, group/class policy,
OAuth grants, provider synchronization policy and domain authorization. It is
also authoritative for the future ordered domain action and compensation
ledger. In a full self-host deployment, the same Core role runs on the
operator's infrastructure; its responsibility does not disappear.

Core owns file and conversation placement records even when it does not own
their payload. A placement record identifies the owner, selected node, thread,
branch, run and last acknowledged cursor. A user node cannot mutate academic
truth by writing its own tables: it must call a typed tool, and Core repeats
ownership, scope, revision and approval checks.

### 2. What may be placed on a user node

An explicitly paired node may own file bytes, derived transcripts, search
indexes and embeddings, model credentials and inference calls, sandbox
workspaces, generated artifacts, conversation message DAGs, run event payloads
and harness checkpoints. Placement is per resource or conversation, not a
global inference from whether a user has ever paired a node.

For a Core-placed conversation, Core's `ConversationStore` is canonical. For a
node-placed conversation, the paired node's implementation of the same
interface is canonical. Core retains only routing identifiers, cursors,
acknowledgements and redacted operational metadata for the latter. Plan 032
owns the node wire protocol; this ADR does not turn the old storage-only
satellite sketch into that protocol.

### 3. How MCP and embedded chat share tools and permissions

There is one typed tool registry and one policy broker. MCP authenticates an
OAuth principal and scopes; embedded chat authenticates the Avermate session
and a captured policy snapshot; background work authenticates a service
principal delegated by an owned job. All three produce the same normalized
invocation containing principal, scopes, resource ownership, risk, arguments,
revision/idempotency fences and approval state. The broker makes the final
decision and invokes the same domain service or oRPC procedure.

MCP formatting, model formatting, UI widgets and audit summaries are different
projections of one bounded result. No adapter gets a private mutation API. The
current MCP catalogue already delegates canonical validation and ownership to
the application router; plan 027 consolidates it with embedded chat and jobs
rather than copying its registrations.

### 4. Why assistant-ui is only a projection

assistant-ui provides accessible conversation primitives and an external-store
runtime, but it is not Avermate's message database, event protocol or branch
authority. The spike feeds it messages projected from persisted Avermate
events. Browser storage contains only routing identifiers. Refresh rebuilds
the projection from cursor zero; reconnect resumes from the durable cursor.

Edits, retries and branch navigation therefore become server requests. A
client may optimistically display a candidate path, but the selected branch
head and message DAG remain authoritative at the selected conversation
placement. Replacing the UI library must not require a data migration.

### 5. Why the harness is behind `AgentRuntime`

Plan 026 proved that LangGraph can supply an interruptible graph and checkpoint
primitives without becoming an Avermate product contract. The plan 035 audit
then found that adopting its saver in production would duplicate the already
authoritative conversation checkpoint, dispatch-claim and action histories.
Production therefore uses the explicit `AssistantGraphExecutor` behind
`AgentRuntime`; every transition is fenced and its portable checkpoint is
written through `CoreConversationCheckpointStore`. The LangGraph SQLite graph
remains a restart/fork conformance spike and a replaceability test, not a
production call path. LangGraph Agent Server, LangSmith and any proprietary
control plane are not required.

`AgentRuntime.start`, `resume`, `cancel`, `fork` and `inspect` continue to use
branded Avermate references and provider-independent inputs. A future engine
may replace the executor only if it passes the same event, checkpoint,
dispatch, approval and crash-recovery contracts without owning canonical domain
tables or creating a parallel user-visible history.

This boundary lets later plans replace the graph engine or run it on a node
without changing Web, SSE, domain tables or persisted event envelopes.
Framework checkpoint blobs are sensitive implementation data and are never
accepted from an untrusted client.

### 6. Why AG-UI is adapted rather than copied into storage

AG-UI is useful for interoperable run, text, tool, state and activity
semantics. Its draft or framework-specific events are not stable enough to be
the database schema. Avermate therefore persists its own versioned envelope
and maps stable events at the adapter edge. Namespaced `avermate.*` events
carry context, usage, cost, approvals, citations, artifacts, workspace
snapshots, todo state and capability snapshots.

The adapter validates the projected AG-UI event against the redacted canonical
envelope before accepting a reverse mapping. Draft branch/interrupt events and
all raw reasoning event variants are rejected rather than persisted.

### 7. Why LiteLLM is optional

Direct provider instances support operator keys and per-user BYOK without an
extra service. The OpenAI-compatible adapter covers a paired Ollama/vLLM node,
OpenRouter and user-controlled gateways. Plan 038 also implements the
`LiteLLMProxyGateway`, Node `LiteLLMNodeGateway`, virtual-key issuer, explicit
fallback chains, per-owner budget/rate limits, pinned Compose cell and
configurator controls. Activation remains optional: `dev-zero`, direct and
BYOK profiles do not depend on the Python proxy.

When selected, LiteLLM is another `ModelGateway` adapter. It is not a second
authorization boundary and may not silently route arbitrary model-name
strings. Avermate's owner policy, explicit provider/model descriptors, frozen
revisions and accounting ceilings remain authoritative even when LiteLLM also
enforces a narrower virtual-key budget.

### 8. How the four histories relate

| History                  | Authority and purpose                                                                         | Reference at a branch boundary                                                  | What it does not restore                              |
| ------------------------ | --------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- | ----------------------------------------------------- |
| Conversation message DAG | User-visible messages, edits, retries and selected branch heads at the conversation placement | Thread, branch and parent-message identity; these are not checkpoint references | Files, harness state and domain mutations             |
| Harness checkpoints      | Resumable graph state, interrupts and model/tool continuation in the selected runtime         | `conversationCheckpointRef`                                                     | A filesystem or a grade                               |
| Workspace snapshots      | Immutable committed files used by artifact/sandbox work                                       | `workspaceSnapshotRef`                                                          | Conversation state or domain tables                   |
| Domain action ledger     | Ordered attempted/completed mutations and compensations                                       | `domainCursorRef`                                                               | Provider or filesystem state that has no compensation |

`sandboxRuntimeCheckpointRef` is an optional provider-native VM/container
acceleration reference. It is distinct from both the portable conversation
checkpoint and the committed workspace snapshot. A branch boundary may link
the references that exist, but no generic `checkpointRef`, `snapshotId` or
`cursor` may stand in for all of them.

Plan 031 implements this distinction at the provider boundary. Workspace
snapshots use a portable digest-addressed reference, provider-native runtime
checkpoints have a separate non-portable shape, and image templates remain
pinned profile inputs. Core placement uses the libSQL-backed
`CoreSqlSnapshotLedger` and its durable outbox; portable bytes live in the
configured object store. Paired-Node runtime checkpoint metadata uses the
owner/node-bound `CoreNodeRuntimeCheckpointRepository` and attaches only to an
exact committed logical snapshot. Capture, adoption, expiry and deletion never
write `assistant_runs.conversationCheckpointRef`. The in-memory ledger remains
a contract-test implementation only. See [`sandbox-runtime.md`](sandbox-runtime.md)
for provider evidence and activation gates.

### 9. What undo can and cannot mean

Undo is capability-specific:

- editing or retrying creates another message branch and preserves the old
  branch;
- forking a harness checkpoint creates another runtime branch but does not
  rewind files or grades;
- restoring a workspace snapshot affects committed workspace content only;
- a domain action can be undone only when its ledger entry defines and
  successfully executes a compensation against the current revision;
- irreversible provider actions are labelled irreversible before approval.

“Return everything to this message” is therefore a coordinated operation over
several references, with a preview and explicit confirmation. It is never a
promise that a LangGraph checkpoint can resurrect deleted academic data or an
external provider object.

### 10. How prompt-injected source content is contained

Every context block is labelled `system-policy`, `user-instruction`,
`application-data`, `retrieved-untrusted` or `tool-result`. PDFs, course
documents, web pages, attachments, repository files and quoted conversation
excerpts remain data even when they contain imperative text. A strict context
manifest prevents a retrieved block from smuggling policy fields.

The model may propose a tool call, but it cannot alter scopes, approval mode,
model origin, risk class, ownership or policy version. The deterministic tool
broker reconstructs these from trusted server state. Adversarial French and
English fixtures cover instructions to reveal keys, disable confirmation,
delete grades and access metadata/private-network targets.

### 11. Why raw chain-of-thought is not a feature contract

Private reasoning is inconsistent across providers, may contain sensitive
source content and is not needed to audit a deterministic side effect. Avermate
does not persist or display raw chain-of-thought. The AG-UI adapter rejects raw
reasoning fields and reasoning event types. Encrypted provider reasoning stays
an opaque continuation reference.

The product displays an agent-authored plan/todo list, concise status updates,
redacted tool calls and results, sources, context/usage accounting and a
provider-authorized reasoning summary when one exists. This is useful
transparency without pretending private model internals are portable.

### 12. When WebSocket or realtime voice is justified

SSE is sufficient for server-to-client text, tool, progress and approval
events; normal authenticated HTTP carries commands and uploaded audio. Revisit
the transport only after a voice prototype demonstrates simultaneous
bidirectional audio, barge-in/cancellation and latency targets that HTTP upload
plus SSE cannot meet. The decision requires measured end-to-end latency and
reconnect behavior, not the mere availability of a WebSocket API.

### 13. How conversation authority follows placement

The selected placement durably appends an event before publishing it. Within a
run, sequence numbers increase by exactly one, event IDs are replay-safe and
only one final `finished`, `failed` or `cancelled` event is allowed. Duplicate
delivery is allowed; duplicate execution is not.

For node placement, Core may relay the first protocol's event plaintext in
memory. It does **not** durably persist node-owned message or event payloads,
but it can observe plaintext while routing, applying policy or authenticating
the stream. Reconnect asks the node's canonical store to replay. If the node is
offline, Core returns placement unavailable and never invents history from its
cursor metadata. No product copy may claim end-to-end confidentiality until a
separately versioned encrypted relay actually ships.

Node-owned corpus bodies use a narrower durable recovery mechanism without
changing that relay claim. Core stores authorization metadata, locators and
content hashes plus an AES-256-GCM envelope bound to the owner, node, source,
version key, ordinal and chunk hash. The envelope is migration/recovery state,
never an offline read fallback. Search candidates are reauthorized against Core
metadata; readable bodies are fetched with a signed, owner-bound exact-chunk
operation and checked against the Core SHA-256 before a snippet, citation,
embedding input or assistant context is produced. Placement migration rewrites
the envelope transactionally only after exact destination readback.

### 14. How model endpoint validation prevents network abuse

Hosted Core accepts only administrator-curated public HTTPS origins. It
rejects URL credentials, local hostnames, loopback, RFC 1918/ULA, link-local,
carrier-grade NAT, multicast, reserved/test ranges, metadata targets and
IPv4-mapped IPv6. URL parsing occurs before address classification so accepted
decimal, hexadecimal and octal IPv4 spellings normalize into the same checks.

Every request resolves all DNS answers immediately before connection, rejects
the complete answer set if any address is unsafe and gives the HTTP/TLS socket
a lookup function pinned to that validated set. Redirects are handled
manually, revalidated and limited to the original normalized origin. Sensitive
headers cannot be supplied as arbitrary request headers; a credential is bound
to an exact `(scheme, hostname, port)` origin and is never forwarded elsewhere.
Connect, per-read and total deadlines plus declared and streamed byte limits
bound the request.

An explicitly configured node or full-self-host instance may allow HTTP and
private/loopback destinations because the operator owns that network boundary.
It still requires an allowed-origin entry and still rejects link-local,
metadata, CGN, multicast, reserved and mapped-address bypasses. Browser code
never calls these model endpoints directly.

## Durable event and transport contract

The canonical event is `AvermateAgentEventV1`:

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

Payloads are redacted before persistence. Unknown additive payload fields and
unknown namespaced events can be ignored; an unknown major protocol version
fails closed. The canonical `ConversationStore` atomically checks the expected
previous sequence, persists the redacted event and run status, commits, and
only then wakes subscribers.

The development SSE route authenticates a verified, non-suspended owner before
opening. It enforces per-user and per-run stream caps, bounded replay, heartbeat
comments, `Cache-Control: no-store, no-transform`, `X-Accel-Buffering: no`,
cursor/`Last-Event-ID` resume and close-after-terminal. Clients without
`EventSource` use bounded cursor polling and produce the same projection.

## Runtime proof and Mastra comparison

### Retained LangGraph proof

The retained proof executes a read tool, persists a graph checkpoint, suspends
before a synthetic medium-risk action, resumes from an explicit boolean
decision after reopening the SQLite file, and forks the exact checkpoint into
a distinct branch with edited input. The checkpointer stores checkpoint and
pending-write blobs together with `graphSchemaVersion`; opaque Avermate
references are owner-bound and never expose LangGraph IDs to the client.

### Time-boxed Mastra evaluation

Mastra was evaluated against that exact six-step scenario, not against a
generic feature list. The time box stopped at the first mandatory criterion
that could not be proved through a supported API:

| Required property                                 | Evidence as of 2026-08-22                                                                                                                                                                                                                                                              | Result                        |
| ------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------- |
| Read tool followed by explicit approval interrupt | Workflows expose tools and suspend/resume with a resume payload.                                                                                                                                                                                                                       | Meets                         |
| Durable resume after process death                | Mastra documents loading a suspended run by ID from a shared database in a fresh process.                                                                                                                                                                                              | Meets                         |
| Portable self-hosted storage                      | Workflow snapshots support local LibSQL and other configured storage backends without requiring Mastra Cloud.                                                                                                                                                                          | Meets                         |
| Arbitrary checkpoint fork with edited input       | Workflow snapshots are documented primarily by run ID at suspension. Thread cloning copies conversation messages; it is not documented as cloning one exact workflow checkpoint into an independently mutable run. “Rewind/replay” material did not establish that stronger invariant. | Not proved                    |
| Stable Avermate event mapping                     | Mastra exposes workflow/harness events, but they would still require an adapter and must not become the Web or database schema.                                                                                                                                                        | Possible, no advantage proved |

Sources used for the comparison are Mastra's
[workflow snapshot reference](https://mastra.ai/en/reference/workflows/snapshots),
[durable restart walkthrough](https://mastra.ai/blog/what-are-durable-ai-agents),
[thread-cloning changelog](https://mastra.ai/blog/changelog-2026-01-20) and
[harness announcement](https://mastra.ai/blog/announcing-agent-harness).

No Mastra package or second production runtime was retained. Installing it
would not prove the missing checkpoint-fork invariant and would create two
checkpoint schemas, two event translations and two upgrade surfaces. Revisit
only when a supported Mastra API can be tested to clone an explicitly selected
workflow checkpoint, change the input, preserve the source and resume both
branches after process restart.

## Model gateway and telemetry

`AiSdkDirectGateway` and `OpenAICompatibleGateway` normalize content deltas,
fragmented tool arguments, finish reasons, errors, cancellation, usage and
authorized reasoning summaries. Unknown or unreported input, output,
reasoning, cached-read and cached-write token counts remain the string
`"unknown"`; they are never invented as zero. Tests use deterministic mocks and
no paid key.

The direct adapter passes explicit provider objects to AI SDK and disables AI
SDK telemetry for the stream. The lockfile contains AI SDK's gateway package
and LangGraph's `langsmith` transitive dependency, but the implementation does
not configure either service. Package presence is not permission to send data.
External tracing is opt-in, disabled by default for private/self-host profiles,
and must redact prompts, files, provider responses and keys before export.
Logs contain bounded identifiers and error codes rather than private provider
details.

See [`dependencies/agent-stack-026.md`](./dependencies/agent-stack-026.md) for
the exact dependency and bundle review.

## Threat model

| Threat                                              | Control in this architecture                                                                                                              | Residual risk or later owner                                       |
| --------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| Cross-user replay or run enumeration                | Authenticate first; owner-bound run lookup and checkpoint references; opaque IDs                                                          | Production conversation schema and authorization tests in plan 029 |
| Event loss, reordering or duplicate tool execution  | Transactional append-before-publish, exact sequence, terminal invariant, cursor replay, idempotency/revision fences                       | Distributed publisher/lease design in later runtime plans          |
| A node relay becomes a hidden second database       | Core stores only routing/cursor metadata for node placement; offline means explicit unavailability                                        | Plan 032 protocol and persistence tests                            |
| Node corpus placement leaves a readable Core mirror | Core retains only authorization/locator/hash metadata plus authenticated recovery envelopes; FTS is purged and normal reads require the Node | Plan 038 envelope, migration and offline tests                     |
| False end-to-end privacy claim                      | v1 documents Core's transient plaintext visibility                                                                                        | A future versioned encrypted relay, if built                       |
| Prompt injection elevates privileges                | Typed trust labels; immutable policy snapshot; deterministic broker repeats authorization                                                 | Tool registry/policy implementation in plan 027                    |
| Tool approval races or replay                       | Approval must bind owner, tool, normalized arguments, revision and expiry before execution                                                | Durable approval/action ledger in plan 030                         |
| SSRF, DNS rebinding or credential exfiltration      | Curated origins, complete DNS validation, pinned lookup, same-origin redirects, origin-bound secret, network/address blocks and deadlines | Proxy-specific integration tests whenever a new transport is added |
| Provider response leaks secrets into history        | Payload redaction before persistence and adapter serialization; raw response never exposed                                                | Typed per-event payload schemas should expand before production    |
| Raw reasoning or private source content is rendered | Reject raw reasoning events/fields; only authorized summaries and opaque continuation refs                                                | Provider-specific adapter audits                                   |
| Checkpoint deserialization crosses a trust boundary | Checkpoints are server-created, owner-bound and graph-versioned; no client import                                                         | Encryption-at-rest and retention policy in production storage plan |
| External telemetry copies prompts/files             | No tracing configured by default; explicit opt-in and redaction required                                                                  | Deployment policy and network egress tests                         |
| Stream/resource exhaustion                          | Per-user/per-run caps, replay limit, heartbeat, response byte and time limits                                                             | Distributed quota/rate enforcement before production               |
| Arbitrary code escapes the academic service         | No generic shell tool in Core; execution belongs behind a bounded sandbox                                                                 | Plan 031                                                           |
| UI package becomes canonical state                  | External store is projection-only and branch changes return to Avermate                                                                   | Production branch/CAS tests in plan 029                            |

## Current implementation status

Plan 026 remains the replaceability proof, but plans 027–039 now provide the
production repository paths:

- `packages/agent-contracts` owns the versioned event, context, placement,
  runtime, reference, model, retrieval, Node and specialist-worker contracts;
- `apps/server/src/agent` and `apps/server/src/assistant` contain the production
  graph executor, fenced run control, libSQL conversation/checkpoint stores,
  model policy and resumable event projection;
- the authenticated Web assistant uses those services for branches,
  edit/retry, approvals/questions, attachments, dictation, export and project
  save; development fixtures remain isolated under `/dev`;
- direct/BYOK, OpenRouter/OpenAI-compatible, paired-Node and LiteLLM model
  placements are implemented behind explicit readiness and revision checks;
- the authenticated Core↔Node relay, SQL operation journal, provider transports,
  two-phase object adoption, remote deletion and provider-native runtime
  checkpoint metadata are wired through canonical services;
- the sandbox, Gemini multimodal embedding, hybrid RRF/reranking, bounded
  OpenCode/OpenHands and managed-beta paths remain explicitly activated and
  fail closed when their provider/image evidence is absent.

Repository implementation is not live release evidence. Real provider,
healthy-host, air-gap, restore/load and managed-isolation attestations remain
separate fail-closed operator gates. No raw chain of thought, browser-held
provider secret or implicit paid fallback is enabled by these repository paths.
