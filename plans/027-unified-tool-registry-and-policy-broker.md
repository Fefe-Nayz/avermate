# Plan 027: Unified tool registry, policy broker and MCP parity

> **Executor instructions**: Read this plan and the accepted v2 ADR from 026
> before extracting a tool. Migrate surface by surface, prove adapter parity
> after each slice, and update the 027 row in `plans/README.md` only after the
> catalogue/security gates pass. Do not mass-register routers or push changes
> unless requested.
>
> **Drift check (run first)**: run the command below. If plan 026's
> event/approval contracts or a current MCP registration changed, update the
> inventory and compatibility strategy before implementation; stop on an
> unexplained authority change.
>
> ```powershell
> git diff --stat <plan-025-baseline>..HEAD -- packages/agent-contracts apps/server/src/tools apps/server/src/mcp apps/server/src/routers
> ```

> [!IMPORTANT]
> Do not create a second set of agent-only business mutations. Existing oRPC
> procedures remain authoritative. This plan gives MCP, the embedded runtime and
> future custom nodes one typed catalogue and one deterministic authorization
> broker around those procedures.

## Status

- **Status**: TODO
- **Priority**: P0
- **Effort**: L–XL
- **Risk**: HIGH
- **Depends on**: 025 and 026
- **Blocks**: 028, 029, 030, 031 and 032
- **Category**: server architecture, MCP, authorization, developer platform
- **Planned at**: 2026-08-22
- **Planning baseline**: plan 025 baseline SHA

## Problem

Avermate already has a broad MCP catalogue under
`apps/server/src/mcp/surfaces/`, and those tools delegate to an internal oRPC
client. This is the correct authority direction. It is not yet a reusable agent
registry:

- input schemas, descriptions, risk and scopes live close to MCP registration;
- newer document artifact, quiz and material-search capabilities are not all at
  MCP parity;
- `mcp_operations` is an idempotent replay fence for destructive calls, not a
  general execution/audit contract;
- a future embedded agent would otherwise repeat tool definitions and approval
  logic;
- custom MCP tools need a trust boundary separate from first-party tools.

The target is one catalogue, several adapters:

```text
Canonical oRPC/domain operation
              ▲
              │ execute with authenticated principal
        Avermate ToolBroker
              ▲
       ┌──────┼────────┐
       │      │        │
      MCP  embedded   node/runtime
            agent      bridge
```

## Scope

### In scope

- A typed, versioned registry of first-party tool descriptors.
- Deterministic scopes, risk, effect, idempotency, preview and compensation
  metadata.
- A policy broker that authorizes every invocation independently of the model.
- Adapters for current MCP and plan 026's `AgentRuntime`.
- MCP parity for already-shipped material/document/artifact/job capabilities.
- A federated tool-source interface and mock external MCP source.
- Safe result envelopes, redaction, size budgets, citations and event emission.
- Contract generation and catalogue drift tests.

### Out of scope

- Implementing retrieval itself (028).
- User-visible chat or external-MCP settings UI (029).
- General undo execution (030), beyond declaring whether a tool can be
  compensated.
- Arbitrary shell commands or filesystem paths.
- Letting a model grant itself scopes, lower risk or change approval mode.

## Descriptor contract

Add a shared package/module with a descriptor shaped like:

```ts
type ToolEffect = "read" | "create" | "update" | "delete" | "external";
type ToolRisk = "low" | "medium" | "high" | "irreversible";
type ApprovalRequirement = "never" | "policy" | "always";

interface AvermateToolDescriptor<I, O> {
  id: string; // stable, e.g. "grades.create"
  version: number;
  title: string;
  description: string;
  inputSchema: ZodType<I>;
  outputSchema: ZodType<O>;
  requiredScopes: readonly string[];
  effect: ToolEffect;
  risk: ToolRisk;
  approval: ApprovalRequirement;
  idempotency: "none" | "optional" | "required";
  preview: "none" | "supported" | "required";
  compensation: "none" | "supported" | "guaranteed";
  inputBudget: { maxBytes: number; maxDepth: number; maxItems: number };
  resultBudget: { maxBytes: number; maxDepth: number; maxItems: number };
  redact: (input: I) => RedactedToolInput;
  execute: (context: ToolExecutionContext, input: I) => Promise<O>;
  resultProjections: {
    model: {
      schema: ZodType<ModelToolResult>;
      project: (output: O) => ModelToolResult;
    };
    ui: {
      schema: ZodType<UiToolResult>;
      project: (output: O) => UiToolResult;
    };
    audit: {
      schema: ZodType<AuditToolResult>;
      project: (output: O) => AuditToolResult;
    };
  };
}
```

