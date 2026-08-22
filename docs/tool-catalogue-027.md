# Tool catalogue, policy broker and safe file transport

This document records the plan 027 implementation boundary. The canonical
business operation remains an authenticated oRPC procedure. MCP and embedded
agents receive projections produced by the same deterministic broker; neither
adapter owns a second mutation implementation.

## Shipped boundary

`@avermate/agent-contracts` defines versioned descriptors, effects, risks,
approval requirements, budgets, structured errors, trusted execution context,
federated-source contracts and opaque file-handle projections. Descriptors are
code-reviewed code, never database-editable prompt text.

`ToolBroker` executes this fail-closed pipeline:

1. resolve an exact `(toolId, version)`;
2. reject model/client authority fields and enforce input bytes/depth/items;
3. validate input and required scopes from a server-minted context;
4. recompute risk and approval from the descriptor;
5. bind approval and idempotency to user, client, version, arguments and branch;
6. emit a redacted preview and prepare the action-ledger boundary;
7. call the authenticated canonical adapter;
8. validate and bound its in-process result;
9. derive and independently validate model, owner-UI and audit projections;
10. reject credentials, signed URLs and storage keys in every projection;
11. persist only bounded UI/audit projections and publish ordered events;
12. complete the replay fence, or leave a mutation inspect-required.

The model never supplies `userId`, grants, scopes, role, risk, approval mode,
execution placement, provider credentials or egress policy. A copied or
retrieved instruction cannot mutate these server-created values.

## Reviewed descriptor catalogue

Plan 027 closes with **62 version-1 descriptors**: 56 bounded reads and six
ledgered mutations. `BROKERED_MCP_READ_TOOL_IDS` and
`BROKERED_MCP_MUTATION_TOOL_IDS` are the review manifests; a test requires them
to match `firstPartyToolDescriptors()` exactly.

| Scope                  | Reviewed read descriptors                                                                                                                                                                                                                                                                                                                                                                                              |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Account and academic   | `account.get`, `years.list`, `years.get`, `years.contents`, `periods.list`, `subjects.list`, `subjects.get`, `subjects.delete_impact`, `grades.get`, `grades.attachments`, `grades.recent`, `averages.list`, `averages.get`, `goals.list`, `cards.list`, `preferences.get`, `announcements.active`, `announcements.history`, `analytics.snapshot`, `recap.status`, `recap.eligible_years`, `feedback.mine`, `jobs.get` |
| Actions                | `actions.get`, `actions.list`, `actions.undo_preview`                                                                                                                                                                                                                                                                                                                                                                  |
| Projects and retrieval | `projects.list`, `projects.get`, `search.query`, `search.read_citation`, `search.index_status`                                                                                                                                                                                                                                                                                                                         |
| Conversation           | `conversation.search`                                                                                                                                                                                                                                                                                                                                                                                                  |
| Planner                | `planner.list`, `planner.agenda`                                                                                                                                                                                                                                                                                                                                                                                       |
| Materials and studio   | `materials.folders.list`, `materials.documents.list`, `materials.documents.get`, `materials.documents.transcript`, `recordings.list`, `recordings.transcript`, `source.ingestion_status`, `artifact.list`, `artifact.get_manifest`, `artifact.workflow`, `sync.status`                                                                                                                                                 |
| Study documents        | `documents.list`, `documents.get`                                                                                                                                                                                                                                                                                                                                                                                      |
| Social                 | `social.sharing`, `social.friends`, `social.friend`, `social.friend_requests`, `social.blocks`, `social.groups`, `social.group`, `social.notifications`, `social.reports`                                                                                                                                                                                                                                              |

The ledgered domain mutation descriptors are `planning.tasks.create`,
`artifact.plan`, `artifact.cancel`, `artifact.retry_stage`, `artifact.promote`
and `artifact.set_state`. Approval resolution and undo execution are separate
ledger controls, not domain descriptors.

The public names and deterministic surface order remain discoverable. Direct
broker, MCP and embedded adapters produce the same structured model envelope.
The central MCP guard requires an exact server-only `tool-broker.v1` marker for
every reviewed name; setting MCP's advisory `readOnlyHint` is never sufficient.

Output narrowing happens before projection:

- the academic snapshot contains at most 500 recent grade summaries and omits
  notes/components;
