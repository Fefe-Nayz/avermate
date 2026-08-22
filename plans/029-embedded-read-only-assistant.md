# Plan 029: Embedded assistant v1 — durable, branchable and read-only

> **Executor instructions**: Read plans 026–028 first. Keep the production grant
> strictly read-only, prove persistence/reconnect before adding provider traffic,
> and update the 029 row in `plans/README.md` only after every browser, privacy
> and DAG gate passes. Do not add React Native work, push or open a PR unless
> requested.
>
> **Drift check (run first)**: run `git diff --stat <plan-025-baseline>..HEAD --
packages/agent-contracts apps/server/src/agent apps/server/src/db/schema
apps/server/src/routes apps/server/src/routers apps/web/src/app
apps/web/src/components apps/web/src/lib`. Reconcile changes to the event,
> search, renderer, AppShell or service-key contracts; stop if a mutation grant
> or competing canonical chat store already exists.

> [!IMPORTANT]
> Ship the first complete user loop without agent-authored domain mutation. The
> assistant can search, read, cite, plan, ask questions and explain; it cannot
> create/edit/delete grades, tasks, materials or documents yet. User-initiated
> deterministic actions such as renaming a thread or exporting it remain legal.
> This boundary makes branch, streaming, privacy and retrieval bugs observable
> before the action ledger in plan 030 carries real consequences.

## Status

- **Status**: TODO
- **Priority**: P0
- **Effort**: XL
- **Risk**: HIGH
- **Depends on**: 026, 027 and 028
- **Blocks**: 030; supplies conversation workloads for 031/032
- **Category**: Web product, agent runtime, persistence, streaming
- **Planned at**: 2026-08-22
- **Planning baseline**: plan 025 baseline SHA

## Scope

**In scope**: Web side panel/full-page shell, immutable conversation DAG,
durable runs/events/context/usage, read-only harness, model selection, dictation,
typed attachments, retrieval/citations, custom read-only MCP, branches,
JSON/Markdown export and project save.

**Out of scope**: agent-authored domain writes, implicit data restoration,
general sandbox/code execution, realtime voice calls, managed billing and React
Native. User-driven thread metadata/export/save commands remain allowed.

## User-visible outcome

A student can open an assistant side panel anywhere in Avermate and:

- create, search, rename, star, archive and delete chats;
- stream a response with status, plan, todo, read-tool activity and citations;
- select a permitted model/provider and see privacy/cost capability information;
- attach uploaded files or explicitly reference a year, subject, grade, task,
  material, transcript, project, document or artifact;
- dictate the prompt in current Chrome and other supported Web browsers;
- render the existing rich Markdown surface, including math, Mermaid, code,
  citations and registered Avermate widgets;
- edit or retry any prior message into a new branch without losing history;
- navigate branch alternatives;
- copy a response, export active/all branches as Markdown or JSON, and save a
  reviewed branch into a project/study document;
- resume a stream after refresh or network loss;
- use BYOK/local model access without an Avermate-managed inference plan.

The assistant can retrieve old messages or course passages with bounded search
tools. It cannot silently dump the entire account into a model context.

## Data model

### Canonical objects

Add versioned tables/modules equivalent to:

```ts
assistantThreads {
  id, userId, title, activeBranchId?, projectId?,
  placement: "core" | "node",
  placementRef?,
  starredAt?, archivedAt?, deletedAt?,
  createdAt, updatedAt
}

assistantMessages {
  id, threadId, parentMessageId?,
  role: "user" | "assistant" | "system" | "tool",
  authorship: "user" | "model" | "user-edited-model" | "application",
  status: "pending" | "streaming" | "complete" | "failed" | "cancelled",
  partsVersion, partsJson,
  createdByRunId?, replacesMessageId?,
  createdAt
}

assistantBranches {
  id, threadId, name?,
  forkedFromMessageId?, headMessageId?,
  createdAt, updatedAt
}

assistantRuns {
  id, threadId, branchId,
  inputMessageId, outputMessageId?, parentRunId?,
  runtimeId, runtimeVersion, graphSchemaVersion,
  modelKey, providerKey, modelResolvedId?,
  status, approvalMode, providerRequestKey?, providerDispatchState,
  contextManifestId?, conversationCheckpointRef?,
  workspaceSnapshotRef?, sandboxRuntimeCheckpointRef?, domainCursorRef?,
  startedAt?, completedAt?, errorCode?, safeError?
}

assistantRunEvents { runId, sequence, eventId, type, payloadJson, emittedAt }
assistantConversationCheckpoints {
  id, threadId, branchId, runId,
  inputMessageId, outputMessageId?,
  parentCheckpointId?, afterEventSequence,
  runtimeId, runtimeVersion, graphSchemaVersion,
  stateDigest, stateByteLength, stateBlobRef?, stagingBlobRef?,
  status: "staging" | "committed" | "failed",
  failureCode?, committedAt?,
  createdAt
}
assistantContextManifests { id, runId, version, budgetJson, itemsJson, digest }
assistantContextProofHandles {
  id, contextManifestId, runId, ordinal,
  contentVersionReferenceId, sourceVersionId, chunkId?,
  locatorSchemaVersion, locatorJson,
  evidenceDigest, quotedContentHash?, createdAt
}
assistantUsage { runId, provider/model/price snapshot, token counters, cost? }
assistantAttachments { messageId, kind, referenceId, snapshotVersion?, label? }
assistantCitations {
  id, messageId, runId, ordinal, proofHandleId,
  claimPartId?, createdAt
}
```