Descriptors are code, not database-editable prompt text. Tool IDs and semantic
versions are stable API. Descriptions may improve without changing IDs, but a
breaking input/output or effect change increments the descriptor version.

`O` is a validated in-process domain result, not a persistable DTO. The broker
must immediately derive three independently schema-validated projections:

- the **model projection** is minimal, token-bounded and contains only facts the
  model needs for its next decision;
- the **UI projection** contains opaque resource/file handles and widget data
  safe for the authenticated owner, but no credential or signed URL;
- the **audit projection** contains IDs, outcome, counts, timing and redacted
  change metadata, never document bodies or model-readable narrative.

No adapter may serialize `O` directly. The three projections have distinct Zod
schemas and budgets; a field is absent unless that audience requires it.

### Execution context

`ToolExecutionContext` contains only trusted, server-created state:

- authenticated user/principal;
- OAuth/MCP scopes or embedded-session grant;
- thread, branch, run and tool-call IDs when invoked by an agent;
- selected approval policy;
- request abort signal and deadline;
- capability/data-placement resolver;
- event sink;
- action-ledger writer interface, initially a no-op until plan 030.

It never accepts a user/model supplied `userId`, role, scope, risk or provider
credential.

## Policy broker

The broker performs this ordered pipeline for every call:

1. resolve the descriptor by exact ID/version;
2. validate input and enforce serialized byte/depth/array limits;
3. verify authentication, ownership and required scopes;
4. recompute risk and approval from the descriptor, not model output;
5. reserve the idempotency key when required;
6. build a redacted preview for approval when applicable;
7. execute the canonical operation through an authenticated internal oRPC/domain
   adapter;
8. validate and bound the in-process result;
9. derive and independently validate the model, UI and audit projections;
10. persist only the appropriate redacted UI/audit projections and opaque
    handles, never the raw result or a signed URL;
11. publish ordered tool events with the audience-appropriate projection;
12. complete the idempotency record.

Any crash after side effect but before completion leaves an inspect-required
state; it must never blindly retry a non-idempotent mutation.

### Risk defaults

| Effect/example                                | Default risk | Default approval               |
| --------------------------------------------- | ------------ | ------------------------------ |
| read owned grades/material snippets           | low          | never                          |
| create a draft fiche or personal task         | medium       | policy                         |
| update a grade, subject or project            | medium       | policy                         |
| detach/dismiss provider data                  | high         | always                         |
| trash a recoverable object                    | high         | always                         |
| purge, revoke credentials, send external data | irreversible | always                         |
| run isolated artifact code                    | high         | policy plus sandbox capability |

The user's `auto` mode may waive only `policy` approvals and only for scopes the
session grant permits. `always` remains interactive. External MCP tools default
to high risk until explicitly classified by a trusted local policy.

## Registry extraction sequence

### 1. Inventory current surfaces

Generate a review report for:

- every oRPC procedure under `apps/server/src/routers/`;
- every MCP registration under `apps/server/src/mcp/surfaces/`;
- required OAuth scopes;
- read/write/delete behavior;
- current confirmation/idempotency path;
- maximum result size and whether a signed URL can appear.

Classify each as:

- agent-safe and registry-ready;
- safe after output narrowing;
- requires preview/compensation design;
- human/admin-only;
- never expose to an agent.

Do not automatically register every router method.

### 2. Extract read tools first

Move descriptor metadata for existing read/resource/job tools into the registry
without changing public tool names. MCP registration becomes an adapter that
iterates an explicit ordered list, preserving the deterministic catalogue
contract in `apps/server/src/mcp/surfaces/index.ts`.

First-wave read tools should cover:

- years, periods, subjects, grade types, grades, averages and goals;
- planning tasks/assignments/events/timetable;
- material folders/documents/tags and transcript/artifact state;
- study documents, references and generated-artifact metadata;
- recordings/transcript status;
- jobs status;
- connection capability/status summaries without credentials;
- project/corpus search after plan 028 supplies it.

