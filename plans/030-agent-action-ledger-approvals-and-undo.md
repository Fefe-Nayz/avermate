# Plan 030: Agent mutations — approvals, action ledger and selective undo

> **Executor instructions**: Read plans 026, 027, the completed read-only chat
> implementation from 029 and the workspace/snapshot substrate from 031. Plan
> 031 is a hard prerequisite for workspace-aware branching; do not emulate it in
> the action ledger. Enable one mutation at a time only after its crash, revision
> and compensation tests pass; update the 030 row in
> `plans/README.md` only when every enabled write uses the ledger. Do not push or
> open a PR unless requested.
>
> **Drift check (run first)**:
>
> ```text
> git diff --stat <plan-025-baseline>..HEAD -- packages/agent-contracts apps/server/src/tools apps/server/src/actions apps/server/src/db/schema apps/server/src/routers apps/server/src/mcp apps/web/src/components/assistant
> ```
>
> Regenerate the mutation/compensation inventory for any changed domain route;
> stop if a target mutation lacks an ownership or revision fence.

> [!IMPORTANT]
> “Go back to this message” must never mean “silently roll the whole database
> back.” Conversation history, sandbox state and academic data have different
> owners and lifecycles. This plan enables agent writes only through explicit,
> version-fenced domain actions with a preview and, where honest, a compensating
> action.

## Status

- **Status**: IMPLEMENTED FOR THE ENABLED BROKERED ROLLOUT — unreviewed mutations
  remain disabled and baseline/global gates remain
- **Priority**: P1
- **Effort**: XL
- **Risk**: CRITICAL
- **Depends on**: 027, 029 and 031; 026 event/interrupt contract
- **Coordinates with**: 032 node execution
- **Category**: domain integrity, agent safety, audit, UX
- **Planned at**: 2026-08-22
- **Planning baseline**: plan 025 baseline SHA

### Implementation checkpoint (2026-08-22)

The action ledger, approval binding, revision fences, compensation state,
private sealed continuations and startup crash recovery are implemented for the
reviewed ToolBroker descriptors. The focused action-ledger suite passes **22
tests with 0 failures**, including the real restart window between an
`executing` claim and completion. Recovery replays only a descriptor explicitly
marked `idempotent-retry` after exact continuation/principal/tool/version/input
validation; missing, mismatched or ambiguous work becomes
`inspect-required` instead of being guessed or silently retried.

This status applies only to enabled brokered mutations. The MCP rollout
allowlist currently contains `planning.tasks.create`, the reviewed artifact
commands, and ledger-control operations; unknown/unreviewed legacy writes fail
closed. They do not count as implemented action-ledger mutations merely because
their discovery schema still exists. Enabling another write still requires its
descriptor, risk/approval policy, crash semantics and compensation tests.

The final repository, migration and clean-clone gates remain pending under plan
025; this checkpoint does not claim that every historical mutation surface has
been migrated.

## Scope

**In scope**: brokered first-party/MCP mutations, action/approval/resource
ledger, revision fences, reviewed compensators, user approval modes, action
cards/activity UI and the three-way historical branch restoration choice.

**Out of scope**: raw database/time-machine rollback, automatic reversal of
ambiguous external effects, unrestricted custom-MCP writes, admin/credential
tools and making every historical/manual/provider mutation reversible.

## Outcome

The embedded agent and external MCP clients can perform reviewed Avermate
mutations without gaining database access. Every call is:

- authorized through the tool broker;
- previewed according to risk;
- bound to exact input, principal, branch and tool version;
- idempotent or explicitly non-retryable;
- recorded before and after execution;
- linked to changed resource revisions;
- undoable through a domain-specific compensator when still safe;
- shown in the conversation as a durable, inspectable action card.

Users can choose read-only, confirm-writes or auto-reversible modes. They can
undo one eligible action or preview a group of branch actions. Irreversible and
externally visible actions remain clearly non-undoable and require confirmation.

## Principles

1. **No raw SQL rollback.** Undo invokes ordinary domain operations with
   ownership and revision checks.
2. **No temporal collateral damage.** Later manual or provider changes are not
   overwritten to recreate a historical state.
3. **Compensation is a new action.** History is append-only; an undo never erases
   the original audit row.
4. **Provider facts remain provider-owned.** The agent may change only the same
   overlays/actions a user is allowed to change.
5. **External effects are honest.** A sent email, third-party MCP call, provider
   sync or downloaded remote object cannot be labelled fully undoable unless a
   verified inverse exists.