Use opaque string IDs and ownership indexes consistent with the repository.
Message rows are immutable after completion. The only mutable pointers are
thread/branch heads and run status under compare-and-swap rules.

`assistantContextProofHandles` is the immutable, run-scoped evidence allowlist
inside the versioned context manifest. Its `contentVersionReferenceId` targets
plan 028's durable `contentVersionReferences` row; `sourceVersionId` and optional
`chunkId` are foreign keys and must agree with that edge. `locatorJson` is the
canonical versioned locator only, not a bag containing titles, signed URLs or
renderer state. Enforce unique `(runId, id)`, `(contextManifestId, ordinal)` and
a composite foreign key proving that the manifest belongs to the same run.
Handles are random opaque IDs, cannot be reused across runs and never retarget
after creation.

`assistantCitations` is a claim-to-proof edge, not another independent source
description. Enforce a composite foreign key `(runId, proofHandleId)` to the
proof handle and verify that `messageId` is the output of that same run. A
citation therefore cannot name corpus content that was not in a committed
manifest revision actually exposed to that run. Display DTOs dereference the
proof through `CitationResolver`; they may copy labels for display but the proof
handle remains canonical. Message `partsJson` may contain only the citation
ID/ordinal used for rendering, never the sole copy of citation reachability.
Corpus GC consults proof-handle and citation edges before deleting a version.

The four checkpoint/cursor names are intentionally non-interchangeable:

- `conversationCheckpointRef` resumes graph/conversation state;
- `workspaceSnapshotRef` identifies a committed plan 031 filesystem snapshot;
- `sandboxRuntimeCheckpointRef` identifies a provider-specific suspended
  runtime, when supported;
- `domainCursorRef` identifies the plan 030 domain-action ledger position.

No column or DTO may use the ambiguous name `runtimeCheckpointRef`.

### DAG invariants

- A message's parent belongs to the same thread.
- A branch head resolves to one ancestor path ending at that head.
- Adding a normal message appends to the active branch head.
- Editing a message creates a replacement sibling under the original parent,
  a new branch pointer and a new run; the old node remains.
- Retrying an assistant message creates a new assistant sibling from the same
  parent input.
- Editing model text is allowed as a user-curated branch and visibly marked
  `user-edited-model`; it is never represented as original model output.
- Deleting a branch pointer does not purge shared ancestor messages.
- A run may adopt an output message only once.
- Enforce unique `(threadId, clientRequestId)` and a partial unique active-run
  guard for a branch while status is `reserved | running | waiting-for-user`;
  application locks alone are insufficient.
- Enforce unique `(runId, sequence)` and `(runId, eventId)`; event rows are
  append-only and sequence has no gaps at a committed checkpoint boundary.
- Finalization is one authoritative-store operation. It creates the immutable
  assistant output and validated parts, inserts normalized citation-to-proof
  edges, resolves `U -> O` versus an explicit sibling branch, binds the run to
  `O`, marks it terminal and appends its unique terminal event as the greatest
  and final run sequence in one transaction plus transactional outbox. No event
  can be appended after a terminal event, and no terminal publication occurs
  before that transaction commits.
- Thread hard purge is a separate confirmed retention operation; ordinary
  delete is recoverable for a documented period.

Do not persist a flattened `branchIndex` as the source of truth. Derive paths
from immutable parents and named head pointers.

### Conversation store abstraction

Define a `ConversationStore` interface from the first schema version:

- `CoreConversationStore` stores tables above in the Avermate database;
- `NodeConversationStore` is added by plan 032;
- the Web and assistant-ui adapter use only server DTOs/events;
- placement is chosen explicitly per thread and never changes silently;
- migration between placements is an export/import transaction with digest and
  count verification, not a pointer flip.

The selected placement store is authoritative for messages, runs, events,
context manifests, normalized citations and conversation checkpoints:

- a `core` thread is durably persisted by `CoreConversationStore` before the
  core SSE route emits its events;
- a `node` thread is durably persisted by `NodeConversationStore` before the
  node emits an event. The core relay may persist only routing, last-seen
  sequence and acknowledgement metadata; it is not a second canonical event
  log and must not persist message/event bodies;
- the initial node relay can observe plaintext transiently while forwarding it.
  The product must say that plainly. “Avermate cannot see chat content” is valid
  only after a separately specified end-to-end encrypted relay stores/routes
  ciphertext exclusively;
- replay for a node thread comes from the node. If that node is offline, the UI
  shows the conversation as temporarily unavailable rather than fabricating a
  core copy or silently changing placement.