Large bodies are never returned by list calls. Use bounded snippet/resource
reads or opaque owned file handles. A file handle identifies an authorized
resource and intended operation; it is not a URL, bearer credential or storage
key.

### 3. Extract non-destructive writes

Register create/update operations with revision fences where available. Add an
expected revision/version to operations that currently permit last-write-wins
and would be unsafe under agent concurrency. The broker must distinguish:

- stale revision;
- ownership failure;
- invalid mapping/provider-managed field;
- missing capability;
- approval required;
- quota/rate limit;
- retryable provider/job failure.

Do not flatten these to free-form text; return a stable structured error code
plus a safe message.

### 4. Unify destructive confirmation

Refactor `runDestructive` and `mcpOperations` behind the broker while preserving
the existing MCP multi-round confirmation wire behavior. An embedded run uses a
plan-026 approval event/interrupt instead of MCP elicitation, but both reserve
the same logical operation and arguments hash.

Never accept a confirmation minted for another user, client, tool version,
arguments hash, branch or expired run.

### 5. Reach parity for shipped studio capabilities

Expose bounded tools for capabilities that already exist but are missing or
partial in MCP:

- list/create/update quiz documents without exposing answer keys during an
  active attempt;
- enqueue and inspect Anki, HTML, audio/podcast, PPTX and LaTeX artifacts;
- return an opaque owned artifact handle; only an authenticated explicit UI
  download gesture may exchange it for a short-lived response/URL;
- list document revisions/artifacts and inspect compiler/provider logs after
  redaction;
- start and inspect bulk transcription jobs;
- search material content once 028 lands;
- attach/detach source references to a study project once 028 lands.

Each asynchronous tool returns `jobId`, stable resource IDs and the next legal
tool; it does not ask agents to poll an arbitrary URL.

### 6. Add federated tool sources

Define a source description separately from the broker-owned byte transport:

```ts
interface ToolSource {
  sourceId: string;
  trust: "first-party" | "user-configured" | "node";
  listRequest(context: ToolCatalogContext): ToolSourceRequest;
  invokeRequest(
    context: ToolExecutionContext,
    call: ExternalToolCall,
  ): ToolSourceRequest;
}

interface ToolSourceTransport {
  exchange(
    source: ToolSource,
    request: ToolSourceRequest,
    limits: ToolSourceTransportLimits,
    signal: AbortSignal,
  ): Promise<{
    declaredBytes?: number;
    contentType: string;
    body: AsyncIterable<Uint8Array>;
  }>;
}

type ToolSourceTransportLimits = {
  connectDeadlineMs: number;
  totalDeadlineMs: number;
  maxBytes: number;
  maxDepth: number;
  maxItems: number;
};
```

The broker, not the source adapter, owns `ToolSourceTransport`. Reject a declared
length over budget before reading. While consuming `body`, abort at the byte or
deadline limit and feed a streaming JSON tokenizer that counts structural depth
and total object/array items **before materializing a JavaScript value**. Reject
duplicate security-sensitive keys and trailing JSON. Never call `response.json()`
or accept `Promise<unknown>` from an external source. Only after all transport
budgets pass may the broker materialize and validate the external descriptor or
tool-result schema.

Implement only an in-process test MCP source in this plan. The contract must
prove:

- namespacing prevents collisions with first-party IDs;
- tool list changes invalidate a reviewed capability snapshot;
- external results are untrusted data;
- credentials stay in the source adapter;
- all calls still pass through broker risk, approval, deadlines and result
  budgets;
- a source cannot advertise `low` risk and bypass local policy.
- a slow/infinite stream, false `Content-Length`, oversized body, excessive JSON
  depth/item count and malformed/trailing JSON all fail before any result event
  or persistent projection is created.

User-facing custom MCP setup arrives in plan 029; remote execution placement
arrives in plan 032.

## Result and event contract

Return a consistent envelope:

```ts
type ToolResultV1<T> = {
  ok: boolean;
  data?: T;
  error?: { code: string; message: string; retryable: boolean };
  citations?: CitationRef[];
  next?: Array<{ toolId: string; reason: string }>;
  replayed?: boolean;
  truncated?: boolean;
};
```