6. **Approval is deterministic.** The model cannot self-approve or lower risk.
7. **Branching is not restoration.** A message branch changes conversation state
   only unless the user separately approves workspace/data compensation.

## Schema

Add entities equivalent to:

```ts
agentActionBatches {
  id, userId, threadId?, branchId?, runId?,
  label?,
  status: "open" | "completed" | "failed",
  domainCursorBeforeRef, domainCursorAfterRef?,
  createdAt, completedAt?
}

agentActions {
  id, batchId?, userId,
  actorKind: "embedded-agent" | "mcp" | "user-undo" | "system",
  actorClientId?, threadId?, branchId?, runId?, toolCallId?,
  domainScopeKind?, domainScopeId?,
  toolId, toolVersion, effect, risk,
  argumentsHash, idempotencyKey, actionSequence,
  redactedInputJson, previewJson?,
  status: "reserved" | "awaiting-approval" | "executing" |
          "rejected" | "expired" | "completed" | "failed" |
          "inspect-required",
  resultSummaryJson?, safeError?,
  compensatorId?, compensationOfActionId?,
  startedAt?, completedAt?, createdAt
}

agentActionResources {
  actionId,
  resourceKind,
  resourceId,
  operation: "create" | "update" | "trash" | "restore" | "delete" |
             "attach" | "detach" | "external",
  beforeRevision?, afterRevision?,
  beforeSnapshotJson?, afterSnapshotJson?,
  contentRefBefore?, contentRefAfter?
}

agentApprovals {
  id, actionId, userId,
  state: "pending" | "approved" | "rejected" | "expired",
  argumentsHash, previewHash, expiresAt,
  resolvedAt?, resolutionContextJson?
}

agentActionDependencies {
  userId,
  actionId,
  dependsOnActionId,
  scopeKind: "branch" | "domain",
  scopeId,
  relation: "resource" | "explicit" | "saga",
  createdAt
}

agentActionDependencyFences {
  userId,
  version,
  updatedAt
}

type AgentActionUndoState =
  | "not-applicable"
  | "ineligible"
  | "eligible"
  | "approval-pending"
  | "in-progress"
  | "compensated"
  | "partially-compensated"
  | "conflicted"
  | "failed"
  | "blocked";

type AgentActionDto = AgentActionRecord & {
  undoState: AgentActionUndoState;
  activeCompensationActionId?: string;
  undoReasonCode?: string;
};
```

Add a monotonically increasing per-user/domain mutation sequence or equivalent
`DomainCursorRef` that can identify action boundaries without pretending to
snapshot the database. Every brokered mutation records its `actionSequence` and
the batch records explicit `domainCursorBeforeRef`/`domainCursorAfterRef` fields.
Existing rows that lack revision fields gain a revision/update fence where
agent-safe mutation requires one.

An action's lifecycle `status` records only that action's execution. In
particular, a source action remains terminal `completed` forever when it is
undone. Its compensator is a distinct action with `compensationOfActionId` and
its own ordinary lifecycle. `undoState` is a derived read-model field computed
from eligibility, current resource revisions and all compensation descendants;
it is not another mutable lifecycle status. If it is materialized for query
performance, treat it as rebuildable projection data, update it transactionally
through an outbox and never use it as audit truth. Batch undo/partial state is
derived in the same way; `agentActionBatches.status` describes original batch
execution only.

`agentActionDependencies` is append-only and tenant-scoped, but a batch is only
a presentation/execution grouping: a causal edge may cross batches. Every edge
must select one explicit compatible scope:

- a `branch` edge requires both actions to belong to the same owned branch; or
- a `domain` edge requires the exact same normalized owned domain tuple, such as
  `academic-year:<id>` or `project:<id>`.

Both actions and every referenced resource must resolve to the same tenant/user;
self-edges, cross-tenant edges, unrelated branches/domains and dangling actions
are rejected. Reserve the action and all initially known edges in one
transaction. Later edges are allowed only while the dependant action is
`reserved` or `awaiting-approval`; incoming dependencies freeze before
`executing`. A relation discovered after that point must be represented by a new
follow-up/repair action rather than retroactively rewriting causality.

Every edge insertion uses the same validator and locks/CASes the tenant's single
`agentActionDependencyFences` row before testing reachability and inserting the
edge. Re-run the cycle query after acquiring that fence, increment its version
atomically and make `(userId, actionId, dependsOnActionId, scopeKind, scopeId)`
unique. A tenant-wide fence is intentional in v1: narrower branch-only locks can
miss a concurrent cycle whose path alternates branch- and domain-scoped edges.
This serializes competing A-to-B/B-to-A inserts even when they arrive from
different batches, scopes or workers. Derive a stable topological order using
`(actionSequence, actionId)` as the tie-breaker; never infer dependency order
only from timestamps. A batch cannot become `completed` until every required
predecessor, including a predecessor from another batch, is terminal in a
compatible state.