The table sketch above is the logical schema and the physical core-placement
schema. For node placement, plan 032 may keep a separate core directory row with
only `userId`, opaque `threadId`, `placementRef`, lifecycle state and relay
cursor/ack fields. It must not mirror title, messages, citations, context or
events. Thread lists resolve node-owned display metadata from the node and show
an unavailable placeholder while it is offline.

V1 ships only the core placement, but the DTO and conformance contract above are
fixed now so plan 032 cannot create a second chat UI or contradictory storage
semantics. Until the plan 032 adapter passes the conversation/event/checkpoint
conformance suite, thread creation/import rejects `placement = "node"` with a
typed unavailable-capability response.

Ship that reusable conformance suite in 029. It covers ownership, transactional
head CAS/idempotency, one-active-run enforcement, append-only event ordering,
checkpoint linkage/digest validation, cursor replay, normalized citations,
export/import digest equality and retention-aware purge. Run it against the core
implementation here and against the node implementation in plan 032.

Make terminalization an explicit method on that interface rather than a series
of router/service writes:

```ts
interface ConversationStore {
  // Other reservation, append, replay and query methods omitted here.
  finalizeRun(input: {
    ownedRunRef: OwnedRunRef;
    expectedInputHeadId: string;
    outputMessageId: string;
    finalParts: VersionedAssistantPart[];
    citations: Array<{
      ordinal: number;
      proofHandleId: string;
      claimPartId?: string;
    }>;
    usage: FinalUsageSnapshot;
    terminal: "complete" | "failed" | "cancelled";
    safeError?: SafeRunError;
    siblingPolicy: "create-explicit-sibling-on-head-conflict";
  }): Promise<FinalizedRunProjection>;
}
```

The store allocates the terminal event sequence; callers cannot provide or
publish one. The method is idempotent by run/output ID and either returns the
already byte-identical final projection or rejects a divergent replay. Its core
implementation uses one database transaction and transactional outbox. The
node implementation must provide the same atomic guarantee in its authoritative
store before it passes plan 032 conformance.

### Production conversation checkpoint store

Define a separate append-only `ConversationCheckpointStore`:

```ts
interface ConversationCheckpointStore {
  append(input: AppendConversationCheckpoint): Promise<ConversationCheckpoint>;
  get(ref: OwnedConversationCheckpointRef): Promise<ConversationCheckpoint>;
  latestForRun(runId: string): Promise<ConversationCheckpoint | null>;
  listForBranch(
    input: OwnedBranchCheckpointQuery,
  ): Promise<ConversationCheckpoint[]>;
  markForGc(ref: OwnedConversationCheckpointRef): Promise<void>;
}
```

`CoreConversationCheckpointStore` uses the production database for checkpoint
metadata and the configured private object store only for bounded opaque state
blobs; tests may use an in-memory implementation but production cannot. Each
append is immutable, monotonically follows `parentCheckpointId`, and records the
exact input message, optional output message, run and last persisted event
sequence it represents. Validate the state digest on write/read and reject a
checkpoint whose message/run/sequence belongs to another thread or user.

Database metadata and object storage use an explicit commit protocol; neither a
blob upload nor a database row alone makes a checkpoint restorable:

1. In the authoritative placement database, reserve an idempotent checkpoint
   row as `staging`, including owner/run/parent/event links, expected digest,
   byte length and an unguessable temporary object key. A retry with the same
   append key and different metadata or digest fails closed.
2. Stream the blob to that temporary key while computing its digest and byte
   length server-side. Reject truncation, overflow or a digest mismatch. The
   temporary key is never returned by normal read/list APIs.
3. Idempotently promote/copy the verified blob to an immutable final
   content-addressed key, then read its metadata back and verify digest and
   length. Promotion does not publish the checkpoint: a crash here merely leaves
   a sweepable orphan object.
4. In one database transaction, revalidate ownership, parent monotonicity,
   message/run links and `afterEventSequence`, adopt that exact final object by
   setting `stateBlobRef`, change `staging -> committed`, and append a
   `conversation-checkpoint.committed` transactional-outbox row. A conflicting
   adoption or digest fails without changing a previously committed row.
5. Publish checkpoint/events only from the outbox after commit and then delete
   the temporary object idempotently. `append` returns only the committed row;
   `get`, `latestForRun`, branch listing, resume and export ignore `staging` and
   `failed` rows. Consequently no consumer can observe or restore a half-written
   checkpoint.

A bounded repair worker leases old `staging` rows. It completes a promotion when
the verified temporary/final object exists, otherwise marks the row `failed`
with a safe code after the retry policy expires. It also removes expired
temporary uploads and unreferenced final objects after a grace period. Object
listing is never treated as ownership: deletion first proves that no committed
checkpoint references the exact key/digest. Reconciliation reports pending,
failed, corrupt and orphan counts without logging state contents.