- study-document and recording transcript bodies are capped at 64,000
  characters and report truncation;
- recording audio segments are not returned by the transcript tool;
- grade-copy signed URLs are removed and replaced with opaque, owner- and
  audience-bound file handles;
- list/result budgets still reject excessive byte, depth or item counts.

## Mutation migration window

Plan 030 first enabled `planning.tasks.create@1`; plan 033 then added five
artifact-workflow mutations through the same broker and durable ledger. Every
enabled mutation requires an exact idempotency key and preview-bound approval.
The task create records revision fences and has a guarded compensation;
artifact workflow mutations honestly declare inspect-required crash recovery
and no compensation. Approval resolution and undo execution are action-ledger
controls; they are not independent academic mutations.

Legacy mutation names remain in MCP discovery so existing clients can identify
the migration boundary. Their central callback guard returns the structured,
non-retryable code `LEGACY_MUTATION_DISABLED`; it never reaches the old domain
callback. Only descriptor-backed reads remain agent-executable; a new
`readOnlyHint` without a descriptor and broker marker also fails closed. A
legacy mutation can leave this state only
after it has a reviewed registry descriptor, durable ledger writer, preview,
crash semantics, resource revisions and an honest compensation policy. The
machine-readable allowlist is `MCP_EXECUTABLE_NON_READ_TOOLS` and its invariant
test proves that every enabled domain entry resolves to a mutation descriptor.

## Generated review inventory

The source-derived audit fingerprints every effective MCP tool (including the
social read names registered through its helper) and every directly declared
oRPC procedure. The completed fingerprint is **142 MCP registrations** and
**385 directly declared oRPC procedures**. Counts are frozen: adding or
removing a name requires an explicit review and test update.

Run the exhaustive, deterministic name-by-name report with:

```powershell
bun run --cwd apps/server src/tools/catalogue-audit.ts
```

`catalogue-audit.test.ts` freezes the exact inventory, uniqueness,
classification, broker wiring, execution boundary and deterministic rendering.

| Execution class      | Count | Meaning                                                         |
| -------------------- | ----: | --------------------------------------------------------------- |
| `tool-broker`        |    62 | Exact descriptor, scope/risk/budget/projection path             |
| `ledger-control`     |     2 | Approval resolution and guarded undo execution                  |
| `legacy-disabled`    |    59 | Compatibility discovery only; callback replaced fail-closed     |
| `human-admin-direct` |    17 | Explicit admin/moderation surface, excluded from agent registry |
| `discovery-only`     |     2 | Unsafe result contract; returns `AGENT_TOOL_NOT_AVAILABLE`      |

The 59 legacy-disabled names are:

`account.reset_data`, `announcements.dismiss`, `averages.create`,
`averages.delete`, `averages.reorder`, `averages.update`, `cards.create`,
`cards.delete`, `cards.reorder`, `cards.reset`, `cards.update`,
`documents.create`, `documents.delete`, `documents.exportPptx`,
`documents.update`, `feedback.submit`, `goals.create`, `goals.delete`,
`goals.mark_achieved`, `goals.reorder`, `goals.update`, `grades.create`,
`grades.delete`, `grades.reassign`, `grades.update`,
`materials.documents.delete`, `materials.documents.move`,
`materials.documents.rename`, `materials.documents.transcribe`,
`materials.folders.create`, `materials.folders.delete`, `periods.create`,
`periods.delete`, `periods.reorder`, `periods.update`,
`preferences.mark_celebration_seen`, `preferences.update`,
`recap.mark_seen`, `social.blocks.create`, `social.friends.remove`,
`social.friends.respond`, `social.friends.send`, `social.groups.create`,
`social.groups.delete`, `social.groups.join`, `social.groups.leave`,
`social.groups.set_sharing`, `social.reports.create`,
`social.sharing.update`, `subjects.create`, `subjects.delete`,
`subjects.move`, `subjects.update`, `sync.trigger`, `years.archive`,
`years.create`, `years.delete`, `years.reorder` and `years.update`.

The 17 human/admin-only names are `admin.announcements`,
`admin.announcements.create`, `admin.announcements.delete`,
`admin.announcements.update`, `admin.feedback`, `admin.feedback.set_status`,
`admin.overview`, `admin.presets`, `admin.user`, `admin.users`,
`admin.users.delete`, `admin.users.set_role`, `admin.users.set_suspension`,
`social.moderation.overview`, `social.moderation.reports`,
`social.moderation.set_group_state` and
`social.moderation.update_report`.