### Snapshot constraints

Resource snapshots contain only the minimum fields required for preview and
compensation. Never copy:

- sealed credentials or refresh tokens;
- entire private file bodies;
- raw provider responses;
- signed URLs;
- unbounded document/conversation content into the action table.

Large/revisioned content uses immutable file/document revision references and
hashes. Redaction runs before persistence.

## Action lifecycle

### Reservation and approval

1. Broker resolves the exact tool descriptor and validates input.
2. It computes arguments hash and reserves `(user, tool, idempotencyKey)`.
3. Tool-specific preview resolves owned resources and current revisions.
4. Policy chooses execute or interrupt; the resulting requirement is persisted.
5. Approval UI shows concrete consequences, affected objects and undo truth.
6. Approval is bound to user, action, tool version, args hash, preview hash,
   branch/run and expiry.
7. On resume the broker recomputes ownership/revisions; changed previews expire
   and require a new approval.

An approval is never a free-form “yes” fed back to the model. It resumes the
reserved server action directly.

`rejected` and `expired` are terminal action states, not aliases for `failed`.
Resolving an approval as rejected atomically moves its action from
`awaiting-approval` to `rejected`. A durable sweeper claims overdue pending
approvals with a lease, changes approval and action to `expired` in one
transaction and emits exactly one terminal event. Re-running the same action ID
or idempotency key returns that terminal result. Retrying after rejection or
expiry requires a new action ID, a new idempotency key and a newly computed
preview; the old approval can never be revived. The sweeper is restart-safe and
tests concurrent claimers.

No terminal action row is reopened. A retry after a proven pre-effect `failed`
state also reserves a new action/key after recomputing preview and revisions; an
exact replay of the old key returns the old failure. `inspect-required` is never
automatically retried: an operator/user resolution must first record whether the
effect happened and either complete the row or authorize a distinct repair
action.

### Execution

Before the canonical mutation, persist the before revisions/snapshots and set
`executing`. The operation and action completion should share one transaction
where the domain allows. For provider/external/file operations where that is not
possible:

- use an outbox/saga step;
- persist idempotency before the external call;
- record provider request IDs/digests after redaction;
- enter `inspect-required` when the process cannot know whether the external
  side effect happened;
- never auto-retry an ambiguous irreversible effect.

Publish the action state through plan 026 events. Completion includes changed
resource IDs/revisions and a bounded result summary.

### Compensation

Each `compensatorId` is reviewed code with:

- eligible source action/tool versions;
- preview builder;
- current-state preconditions;
- inverse domain operation;
- conflict and partial-failure semantics;
- its own risk/approval classification.

Before compensating, verify each current resource revision matches the source
action's `afterRevision` or an explicitly compatible state. If not, return a
conflict preview; do not overwrite later work.

The compensation is recorded as a new action referencing the original. The
original row stays terminal `completed`; it is never transitioned to
`compensating`, `compensated` or `compensation-failed`. The UI/API obtains those
facts only from the derived `undoState` and links to the compensating action. A
second undo may be legal only if reviewed compensator code says so; do not assume
an infinite toggle and never mutate or delete an earlier audit row.

For a selection, build the complete causal subgraph from persisted edges,
including eligible predecessors/dependants in other batches in the same approved
branch-or-domain scope. Prove it is acyclic, freeze the selected action IDs and
edge-version fences in the preview, then compensate in reverse topological
order. Persist each attempted inverse independently. If one inverse conflicts or
fails, do not describe the selection or any source batch as rolled back: retain
completed inverse actions, derive `partially-compensated` for the affected source
actions/batch DTOs, block any remaining predecessor whose uncompensated
downstream action still depends on it, continue independent graph components
when safe, and return a repair plan listing `compensated`, `conflicted`, `failed`,
`blocked` and `not-attempted` actions. A retry may target only unresolved source
actions after all resource revisions, ownership, scope membership, dependency
edges and the tenant dependency-fence version are recomputed.

## Tool-by-tool compensation policy

Create a reviewed matrix for every mutation exposed by plan 027. Initial policy:

| Action                                                                 | Compensation when safe                                                              | Required precondition                                              |
| ---------------------------------------------------------------------- | ----------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| create personal grade/task/event/project/document                      | trash created resource                                                              | unchanged except explicitly compatible derived fields              |
| update personal grade/task/event/project metadata                      | restore prior fields                                                                | current revision equals action's after revision                    |
| trash recoverable material/document                                    | restore                                                                             | object still in trash and original parent valid or fallback chosen |
| move/rename/reorder                                                    | restore prior location/value                                                        | current revision unchanged                                         |
| add/remove project reference                                           | inverse membership operation                                                        | project revision unchanged for that membership                     |
| attach a file                                                          | remove relationship, retain file per GC rules                                       | relationship still points to same file                             |
| detach provider grade                                                  | no automatic merge-back in v1                                                       | high-risk dedicated workflow required                              |
| dismiss provider grade                                                 | restore managed projection only if provider record/mapping/authority still eligible | current provider snapshot compatible                               |
| select grade authority / remap provider subject                        | dedicated reconciliation preview                                                    | connection/year/mappings unchanged                                 |
| start OCR/transcription/build                                          | cancel only while supported; generated result can be trashed                        | job state permits cancellation                                     |
| purge, revoke credentials, provider sync, arbitrary external MCP write | generally non-undoable                                                              | always confirmed and labelled honestly                             |

Do not expose the highest-risk provider/account/admin actions merely because the
ledger can record them.

## User modes

### Read-only

Only read tools. This remains available permanently and is the default for new
users and custom MCP sources.

### Confirm writes

All creates/updates/deletes/external effects interrupt for a concrete preview.
Read tools continue automatically.

### Auto-reversible

The broker may auto-run only tools whose descriptor is:

- `approval = policy`;
- risk low/medium;
- compensation `guaranteed` for the current preview;
- inside explicitly selected resource scopes;
- within configured count/cost limits.

High, irreversible, credential, provider-identity and external communication
actions always ask. The mode has a visible per-run indicator and can be reduced
mid-run immediately.

No global “YOLO” mode bypasses `approval = always`.

## Historical branch restoration UX

When the user edits/retries from an old message, offer distinct choices:

1. **Branch conversation only** — default; no data or workspace changes.
2. **Branch with workspace copy** — plan 031 restores/forks the compatible
   workspace snapshot, leaving current workspace intact.
3. **Review data changes since here** — show only brokered actions attributable
   to the abandoned branch after its `domainCursorRef`.

The review groups actions into:

- safe to compensate now;
- conflicted by later edits;
- already compensated;
- non-undoable/external;
- unrelated user/provider actions, which are never selected.

Compensating a group runs in reverse dependency order with a preview. Atomicity
is per domain transaction where possible; otherwise present partial progress and
repair choices. Never claim the whole account is at the old point unless every
selected compensation completed and unrelated changes were intentionally kept.

The conversation-only choice must not call `SandboxProvider`, create a workspace
row, copy a snapshot, enqueue a restore or advance a domain cursor. Workspace
copy is a separate explicit user action with its own destination branch,
snapshot preview and confirmation; absence/incompatibility of a snapshot never
silently changes the conversation-only choice. The integration gate for this UI
is the committed snapshot ledger and restore API from plan 031.

## UI

Action cards in the conversation show:

- the immutable execution status separately from derived `undoState` (eligible,
  pending/in-progress, compensated, partial, conflicted, failed or blocked);
- human title and affected resource links;
- redacted input and result summary;
- why approval is required;
- whether undo is available now;
- inspect, undo or resolve-conflict actions;
- timestamps and actor/source.

The approval dialog cannot be obscured inside streaming model text. It is a
first-party component with focus trapping, keyboard support and an expiry state.

Add an account-level activity page filtering by date, tool, thread, resource,
actor, status and undo eligibility. This is an audit/history view, not raw model
telemetry.

## MCP compatibility

Map MCP elicitation/confirmation to the same reservation and approval records.
Existing client/idempotency binding remains valid and gains tool version and
preview hash. An MCP client may inspect its actions and invoke an eligible undo
tool only with the same scoped authorization as an embedded assistant.

Custom MCP writes remain disabled by default. Enabling one requires a local
descriptor/risk classification and external-effect semantics. “The remote tool
says it is reversible” is not sufficient evidence.

## Tests

### State machine

- every legal/illegal action status transition;
- a completed source action stays `completed` before, during and after successful,
  failed and partial compensation; only its derived `undoState` changes;
- crash before mutation, during mutation and after mutation before completion;
- idempotent replay and changed-argument rejection;
- atomic approval rejection/expiry, restart-safe sweeper, concurrent sweeper
  claims, terminal replay and mandatory fresh-key retry;