Retention is explicit: retain checkpoints needed by every live branch, active
or resumable run and export hold; compact only checkpoints made redundant by a
new versioned summary; tombstoned-thread checkpoints enter the same documented
recovery window as the thread. A mark-and-sweep job first records candidates,
rechecks branch/run/reference reachability in a transaction, deletes private
blobs, then records completion. A failed blob delete remains retryable and does
not erase the metadata needed for repair. Add migration/version readers for old
graph schemas; unsupported versions remain exportable and visibly
non-resumable, never silently reinterpreted.

Crash-injection tests stop after reservation, during a short upload, after a
complete temporary upload, after final-object promotion, immediately before and
after database adoption, before and after outbox publication, and during
temporary/orphan cleanup. After restart, each fixture converges to exactly one
committed checkpoint or one diagnosed failed row, never exposes a staging ref,
never restores corrupt bytes and never deletes a final object referenced by a
committed checkpoint.

## Run lifecycle

### Create/send

1. Validate the owned thread/branch, expected branch head `H`, client request ID
   and attachment references without calling a provider.
2. In one placement-store transaction, enforce uniqueness of
   `(threadId, clientRequestId)`, compare-and-swap the branch head from `H` to a
   new immutable user message `U`, and reserve exactly one active run plus its
   output-message ID. A duplicate request returns the original IDs. A stale
   head returns a structured conflict unless the caller explicitly requested
   `forkOnConflict`, in which case the transaction creates a named sibling
   branch from `H`; it never guesses which behavior the user intended.
3. Resolve model capabilities, data placement and the read-only tool grant, then
   build and persist the context manifest and initial conversation checkpoint.
4. Start plan 026's `AgentRuntime` only after step 2 commits and with read tools
   only. Immediately before outbound dispatch, persist
   `providerDispatchState = "dispatching"` and a stable `providerRequestKey`;
   then persist `acknowledged` when the provider confirms the stream/request.
   There can be at most one active run whose input is the current branch head
   `U`.
5. Persist every nonterminal event in the authoritative placement store before
   emitting it, then incrementally project validated draft parts. Draft
   projections are resumable run state, not a completed assistant message.
6. Append checkpoints at explicit graph boundaries and before/after a suspended
   user question; a checkpoint references only already-persisted event
   sequences.
7. Before exact evidence from an attachment/search/read tool is exposed to the
   model, append a committed context-manifest revision and its immutable
   run-scoped proof handles. Later parts may cite only those handles; retrieval
   results that were considered but not exposed do not become proof handles.
8. Complete through one `ConversationStore.finalizeRun(...)` transaction. It:
   validates that every proposed citation handle belongs to a committed manifest
   revision for this run; creates immutable output `O` and its validated parts;
   inserts citation-to-proof edges and final usage; compare-and-swaps `U -> O`
   or, if the head moved, creates/updates the explicit sibling-result branch
   without replacing the newer head; binds `O` to the run exactly once; marks
   the run terminal; and appends the unique terminal event as the last/highest
   sequence plus its transactional-outbox record. A fabricated, cross-run or
   uncommitted proof handle rejects the candidate answer; failure finalization
   may create only a safe uncited error result. SSE/poll publishers observe the
   outbox after commit, so clients can never receive a terminal event for a run
   whose output, citations, branch resolution or terminal status is absent.

If the HTTP request dies, the run continues or cancels according to its explicit
policy; reconnecting observes the same run from its authoritative placement.
Sending the same client request ID does not add a second user message or run.
Recovery scans reserved/nonterminal runs: a run with no provider start can be
started once, and a run with persisted events resumes from the latest valid
committed conversation checkpoint or becomes a single safe terminal failure
through the same atomic finalizer. A committed finalization is already complete
even if its outbox event was not yet published; the publisher resumes from the
outbox and cannot repeat the transaction. Provider
idempotency keys include the run ID. If the process dies in `dispatching` and the
provider cannot prove idempotent replay/resume, recovery marks the run
`provider_dispatch_unknown` and offers an explicit retry branch; it never
blindly charges/sends a second request. Losing the initiating HTTP response alone
does not create another provider request.

### Context manifest

The manifest records exactly what the model was allowed to see:

- system/workflow version and selected skill IDs;
- active branch message IDs and any summary version;
- explicit attachment/reference IDs and immutable source versions;
- active project instruction version, immutable content digest and project ID;
- retrieval query, result chunk/citation IDs, rank metadata and the exact
  run-scoped proof handles actually exposed to the model;
- token/byte budget by category;
- excluded/truncated items and reason;
- model/provider capability snapshot;
- trust label for every context item.

Default context order:

1. application policy and selected workflow;
2. current user instruction;
3. active project instructions, if any, as a separately labelled
   `user-instruction` item with exact version/digest;
4. explicitly attached objects;
5. active project sources;
6. retrieved passages;
7. recent active-branch messages;
8. versioned conversation summary when needed.

Project instructions are user content, never application/system policy. They
may shape tone and study workflow but cannot add a tool, scope, network target,
data placement, approval bypass or lower risk. The manifest records any rejected
instruction effect so the “Context used” panel can explain the boundary.