Tool events emitted through plan 026 include queued/start/progress/result/error,
descriptor version, redacted preview, timing and action-ledger reference. Model
events carry only the model projection; owner-facing durable events carry the
bounded UI projection; audit/action records carry only the audit projection.
Never put the raw domain result, whole private documents or signed download URLs
in durable events, logs, conversation messages or audit rows.

### Opaque file download exchange

Add one authenticated, ownership-checked UI endpoint that accepts an opaque
file handle and the expected operation (`preview` or `download`). It re-resolves
current ownership and revocation state, applies rate/size policy, and either
streams the bytes or mints a single short-lived URL in the HTTP response. The URL
must never enter a database row, conversation event, tool result, model context,
analytics record or server log. Handles expire, are audience-bound, cannot be
used cross-user, and reveal no bucket/key/path. MCP clients receive the opaque
handle plus an explicit resource-read operation, not a reusable signed URL.

## Tests

### Registry invariants

- unique stable `(id, version)` pairs;
- valid JSON Schema conversion for MCP;
- every descriptor declares non-empty scopes, risk and result budget;
- every descriptor defines model/UI/audit schemas and all three projections fit
  their independent budgets;
- mutation descriptors declare idempotency and compensation truthfully;
- registry order is deterministic;
- no admin/human-only procedure appears accidentally.

### Adapter parity

For representative tools, invoke through direct broker, MCP adapter and embedded
adapter with the same principal/input and assert equivalent structured results.
Cover authorization failure, stale revision, approval, cancellation, replay and
result truncation.

### Security

- model-supplied `userId`, scope, risk and approval fields are rejected/ignored;
- retrieved/source content cannot alter trusted grants, scopes, descriptor risk,
  approval policy, execution placement or egress policy; only read tools that
  were already granted and bounded independently of that content may continue
  to execute;
- external MCP tool descriptors cannot lower local risk;
- args/results redact secrets and signed URLs;
- raw results cannot bypass audience projections, and no persisted projection
  contains a signed URL, storage key or bearer credential;
- opaque file handles cannot be guessed, replayed after expiry, exchanged by a
  second user or persisted as a signed URL after an authenticated download;
- external source byte/deadline/depth/item limits fire before materialization;
  cover lying/missing lengths, chunked infinite streams and JSON bombs;
- cross-user resource IDs fail before the canonical operation;
- a replay with changed args fails;
- a completed replay does not duplicate the side effect.

### Commands

```powershell
bun run --cwd packages/agent-contracts test
bun run --cwd apps/server test src/tools
bun run --cwd apps/server test src/mcp
bun run format:check
bun run lint
bun run check-types
bun run test
bun run build
```

## Migration and rollout

Dual-register a small read-only surface first and compare generated catalogues
in tests. Move one MCP surface at a time. Keep compatibility aliases when a
public tool name must change; publish a deprecation window. Do not switch all
117-ish registrations in one unreviewable commit.

Existing pending/completed `mcp_operations` rows remain readable. If the schema
gains descriptor/branch fields, backfill old rows as `legacy-mcp-v1` rather than
guessing absent values.

## Done criteria

- First-party tools have one descriptor source consumed by MCP and the embedded
  broker.
- Current MCP names and OAuth behavior remain compatible or have documented
  aliases.
- Studio/job/search parity gaps are closed or explicitly classified as unsafe.
- Destructive calls share one idempotency/approval path.
- External MCP mock proves namespacing and policy containment.
- Tool results have separately validated model/UI/audit projections, and file
  access uses the opaque-handle exchange with no persistent signed URL.
- Federated transport conformance proves byte, deadline, depth and item budgets
  before parsing/materialization.
- Catalogue, parity, security and full repository gates pass.
- No generic shell or unbounded file tool is registered.

## STOP conditions

- Extraction would bypass a canonical router/domain ownership check.
- The broker trusts risk, scope or identity received from a model/client.
- A mutation has no honest retry/idempotency story.
- An external MCP result can enter system instructions or logs as trusted text.
- Public MCP compatibility would break without a version/deprecation plan.
- Plan 026 event redaction or approval interrupts are not available.

## Rollback and maintenance

Migrate surface-by-surface so each can revert to its previous explicit MCP
registration. Keep registry descriptors code-reviewed like API endpoints. A
dependency or domain change that alters tool effect, risk or output must update
descriptor tests and, when breaking, increment its version.