The two discovery-only names are `account.export` (unbounded whole-account
export) and `documents.downloadPptx` (signed-URL result). Every service-key oRPC
procedure remains `never-expose-to-agent`. File/download-like rows stay marked
`opaque-handle-required` before any future migration.

This classification is conservative. “Safe after output narrowing” is not an
authorization to expose a procedure; it means a reviewed descriptor still has
to define scopes, budgets and all three projections. “Needs preview” means it
must not be migrated until its revision, retry, compensation and approval story
is explicit.

## Idempotency and approval

The broker has an in-memory conformance store and a durable compatibility store
backed by `mcp_operations`. New durable keys include descriptor version and
branch in the logical tool name; legacy MCP rows remain readable and are never
reinterpreted. A completed replay returns stored projections and never repeats
the side effect. Changed arguments conflict. A pending/ambiguous mutation is
inspect-required and is not retried blindly.

Existing destructive public MCP schemas remain discoverable, but their legacy
callbacks no longer execute. The two ledger controls retain their established
multi-round request-state wire protocol; reviewed mutations enter the same
durable action ledger through `ToolBroker`. A later surface-by-surface migration
can add descriptors without changing public names or weakening the fence.

## Federated MCP containment

`FederatedToolSourceBroker` separates source request construction from the
broker-owned byte transport. A source keeps its own credential; neither the
catalogue nor an event receives it. External IDs become
`external.<source>.<remote-id>`, and a user-configured or node source has a local
minimum risk of `high` even if it advertises `low`.

The reviewed capability snapshot is a stable SHA-256 digest. Any tool-list
change invalidates it before invocation. The streaming transport rejects:

- declared bodies over budget before the iterator is opened;
- absent, false or mismatched lengths;
- actual byte overflow and slow/infinite streams;
- excessive structural depth or item counts before `JSON.parse`;
- malformed input, trailing JSON and duplicate security-sensitive keys;
- non-JSON content and non-byte chunks.

Only after the byte, deadline and structural checks finish does the broker
materialize and schema-validate JSON. External content remains untrusted tool
data and cannot alter grants, placement, approval or egress policy.

## Opaque file exchange

`FileHandleService` encrypts a short-lived AES-GCM capability bound to owner,
audience (`preview` or `download`), expiry and a random nonce. The token exposes
no file ID, bucket, key or path. Handles live for at most 15 minutes.

`POST /api/file-handles/exchange` authenticates the user, checks the expected
audience, re-resolves current file ownership/status, applies byte and rate
limits, and then either streams a local object or places a five-minute S3 URL
only in the immediate HTTP redirect. Responses are private/no-store with
referrer and MIME-sniffing protection. There is no database write, event,
analytics field or tool projection containing a signed URL. Deletion,
ownership change, expiry, audience mismatch and token tampering all fail as a
generic not-found response.

`materials.documents.get` now emits owner-bound preview/download handles while
retaining its public MCP name. Clients exchange the chosen handle explicitly;
they never receive a storage credential or reusable provider URL.

## Verification and honest remaining gates

Targeted gates:

```powershell
bun run --cwd packages/agent-contracts test
bun run --cwd apps/server test src/tools src/mcp src/routes/file-handles.test.ts
bun run --cwd apps/server check-types
```

The adversarial suite covers authority-field injection, missing scopes,
approval, cancellation, replay, changed arguments, projection leakage,
cross-user handles, expiry/tampering/revocation, federated risk floors, snapshot
changes, false lengths, JSON bombs and infinite streams.

Completion run on 2026-08-22:

- `packages/agent-contracts`: 47 passed;
- broker/catalogue/MCP guard/file-handle targeted suite: 36 passed;
- full MCP protocol/OAuth/destructive-flow harness: passed;
- server TypeScript check: passed;
- scoped Oxlint: no errors; scoped `git diff --check`: clean.

The tools outside the reviewed descriptor set are not silently considered
migrated. The generated report remains the source of truth for mutations that
still need a preview/compensation/revision decision, human/admin-only tools and
forbidden tools. This is the safety-preserving migration boundary: expanding it
is a descriptor-by-descriptor review, not a mass router export.