The manifest is append-only by `(runId, version)`. Initial prompt assembly
commits version 1; a retrieval/tool step that will expose new evidence commits
the next version and its proof handles before sending that evidence onward. The
run stores the latest committed manifest pointer under compare-and-swap while
all earlier revisions remain addressable for audit. Each proof captures the
immutable content-version edge, exact locator and evidence digest presented to
the model. It is not a bearer credential and never contains a signed download
URL. The runtime receives only opaque proof IDs alongside the evidence and the
finalizer rejects every citation ID absent from one of this run's committed
manifest revisions. Empty, filtered or budget-truncated results cannot be cited.

Never include every grade/file merely because the assistant is open. The user
can inspect a “Context used” panel from the manifest without seeing hidden model
reasoning.

### Conversation memory

Long threads use versioned, source-linked summaries. A summary is derived data:
retain the original messages, record its covered message range and model/key,
and invalidate it when the active branch changes before that range. Add a
read-only `conversation.search` tool over owned completed messages so the agent
can retrieve forgotten details without placing the whole history in every call.

Plan 029 owns and delivers plan 028's deferred
`ConversationIndexableSourceAdapter`. Index only completed, non-purged messages;
use the immutable message ID/content hash as the origin/version identity and a
message/part locator rather than flattening an entire branch. Tool payloads,
hidden provider state, secrets and transient streaming deltas are excluded.
Edits create another immutable source version; branch deletion removes the
project edge but GC keeps any version still reachable from a live branch,
citation, summary, export hold or retention window. Hard purge enqueues corpus
edge removal and index verification through the normal outbox.

The adapter, conversation project-item activation and `conversation.search` do
not ship until they pass plan 028's adapter/placement conformance suite, exact
message locator round-trip, hard-purge/index-GC and two-user isolation tests.
This is a 029 gate, not work deferred back to 028.

## Model and provider experience

Extend sealed per-user service keys for explicitly supported model providers,
OpenAI-compatible endpoints and optional OpenRouter. Validate a key with a safe
capability probe before saving it. Never return it to the browser after submit.

OpenAI-compatible endpoint policy is placement-aware and enforced by one shared
outbound HTTP guard:

- hosted Avermate core accepts curated providers and user-defined **public HTTPS**
  origins only; reject URL credentials, non-HTTPS schemes, fragments, arbitrary
  proxy/header injection and all loopback, private, link-local, multicast,
  carrier-grade NAT, documentation/reserved and cloud-metadata destinations for
  IPv4 and IPv6;
- resolve every A/AAAA answer, reject the whole request if any answer is
  forbidden, pin/connect to a validated address without changing TLS SNI/Host,
  revalidate on retry, and validate every redirect target before following a
  small bounded redirect count. Protect against mixed answers and DNS rebinding;
- normalize the origin as `(scheme, lowercase ASCII host, effective port)` and
  seal/bind the credential to that exact origin. A credential saved for one
  origin is never sent after a redirect or to another origin;
- private/LAN endpoints are allowed only for an administrator-configured fully
  self-hosted instance or through the paired node transport from plan 032. The
  hosted core never reaches a user's LAN on the browser's behalf;
- capability probes use the same guard, strict byte/time limits and redacted
  errors. Model-list data is untrusted input and cannot alter the base URL.

Tests include IPv4/IPv6 loopback, RFC1918, link-local and metadata addresses,
decimal/hex/octal and IPv4-mapped forms, credentials in URLs, mixed public/private
DNS answers, rebinding between validation/retry, a public-to-private redirect,
cross-origin redirect credential stripping, oversized responses and a valid
public HTTPS endpoint.

The model picker shows only tested capability descriptors:

- text/tool/vision/reasoning-summary support;
- context/output limits;
- local/BYOK/managed placement;
- known price snapshot and currency, or “unknown”;
- whether cached-token usage is reported;
- privacy link and whether content leaves the selected node/instance.

A requested model maps to a stable Avermate model key and a recorded resolved
provider model. Fallback is opt-in and visible. Do not switch from a user's BYOK
to operator-paid inference silently.

Usage display distinguishes input, output, reasoning, cache read and cache write
where reported. Unknown values remain unknown. Cost uses the price snapshot at
run time and is labelled estimated unless provider billing confirms it.

## Agent behavior in v1

The default graph supports:

- answer directly;
- create/update a visible plan/todo for the run;
- search project/account corpus;
- read exact citations and owned academic summaries;
- inspect document/job/transcription status;
- ask the user a structured question and resume;
- finish with sources and usage.

The broker grant includes only `effect = read` first-party tools. Attempts to
invoke any mutation become a structured unavailable-capability response, not a
prompt instruction asking the model to behave.

If retrieval returns only a scan locator without OCR/native text and the
selected model cannot receive the exact page image/PDF page, the assistant must
abstain from answering claims about that page and offer OCR or a capable
multimodal model. “No provider key” supports lexical answers over extractable
text; it does not imply free local handwriting/OCR inference.