- changed preview and cross-branch misuse;
- exactly one completed effect under concurrent retries.

### Compensation

- create/update/trash/move/reference cases above;
- conflict after a manual edit;
- conflict after provider refresh;
- reverse-order batch compensation;
- reverse-order compensation across two or more batches in one branch/domain,
  while an unrelated branch/domain remains untouched;
- stable topological ordering, cross-batch dependency acceptance, ownership and
  scope validation, and cross-tenant/cross-scope edge rejection;
- two concurrent workers attempting opposite cross-batch edges cannot commit a
  cycle, including when one edge is branch-scoped and the other domain-scoped;
  stale tenant-fence retries re-run reachability before insertion;
- partial external saga failure followed by a retry of unresolved actions only;
- a failed middle compensation leaves earlier inverses recorded, blocks unsafe
  dependants across batch boundaries, continues an independent component and
  reports derived partial state without a rollback claim;
- a partial multi-resource compensator exposes `partially-compensated`, the
  concrete compensation child actions and a deterministic repair set;
- action and compensation both remain in immutable history, and rebuilding the
  `undoState` projection from that history produces the same DTO.

### Domain integrity

- average recalculation after grade compensation;
- provider-owned grade facts cannot be changed;
- personal overlays survive sync and unrelated undo;
- file reference/GC counts remain correct;
- project/document revisions and citations remain valid;
- another user's resource/action cannot be previewed or changed.
- conversation-only branching creates no workspace/snapshot/action side effect;
- workspace-copy branching uses only a committed plan-031 snapshot and never
  mutates or deletes the source branch workspace.

### Security

- model cannot self-approve, forge preview hashes or select auto mode;
- action snapshots/logs/exports contain no credentials or signed URLs;
- prompt-injected text cannot change risk;
- custom MCP writes fail closed;
- admin/account destructive tools remain outside ordinary assistant grants.

### Commands

```powershell
bun run --cwd apps/server test src/actions
bun run --cwd apps/server test src/tools
bun run --cwd apps/server test src/mcp
bun run --cwd apps/web test src/components/assistant/actions
bun run db:migrate
bun run format:check
bun run lint
bun run check-types
bun run test
bun run build
```

## Rollout

1. ledger shadow mode records previews for deterministic test/user UI actions
   but exposes no agent writes;
2. enable one guaranteed-compensation tool (create personal task) for internal
   users in confirm mode;
3. add personal document/project and grade-overlay operations one by one;
4. enable auto-reversible only after compensation success/conflict telemetry is
   understood;
5. validate the school-specific flagship flow end to end: attach a photo/PDF of
   a copy, run owned OCR/extraction, propose subject/period/value/scale and file
   linkage, require a concrete preview, create the personal grade through the
   canonical command, then compensate it without deleting the copy;
6. provider mapping/authority actions remain a later explicit allowlist.

## Done criteria

- Every enabled mutation is brokered, revision-fenced and ledgered.
- Approval binds exact actor/tool/input/preview/branch and survives restart.
- Eligible actions compensate through canonical domain operations.
- Later manual/provider changes produce conflicts instead of lost work.
- Historical branch UI separates conversation, workspace and data choices.
- Batch compensation uses persisted acyclic dependency edges and exposes partial
  outcomes honestly.
- Causal edges may cross batches only inside the same owned branch/domain scope;
  concurrent inserts cannot commit a cycle.
- Original and compensating actions have independent immutable lifecycles;
  derived `undoState` is rebuildable and never rewrites source history.
- Rejected/expired actions remain terminal across restart and require a new
  reservation to retry.
- MCP and embedded paths use the same ledger.
- Read-only mode remains fully usable.
- No enabled tool claims undo when only audit/cancellation exists.

## STOP conditions

- A domain mutation lacks a current-state revision/precondition.
- A crash window can duplicate an effect silently.
- Undo requires broad SQL/table rollback.
- The model can influence risk, approval or compensation eligibility.
- A provider/external action's completion is ambiguous and would be retried.
- Action persistence would store a secret or unbounded private body.
- Batch restoration would touch unrelated manual/provider changes.
- Undo would mutate the original action lifecycle, or causal-edge insertion
  cannot serialize cycle detection within its owned branch/domain scope.

## Retention and maintenance

Action metadata follows a documented retention policy compatible with account
export/deletion. Purging a user's account deletes their ledger after required
operational/legal retention; it never leaves reconstructable private snapshots.
Every new tool descriptor must add compensation-matrix and crash-window tests
before receiving a mutation grant.