### Skills and custom MCP

Treat a skill as a versioned workflow/instruction bundle with metadata,
compatible tools and context policy. It cannot add scopes or lower tool risk.
Ship a small reviewed catalogue: explain a lesson, diagnose a grade trend,
prepare revision questions and summarize attached sources.

Add custom MCP connection setup with these limits:

- credentials sealed server-side;
- public HTTPS/approved local-node endpoints only, with SSRF-safe resolution;
- catalogue preview before enablement;
- explicit per-tool allowlist and namespaced IDs;
- external content/results labelled untrusted;
- label the connection as a data-egress boundary: “read-only” means it cannot
  mutate Avermate, not that calls reveal nothing to the remote server;
- default each external tool to interactive approval until the user allowlists
  the exact tool and input data categories; never attach a document/message body
  merely because the model has it in context;
- v1 embedded assistant may enable only locally classified read tools;
- writes remain disabled until plan 030 policy/ledger support;
- node-hosted MCP placement arrives in plan 032.

An unavailable custom server cannot prevent first-party chat history from
opening.

## Web implementation

### Shell

Use a pinned `assistant-ui` ExternalStoreRuntime behind
`AvermateAssistantRuntimeAdapter`. Keep thread list/search and branch data in
first-party TanStack/oRPC state because assistant-ui's thread-list APIs are not
the canonical store.

Desktop layout:

- resizable right side panel integrated with `AppShell`;
- collapsed launcher with unread/running state;
- thread rail containing new/search/starred/recent/archive;
- persistent panel width and open state per user/device;
- full-page conversation route for deep work and shareable internal links.

This plan targets the Web application. Do not add React Native scope.

### Composer

Support:

- multi-line text and keyboard shortcuts;
- explicit model, skill and plan-mode controls;
- attachment upload through the existing private file flow;
- an Avermate object picker and `@`-style reference chips;
- image/file paste with preview and removal;
- send, queued state, stop and retry;
- visible storage/inference placement before content leaves the browser.

References are typed IDs, not textual URLs pasted into the prompt. Snapshot the
relevant source version in `assistantAttachments`.

### Dictation

Implement dictation as prompt transcription, not realtime voice chat:

1. require a secure context and report permission state;
2. feature-detect `mediaDevices.getUserMedia` and `MediaRecorder`;
3. negotiate with `MediaRecorder.isTypeSupported` rather than hard-coding one
   MIME type;
4. record bounded chunks, show level/time and allow cancel/review;
5. upload through the existing audio path and transcribe via the selected
   capability;
6. insert the transcript into the composer without auto-sending;
7. release every audio track on stop/error/unmount;
8. provide actionable errors for blocked permission, insecure origin, missing
   input device and unsupported codec;
9. allow an audio-file fallback when live capture is unavailable.

Add a Chrome end-to-end test using a fake media stream. The generic “MediaRecorder
unavailable” banner is not an acceptable diagnosis on a current Chrome secure
origin.

### Message rendering

Reuse Avermate's existing Markdown/document renderer for GFM, KaTeX, Mermaid,
Shiki, code, tables, callouts, datacards and safe inline assets. Add registered
message parts for:

- status/activity;
- plan and todo;
- tool calls with safe inputs/results;
- structured user questions;
- citations and source drawer;
- context/usage/cost;
- artifacts (read-only in this plan);
- safe errors and retry.

Custom widgets are a closed registry keyed by a validated part type. Model HTML,
JSX, scripts, remote iframes and arbitrary component names are never rendered.
Every source citation is clickable and opens the exact page/heading/timecode
through plan 028.

### Branching and controls

Every message exposes appropriate actions:

- copy rendered/plain Markdown;
- edit into a branch;
- retry from its parent;
- navigate sibling alternatives;
- inspect context and run metadata;
- report feedback.

Thread actions include rename, star, archive, soft-delete, export and save.
“Save to project” offers:

- add the conversation reference to a study project; or
- create a user-owned Markdown study document containing the selected active
  branch, citations and source/run metadata.

This is an explicit deterministic user gesture, not an agent tool call.

### Export

JSON export is versioned and can include either the active branch or the whole
DAG. It includes messages/parts, branch pointers, citations, model/usage and
tool audit summaries, but excludes secrets, signed URLs, opaque provider
reasoning tokens and internal encryption state.

Markdown export renders one chosen path with footnoted sources. An optional
appendix lists alternate branches; it does not flatten them ambiguously.

## API and stream routes

Add protected oRPC procedures for thread/branch/message metadata, search,
rename/star/archive/trash/restore/export, attachments and run lifecycle. Use a
dedicated authenticated SSE route for event delivery and cursor replay. Do not
stream through an RSC action.

The route delegates append/replay to the thread's authoritative
`ConversationStore`. For core placement, a committed core event sequence is the
SSE cursor. For future node placement, the browser/core relay carries the node's
opaque thread/run/sequence cursor and acknowledgements; the core does not
manufacture a replay log. If the node is unreachable, return a typed
`placement_unavailable` state with the last acknowledged sequence, keep retry
bounded and let the user reconnect/export when the node returns. Never fall back
to starting the run on core.

Rate limits distinguish:

- thread/message metadata operations;
- run starts and concurrent runs;
- model/provider tokens;
- attachment bytes;
- open SSE streams;
- custom MCP catalogue/invocations.

Cancellation propagates to runtime, provider fetch and read tools. A cancelled
run gets a terminal event and retains partial visible text marked incomplete.

## Delivery sequence and gates

1. Add conversation-store schemas/migrations, normalized citation/reference
   edges, `CoreConversationStore` and production
   `CoreConversationCheckpointStore`. **Gate**: DAG, proof-handle foreign keys,
   checkpoint staging/promotion/adoption, append-only checkpoint,
   checkpoint-version migration, compare-and-swap, retention/GC, soft-delete and
   export/import unit tests pass before any runtime writes messages; only
   committed checkpoints are returned or restorable under every crash fixture.
2. Add the transactional send reservation, mocked runs, persisted event
   projection, atomic `finalizeRun`, transactional outbox, authenticated SSE
   replay and polling fallback. **Gate**: two sends racing from the same head
   produce one accepted append and one explicit conflict/sibling according to
   the requested policy—even when provider completions are delivered in reverse
   order—and disconnect/crash at every fixture boundary yields one identical
   final projection, one output binding and one last terminal event after
   process restart. No publisher can observe terminal state before output,
   parts, citations and branch resolution are committed together.
3. Connect the accepted `AgentRuntime`/`ModelGateway` with a read-only broker
   grant. **Gate**: mocked and opt-in BYOK flows expose no mutation descriptor,
   no provider call precedes placement resolution and cancellation reaches all
   active reads/provider streams; the endpoint SSRF suite above passes through
   both save-time probes and run-time calls.
4. Build the assistant-ui ExternalStore adapter, side panel, thread rail and
   full-page route. **Gate**: refresh and sibling-branch navigation reproduce
   server state without assistant-ui becoming canonical.
5. Add references/uploads, context manifest, normalized retrieval/citations,
   `ConversationIndexableSourceAdapter`, `conversation.search`, rich parts and
   safe widgets. **Gate**: every cited fixture opens exactly; the adapter passes
   plan 028 conformance and hard-purge GC; project instructions remain labelled
   user content; **100%** of persisted citation edges in adversarial fixtures
   resolve to an immutable proof handle in that same run's committed manifest,
   and fabricated/cross-run/uncommitted handles are rejected; XSS, remote asset,
   prompt-injection and cross-user attachment / conversation-index tests pass.
6. Add model/skill controls, structured user questions and Web dictation.
   **Gate**: Chrome fake-device E2E records, stops, releases tracks and inserts
   transcript without auto-send; unavailable paths show their specific reason.
7. Add edit/retry, export, project save, custom read-only MCP and retention /
   checkpoint-GC controls. **Gate**: whole-DAG JSON round-trip, active-path
   Markdown, custom-MCP egress approval, historical-branch byte preservation and
   mark/sweep crash-retry tests pass.
8. Run the complete test/quality/build commands below. **Gate**: all exit 0 with
   the production mutation grant still empty.

Step 6 creates the currently absent Web E2E harness: pin `@playwright/test` as a
dev dependency, add `apps/web/playwright.config.ts`,
`apps/web/e2e/assistant.spec.ts` and a `test:e2e` script in
`apps/web/package.json`. CI installs the pinned Chromium build and runs the fake
microphone case with controlled media permissions/input; it does not depend on a
developer's physical microphone.

## Testing

### Persistence and DAG

- append, edit, retry and model-edited branch invariants;
- concurrent sends to the same branch start from the same `H`: one transaction
  reserves `H → U` and one gets a typed conflict unless it explicitly requests
  a sibling; no rejected request reaches a provider;
- reverse provider completion order cannot overwrite a newer head, adopt the
  same output twice or attach an output to the wrong input;
- duplicate client request IDs return the same user/run/output reservation;
- old branches remain byte-for-byte accessible;
- refresh reconstructs the same active path;
- soft-delete/restore and eventual purge respect retention;
- export/import round-trip preserves DAG and normalized citations;
- checkpoint parent/message/run/sequence cross-links reject cross-thread and
  non-persisted-event references;
- a checkpoint cannot be read/restored while `staging` or `failed`; temp upload,
  promotion and database-adoption crash fixtures reconcile idempotently and a
  digest mismatch never becomes committed;
- mark/sweep GC retains every checkpoint/source version reachable from a live
  branch, citation, summary or export hold; failure between blob deletion and
  metadata completion is retryable and idempotent.

### Streaming

- disconnect at every event boundary, resume by cursor and project once;
- duplicate event delivery is idempotent;
- one and only one terminal event;
- cancellation during model delta/tool read/user question;
- crash/restart immediately after `H → U` reservation, before provider start,
  after provider start acknowledgement, before/after every persisted event,
  before/after checkpoint append, immediately before terminal finalization,
  during a forced rollback of each finalizer write, immediately after the
  atomic finalizer commit and before/after outbox publication. Rollback exposes
  none of `O`/parts/citations/branch/run-terminal/terminal-event; commit exposes
  all of them exactly once, with the terminal event last;
- no event is emitted before the authoritative placement store commits it;
- a fake node store proves core retains only routing/sequence/ack metadata,
  node replay resumes from the node cursor, node-offline returns
  `placement_unavailable`, and no claim of relay confidentiality is exposed;
- polling fallback matches SSE projection.

### Security/privacy

- cross-user thread/message/reference/event access denied;
- attachments do not grant source access;
- prompt injection in retrieved text cannot enable write tools;
- fabricated, cross-run, cross-user, stale-manifest and uncommitted proof
  handles cannot become citations or keep corpus content reachable;
- custom MCP is namespaced, bounded and read-only;
- secret/event/export redaction;
- Markdown/widget/asset XSS and remote-resource tests;
- no provider request before the placement/privacy choice resolves;
- model endpoint SSRF/DNS/redirect/origin-bound-secret suite described above;
- project instructions cannot alter tool grants, risk, approval or placement.

### Answer quality and citations

Use plan 028's fixed bilingual evidence/query fixtures plus at least 40
human-authored answerable questions and 20 deliberately unanswerable or
insufficient-evidence questions. Pin the judge rubric/version and keep a
deterministic human-reviewed sample in the repository. Release gates are:

- supported-claim faithfulness **≥ 0.95**: at least 95% of externally checkable
  claims are entailed by their cited immutable evidence;
- citation precision **≥ 0.95**: at least 95% of citations directly support the
  claim part carrying them;
- citation claim coverage **≥ 0.95**: at least 95% of externally checkable claims
  that rely on corpus data carry one or more supporting citations;
- exact locator resolution **100%** for citation fixtures, including immutable
  source hash equality after open;
- citation proof membership **100%**: every persisted citation resolves through
  a foreign-keyed proof handle in the same run's committed context manifest,
  and the cited evidence digest matches what that run was allowed to see;
- abstention recall **≥ 0.90** on insufficient-evidence questions, including
  scan-only pages with no OCR and no visual-capable model;
- cross-user evidence leakage **0** across the full evaluation.

Record numerator, denominator, model/provider/version and fixture commit for
every run. A model update that misses a threshold blocks rollout; it cannot be
waived by a better aggregate “helpfulness” score. Do not use model-generated
grader rationales as product-visible chain-of-thought.

### UX

- keyboard and screen-reader flows for composer, branch nav and tool disclosure;
- Chrome fake-microphone dictation;
- model capability degradation;
- narrow Web viewport without introducing mobile-app code;
- thread search covers title and message content through plan 028's index.

### Commands

```powershell
bun run --cwd apps/server test src/assistant
bun run --cwd apps/web test src/components/assistant
bun run --cwd apps/web test:e2e -- assistant
bun run format:check
bun run lint
bun run check-types
bun run test
bun run build
```

## Rollout

1. staff/dev flag with mocked model;
2. BYOK/local models, read-only tools and core conversation store;
3. small opt-in cohort with quotas and feedback;
4. general availability only after reconnect/DAG/privacy metrics are stable;
5. keep mutation grants disabled until plan 030 completes.

## Done criteria

- The full user-visible outcome at the top works in the Web app.
- Conversations are immutable DAGs with durable event replay.
- Run terminalization commits output, parts, proof-backed citations, branch/run
  state and the final event atomically before publication.
- Only committed, digest-verified conversation checkpoints can be restored.
- Every answer source opens at an exact locator.
- Context, model, usage and cost are inspectable and honest.
- Current Chrome dictation works on a secure origin with useful errors.
- Rich content and custom widgets pass sanitization tests.
- BYOK/local use works without paid Avermate inference.
- Agent tool grants contain no domain mutation.
- JSON/Markdown export and project save work without leaking secrets.

## STOP conditions

- A plan 025 clean baseline does not exist.
- A response can be visible before its event is persisted.
- A terminal event can be published independently of its output, citations,
  branch resolution or terminal run state.
- A staging/failed checkpoint or unverified object can be returned as
  restorable.
- A citation can target evidence outside that run's committed context-manifest
  proof handles.
- Editing/retry overwrites an earlier message or branch.
- The UI runtime becomes the source of truth.
- A source attachment bypasses ownership or explicit context selection.
- A provider key reaches the browser, event log or export.
- Raw hidden chain-of-thought is stored or presented as a guaranteed feature.
- Any agent-authored domain write is enabled before plan 030.

## Maintenance notes

Pin assistant-ui/AG-UI pre-1.0 versions and run adapter contract tests on every
upgrade. Version message parts, exports, skills, context manifests and graph
state independently. Monitor stream reconnect rate, time-to-first-event,
terminal-event completeness, retrieval citation opens and provider error classes
without collecting prompt/document content by default.
