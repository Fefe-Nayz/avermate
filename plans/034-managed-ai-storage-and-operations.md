# Plan 034: Optional managed AI/storage plane and production operations

> **Executor instructions**: Read plans 025–032 and implement accounting in
> shadow mode before integrating checkout. Treat every phase and launch gate as
> mandatory for the capability it enables; update the 034 row in
> `plans/README.md` only after the complete definition of done, not after billing
> UI alone. Do not contact customers, deploy, charge, push or open a PR unless
> explicitly authorized.
>
> **Drift check (run first)**: run `git diff --stat <plan-025-baseline>..HEAD --
apps/server/src/entitlements apps/server/src/usage apps/server/src/agent
apps/server/src/lib/storage.ts apps/server/src/db/schema apps/server/src/routers
apps/web/src/app apps/web/src/components/admin infra deploy.yml docs`. Reconcile
> any changed placement, secret, storage or retention contract; stop if a metered
> path can bypass reservations or tenant isolation cannot be proven.

> [!IMPORTANT]
> Add a paid convenience tier without making it the architecture or gating the
> free academic core. The managed service must implement the same capability,
> placement, job, storage, model and sandbox contracts used by BYOK and Avermate
> Node. Build entitlements, metering, isolation and deletion before billing or
> enabling costly workloads.

## Status

- **Status**: TODO
- **Priority**: P2 (P1 before advertising paid AI/storage)
- **Effort**: XL (multi-release and operational)
- **Risk**: CRITICAL
- **Depends on**: 025–032; media entitlements consume 033 when shipped
- **Blocks**: a commercially operated hosted inference/storage tier
- **Category**: multi-tenancy, entitlements, usage, billing, observability, SRE
- **Planned at**: 2026-08-22
- **Planning baseline**: plan 025 baseline SHA

## Scope

**In scope**: provider-neutral entitlements, reservations/usage/pricing
snapshots, managed adapters, BYOK secret operations, tenant isolation,
retention/export/deletion, OTel/audit, abuse/cost controls, billing boundary,
operator tooling, backups/runbooks and staged launch gates.

**Out of scope**: charging or deploying during plan execution without separate
authorization, making managed services mandatory, selecting prices from code,
building a second cloud-only domain implementation and weakening self-host/BYOK
paths.

## Product contract

The following remain usable without a paid managed plan:

- accounts, school years, subjects, grades, averages and planning features on
  avermate.fr under the published free-service policy;
- local-development and full-self-host deployments;
- external MCP access within the user's configured scopes;
- school/Moodle synchronization that does not require managed storage or paid
  inference, subject to the connector/privacy policy;
- BYOK and custom-node placement where the capability can be fulfilled without
  Avermate-paid resources;
- export and deletion of all user-owned data.

The optional managed tier pays for measurable conveniences such as object
storage, OCR/transcription, model tokens, embeddings, TTS, sandbox compute and
media rendering. Entitlement affects creation/execution, never the ability to
read or export an already-owned artifact during a reasonable grace period.

No route may infer “paid” from the presence of a billing-customer ID. The
versioned entitlement service is the only authority.

## Deployment principle: the operator is another node placement

Use plan 032's `ExecutionRouter` and capability contracts for Avermate-operated
workers/storage. Internally the managed plane can have regional pools and richer
scheduling, but domain code sees a placement like:

```ts
type CapabilityPlacement =
  | { kind: "core" }
  | { kind: "direct-byok"; provider: string }
  | { kind: "user-node"; nodeId: string }
  | { kind: "managed"; pool: string; region: string };
```

Do not fork OCR, chat, retrieval or artifact pipelines into “cloud” and
“self-host” implementations. Contract/conformance tests must run against local,
node and managed adapters. A full-self-host operator can omit every billing and
managed-worker component.

## Modes, ownership and fallback

For every costly capability, settings show its selected placement:

- unavailable/disabled;
- direct provider with the user's encrypted key (BYOK);
- user's Avermate Node/local model;
- managed allowance/subscription;
- an explicitly ordered fallback chain.

Rules:

1. Never silently move from BYOK/node to managed spend or from managed storage
   to an operator bucket not covered by the user's residency choice.
2. A fallback is saved per capability, previewed with privacy/cost implications
   and recorded on each run.
3. Placement is persisted on files, projects, corpus indexes, conversations,
   sandboxes and artifacts. Current availability does not rewrite ownership.
4. Moving data between placements is an explicit, resumable, verified migration
   from plan 032, not a retry side effect.
5. Provider API keys are never sent to the browser, model prompt, sandbox or
   telemetry. A run receives a narrowly scoped provider proxy/grant where
   feasible.

## Entitlement model

Create a provider-neutral entitlement domain under
`apps/server/src/entitlements/`. Billing providers only translate external
events into this domain.

```ts
interface EntitlementSnapshotV1 {
  accountId: string;
  revision: string;
  plan: string;
  status: "active" | "grace" | "restricted" | "cancelled";
  period: { startsAt: string; endsAt: string };
  capabilities: Record<
    string,
    {
      enabled: boolean;
      hardLimit?: number;
      softLimit?: number;
      unit?: UsageUnit;
      concurrency?: number;
      retentionDays?: number;
    }
  >;
  source: "free" | "operator" | "billing-provider" | "self-host";
}
```

Capabilities are fine grained: `storage.bytes`, `ocr.pages`,
`transcription.seconds`, `model.inputTokens`, `model.outputTokens`,
`model.cachedInputTokens`, `embedding.units`, `tts.characters`,
`sandbox.cpuMillis`, `sandbox.memoryByteSeconds`, `sandbox.egressBytes`,
`video.outputSeconds`, and concurrency classes.

- Keep product names/prices out of authorization code.
- Version snapshots and decisions so a historical charge/run can be explained.
- Cache briefly with an explicit stale policy; destructive restriction or abuse
  revocation must propagate quickly.
- Self-host defaults to an operator-controlled unlimited/local policy and does
  not require the Avermate billing service.
- Admin grants/trials are auditable, expire automatically and cannot mutate raw
  usage rows.

## Usage ledger and reservations

### Immutable usage events

Add an append-only ledger conceptually equivalent to:

```ts
interface UsageEventV1 {
  id: string;
  accountId: string;
  userId?: string;
  capability: string;
  quantity: string;
  unit: UsageUnit;
  direction: "reserve" | "consume" | "release" | "adjust";
  idempotencyKey: string;
  runId?: string;
  jobId?: string;
  provider?: string;
  model?: string;
  placement: string;
  pricingSnapshotId?: string;
  occurredAt: string;
}
```

- Quantities use integer smallest units or exact decimal strings, never binary
  floating point.
- One idempotency key cannot be applied twice, even after worker retry or
  at-least-once node delivery.
- Provider-reported usage is authoritative when available; otherwise use a
  documented estimator and reconcile later.
- Failed/cancelled jobs record actual consumption and release only unused
  reservation. They are not assumed free.
- Cached input tokens are tracked separately. The UI must not label an estimate
  as provider-billed truth.
- Usage adjustments are append-only compensations with actor/reason/evidence;
  never edit history.

### Reservation flow

Before dispatching a costly run:

1. estimate a conservative maximum from input and configured limits;
2. resolve entitlement and current aggregate atomically;
3. create a bounded reservation with expiry and idempotency key;
4. include reservation/grant references in the routed job;
5. stream usage observations without trusting them for authorization;
6. finalize actual consumption and release remainder;
7. reconcile expired/abandoned reservations in a maintenance job.

For storage, reserve before upload, measure verified committed bytes and update
on replacement/deletion after the object ledger commits. Deduplication must not
leak cross-user existence and its billing policy must be explicit.

### Pricing snapshots and display

- Store operator/provider rate-card snapshots separately from usage. Historical
  displayed cost uses the snapshot active for that run.
- Distinguish provider cost, operator estimate, user charge and included quota.
- Do not promise exact cost where a provider supplies no final usage/cost.
- Show per-run tokens, cached tokens, estimated/final cost, placement and quota
  impact. Aggregate by period/capability without exposing prompt content.
- Provide warning thresholds, hard caps and a user-level emergency “disable all
  paid execution” control that cancels queued reservations.

## Model gateway and provider-key operations

Build on plan 026's `ModelGateway`:

- direct adapters through the AI SDK/OpenAI-compatible APIs for core supported
  providers;
- an optional LiteLLM-compatible adapter for managed routing, virtual keys,
  provider fallback and budgets when its operational value exceeds the extra
  service; domain code must not depend on LiteLLM-specific response shapes;
- per-model capability registry (modalities, context, tool/structured-output
  support, region, retention policy and pricing snapshot);
- normalized usage and error categories while retaining a bounded encrypted/raw
  provider reference for support where policy allows;
- configurable provider data-retention/zero-retention flags surfaced honestly;
- managed school content uses only a provider tier/contract whose current data
  use is compatible with the published privacy policy; a free tier that may use
  prompts/files for product improvement is disabled by default unless the user
  makes a separate, informed opt-in;
- circuit breakers, concurrency pools, deadlines and retry rules that never
  duplicate a non-idempotent generation invisibly.

BYOK secret lifecycle:

- keep the existing sealed per-user service-key pattern, extend it with provider,
  key version, last validation, scopes/capabilities and revocation state;
- validate using a minimal provider operation and never echo the secret;
- redact known secret patterns at ingress/log/export boundaries;
- rotate encryption material with key-versioned envelopes;
- delete/revoke on user request and document what remains in provider logs;
- prefer ephemeral proxy credentials for workers. If a provider requires the
  raw key, inject it only into that process, never its workspace or event stream.

## Multi-tenant storage

Managed plan-032 `ObjectStorageProvider` must provide:

- opaque per-account/user/project object keys; no user-derived path authority;
- bucket/prefix IAM that prevents a worker from listing unrelated objects;
- server-side encryption and an explicit decision on per-tenant envelope keys;
- short-lived single-object/range/multipart grants bound to MIME/size/digest;
- object versioning or a reviewed recovery window for accidental deletion;
- malware/content-type/decompression checks appropriate to uploaded material;
- lifecycle policies for unowned uploads, scratch, trash, revisions and account
  deletion;
- reconciliation between DB ledger and object inventory without broad public
  listings;
- tested backup/restore, including metadata-to-object consistency and regional
  recovery objectives.

Garage remains a supported self-host S3-compatible option, not an assumption
that every S3 implementation supports every AWS feature. Maintain a storage
conformance suite for the exact subset Avermate uses (range, multipart,
conditional write if required, CORS, checksum behavior and presigning). Run it
against local filesystem, Garage and the managed object store.

Storage quota UX distinguishes committed, trash/recoverable, pending upload,
generated scratch and reserved bytes. Garbage collection cannot delete bytes
still referenced by a conversation branch, artifact revision, action-ledger
undo window or source citation.

Plan 032 owns the interface, the adapter over the current function-based
`storage.ts`/`storage-backend.ts` implementation and the base conformance suite.
This plan adds the managed implementation and multi-tenant adversarial cases; it
must not introduce a competing storage abstraction.

## Multi-tenant sandbox plane

Managed arbitrary/untrusted execution requires stronger isolation than the
local-development `runc` profile:

- use plan 031's provider contract with a managed E2B adapter or an OpenSandbox
  pool configured with Kata/microVM-class isolation; select only after measured
  conformance, operational cost and regional availability;
- tenant/workspace-specific identity, no host Docker socket, no shared writable
  layers, no privileged containers and no ambient core credentials;
- default-deny egress with profile allowlists/proxy grants, DNS/IP validation,
  byte limits and auditable destinations;
- strict CPU, memory, process, file, disk, network, wall-time and output limits;
- image allowlist by digest, SBOM, vulnerability policy, signature/provenance and
  emergency image revocation;
- terminate full process/runtime descendants on cancel/deadline;
- encrypt snapshots/workspaces, bind them to conversation/project placement and
  enforce retention/deletion;
- separate trusted deterministic render profiles from untrusted-code profiles;
- no cross-tenant warm workspace reuse. Shared read-only image/cache layers need
  an explicit side-channel review.

Do not call a container a “VM” in product copy. Display observed isolation from
the capability manifest. Hosted untrusted code stays disabled if only the
development isolation profile is available.

## Conversation and privacy operations

Plan 029 conversations can be stored at managed placement only after:

- message/content/event/context-manifest encryption and access controls;
- thread/project/source ownership joins on every read/export/delete;
- explicit retention for deleted messages, branches, provider request records,
  sandbox snapshots and action undo history;
- full JSON and Markdown export with attachments/artifact manifests and exact
  branch relationships;
- account/project/thread deletion jobs that are resumable, auditable and end in
  a tombstone/reconciliation result;
- support tooling that sees metadata by default and requires audited elevation
  for content;
- privacy copy explaining what goes to each selected model/provider/node.

“Delete now” and “recoverable trash” must be separate operations. Legal/security
retention exceptions, if applicable, are documented and visible rather than
hidden in implementation.

Deletion is an explicit placement-aware state machine, not a single success
boolean:

```ts
type PlacementDeletionState =
  | "requested"
  | "core_tombstoned"
  | "pending_remote_deletion"
  | "verified_deleted"
  | "revoked_unreachable"
  | "user_action_required"
  | "failed";
```

- The core revokes grants and writes its tombstone immediately, but never calls
  an offline user-owned node physically erased.
- A managed placement is complete only after DB/object/index/snapshot
  reconciliation and an operator-verifiable receipt.
- A user node receives the pending deletion at reconnect and returns a signed,
  nonce-bound receipt containing request ID, node ID, deleted object classes,
  completion time and manifest digest. Verify and persist the receipt before
  transitioning to `verified_deleted`. The receipt records whether verification
  came from a managed adapter, user node or another external placement.
- A revoked or permanently unreachable node settles as
  `revoked_unreachable`/`user_action_required`, with honest UI/export wording
  that remote residue could not be verified. Retry and support workflows never
  erase this distinction.

## Observability and audit

Use OpenTelemetry-compatible traces, metrics and logs as the vendor-neutral
base. Propagate correlation IDs across:

`HTTP/tool request → policy decision → agent run → workflow/job → node/sandbox →
provider call → artifact/object commit → usage event`.

Requirements:

- low-cardinality metrics for queue depth/age, lease loss, worker saturation,
  provider latency/error/rate limit, sandbox startup/termination, storage
  consistency, event-stream lag, reservation drift and deletion backlog;
- structured logs with automatic redaction and no prompts, document bodies,
  URLs, credentials, signed grants or raw provider payloads by default;
- trace sampling that never changes authorization/accounting correctness;
- immutable security/admin audit events for secret access, grants, entitlement
  changes, support elevation, pairing/revocation and destructive deletion;
- per-run user-visible activity from the normalized domain event log, not raw
  internal telemetry;
- configurable self-host exporters, including “none”; the self-hosted product
  must not send telemetry to Avermate unless explicitly enabled.

Langfuse or another LLM-observability product may be an optional exporter for
prompt/version/evaluation workflows. It is not the primary conversation store,
usage authority or audit ledger. Enabling content capture requires an explicit
operator/user policy and redaction review.

## Abuse, moderation and cost containment

Before public managed uploads/inference:

- rate-limit by account, user, IP/risk signal, capability and concurrent work;
- cap new/free accounts far below paid verified limits without blocking the
  academic core;
- validate upload type/size and quarantine suspicious content; define a human
  appeal/support path for false positives;
- prevent open-proxy behavior in Web rendering, provider proxying and node
  relay; grants bind destinations/capabilities/bytes;
- maintain provider and global spend circuit breakers, per-user caps and
  anomaly alerts;
- bound prompt/tool loops, tool-call count, retries and branch concurrency;
- require additional policy review for public URL download, TTS voice cloning,
  generated imagery/video and untrusted code;
- document acceptable use and copyright/privacy responsibilities before
  enabling the relevant managed capability;
- build an emergency capability kill switch that preserves read/export access.

Moderation decisions must not become an undocumented black box for a school
product. Persist stable reason codes, policy version and appeal state without
copying sensitive source content unnecessarily.

## Billing-provider boundary

Choose Stripe, Lemon Squeezy or another provider only after the internal
entitlement/usage contracts pass tests. Put it behind:

```ts
interface BillingAdapter {
  createCheckout(input: CheckoutRequest): Promise<CheckoutReference>;
  createPortal(input: PortalRequest): Promise<PortalReference>;
  verifyWebhook(raw: Uint8Array, headers: Headers): Promise<BillingEvent>;
  getSubscription(reference: string): Promise<ExternalSubscription>;
}
```

- Verify raw-body webhook signatures, store external event IDs idempotently and
  process them asynchronously.
- Map billing states to entitlement snapshots in one module with fixtures for
  trial, active, past-due, grace, cancellation, refund and dispute.
- A transient billing outage does not immediately delete data or interrupt an
  active academic workflow; use a documented grace policy.
- Customer portal/checkout redirects are allowlisted and CSRF/state protected.
- Never store payment details in Avermate.
- Invoices/tax/consumer-law requirements and legal entity readiness are launch
  gates, not code comments.

## Operator/admin surfaces

Add restricted, audited operational views for:

- capability pool health, queue age and saturation;
- account entitlement and aggregate usage, with privacy-minimized metadata;
- stuck reservations/jobs and safe replay/reconciliation actions;
- provider/model availability, rate limits and circuit breakers;
- storage ledger mismatch/orphan cleanup;
- node/pool/image versions and revoked manifests;
- deletion/export status;
- abuse flags/appeals and billing webhook health.

Admin mutations use typed commands, justification, idempotency and audit events;
no generic SQL, shell, arbitrary job payload or provider-request interface.
Support impersonation is excluded unless separately designed and audited.

## Reliability, backup and incident readiness

Define target SLOs per surface rather than one uptime number:

- academic core read/write;
- auth and MCP authorization;
- object upload/download;
- conversation event replay;
- queue dispatch/progress;
- model/sandbox best-effort availability.

Use these initial measurable objectives for the limited beta; a later ADR may
tighten them but cannot silently weaken them:

| Surface                                  | Initial objective, measured over 30 rolling days                                                                   |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| Academic core and auth/MCP authorization | 99.9% successful eligible requests; p95 read <= 500 ms and write <= 800 ms, excluding declared third-party outages |
| Managed object upload/download           | 99.9% successful eligible operations; p95 time-to-first-byte <= 1 s for objects <= 10 MiB in-region                |
| Conversation replay/event delivery       | 99.5% successful replay; p95 committed-event-to-client lag <= 2 s and p99 <= 10 s                                  |
| Durable job dispatch                     | p95 queued-to-lease <= 30 s and p99 <= 120 s at reference load; terminal reconciliation <= 15 min p99              |
| Managed model/sandbox calls              | best effort per-provider, but 100% receive a bounded deadline, terminal reason and correct reservation settlement  |

Recovery targets for the first paid beta are: transactional DB and usage ledger
RPO <= 5 minutes/RTO <= 4 hours; committed managed objects and workspace
snapshots RPO <= 1 hour/RTO <= 24 hours; secrets/signing material RPO 0 for
accepted rotations and RTO <= 4 hours from the encrypted escrow procedure.
Restore drills measure from an empty recovery environment and fail if metadata,
object digests, citation edges or usage totals diverge.

Shadow-accounting exit criteria are numeric: simulate one 30-day billing period
with at least 100 tenants, 10,000 mixed runs, 1,000 concurrent reservations and
duplicate/out-of-order callbacks; require zero double charges/grants, 100% of
terminal reservations settled within 24 hours, at least 99.9% within 15 minutes,
and aggregate provider-authoritative unit drift <= 0.5%. Any unexplained
cross-tenant, negative-balance or non-idempotent event is a release blocker
regardless of the aggregate tolerance.

At minimum implement:

- health/readiness checks that validate dependencies without performing costly
  model calls on every probe;
- bounded retries with jitter and provider-specific retryability;
- dead-letter/terminal inspection and safe idempotent replay;
- DB backup plus point-in-time/recovery procedure appropriate to deployment;
- object version/backup and ledger reconciliation;
- encryption/signing key backup/rotation/revocation procedures;
- restore drills to a clean environment with measured RPO/RTO;
- incident runbooks for credential leak, cross-tenant exposure, runaway spend,
  provider outage, corrupted artifact, stuck deletion and compromised image;
- a public service-status/incident communication path before paid launch.

## Data model and migration outline

Use additive, versioned tables/modules for:

- accounts/billing subjects if a user is not the billing boundary;
- entitlement snapshots and grants;
- immutable usage events, reservations and period aggregates;
- pricing/rate-card snapshots;
- billing customers/subscriptions and idempotent webhook inbox;
- placement migrations and managed worker pools;
- security/admin audit events and support elevation;
- deletion/export requests and reconciliation results.

Keep high-volume observability outside the transactional application DB. Usage
events required for entitlement/billing correctness remain durably transactional
or use a reviewed outbox. Never authorize from a delayed analytics warehouse.

## Delivery sequence and gates

### Phase 0 — commercial/open-source prerequisites

1. Complete plan 025, choose/publish the repository license and define which
   managed-service configuration/deployment assets are included.
2. Publish privacy, data-processing, retention and acceptable-use decisions.
3. Confirm that free core, MCP, BYOK, node and full-self-host paths remain real
   product paths in tests and docs.

### Phase 1 — accounting without money

1. Implement capability IDs, entitlement snapshots and local/self-host policy.
2. Implement usage events/reservations for existing OCR, transcription, model,
   storage and job paths.
3. Build user usage/cap controls and admin reconciliation.
4. Run in shadow mode: decisions do not block, but compare estimates/final usage
   and repair every idempotency/drift bug.

### Phase 2 — managed adapters and isolation

1. Deploy managed object storage through the existing adapter/conformance suite.
2. Deploy model gateway/provider proxy with BYOK and operator-key separation.
3. Deploy trusted renderer pools, then untrusted-code pools only after isolation
   conformance.
4. Add OTel, alerts, deletion/export and backup/restore drills.
5. Internal alpha with hard global/per-account spend caps.

### Phase 3 — limited managed beta

1. Freeze initial entitlements/rate cards and user-visible cost language.
2. Add billing adapter and webhook inbox; grant beta entitlements independently
   of billing first.
3. Test grace/cancel/refund/dispute and provider outages end to end.
4. Invite a bounded cohort; review unit economics, abuse and support burden.

### Phase 4 — paid launch

Only after launch gates below pass. Expand capabilities separately; do not couple
storage, chat, OCR, sandbox and video into one all-or-nothing rollout.

## Verification

### Required repository entrypoints

Add these stable root scripts, each backed by a checked-in TypeScript runner in
`scripts/verification/` rather than platform-specific shell globs:

```text
bun run verify:034:accounting
bun run verify:034:storage
bun run verify:034:isolation
bun run verify:034:deletion
bun run verify:034:restore
bun run verify:034:load
bun run verify:034:selfhost-airgap
bun run verify:034
```

- `verify:034:accounting` runs entitlement, reservation, webhook and property
  tests with a deterministic fake provider clock.
- `verify:034:storage` runs plan 032's `ObjectStorageProvider` conformance suite
  against local, Garage and an ephemeral managed-compatible store, then executes
  cross-tenant and reconciliation attacks.
- `verify:034:isolation` runs the required plan-031 sandbox conformance profiles
  and secret/egress/tenant escape fixtures.
- `verify:034:deletion` exercises core, managed and offline-node state machines,
  reconnects the node and verifies its signed deletion receipt.
- `verify:034:restore` restores a seeded DB/object/snapshot backup into an empty
  environment and prints measured RPO/RTO plus digest/ledger reconciliation.
- `verify:034:load` runs the 30-day/100-tenant/10,000-run/1,000-concurrent-
  reservation fixture and fails on the thresholds above.
- `verify:034:selfhost-airgap` is a strict wrapper around
  `bun run verify:032:selfhost-airgap`, re-run against the exact release images
  selected for managed launch. Plan 034 may add assertions but cannot fork,
  weaken or replace plan 032's required air-gap contract.
- `verify:034` runs every command above and fails on a skip. Add
  `.github/workflows/plan-034-managed-gates.yml` with pinned service images and
  retained non-sensitive test summaries. Production credentials are forbidden.

The inherited air-gap test is a network assertion, not merely an
environment-variable check. The Compose profile must boot with billing,
Avermate telemetry and managed adapters absent; no runtime bundle may require
their DNS, JavaScript or configuration endpoints.

### Contract and property tests

- A request cannot execute without an enabled capability and valid reservation.
- Duplicate dispatch/provider callback/node event/webhook cannot double-consume
  or double-grant.
- Concurrent reservations cannot oversubscribe a hard cap.
- Expiry/cancel/failure consumes actual usage and releases the exact remainder.
- Placement fallback never occurs unless its exact policy is enabled.
- One tenant cannot stat/range/list/download another tenant's object, workspace,
  conversation, trace or usage.
- Secret values never appear in normalized events, logs, traces, exports or
  sandbox files.
- Deleting a source waits for/rejects live references according to policy and
  eventually reconciles DB/object/vector/conversation/snapshot placements;
  offline external nodes remain visibly pending/unverified until a signed
  receipt is processed.
- Self-host with billing/telemetry/managed adapters disabled passes the same core
  functional suite.

### Failure drills

- provider timeout/rate limit after reservation;
- worker crash after provider charge but before result commit;
- object commit before DB adoption and the inverse;
- lost node/worker heartbeat during generation;
- duplicate/out-of-order usage and billing events;
- entitlement cache stale during cancellation/refund;
- region/object-store outage and restore;
- signing/encryption key rotation and emergency revocation;
- global spend cap trip while jobs are queued/running;
- account deletion with offline node and recoverable/unrecoverable placements.

### Repository gates

Run plan 025's full baseline plus migration tests from an empty DB and the last
supported release, storage/provider/sandbox conformance jobs, dependency/image
scans and a production-like Compose/Kubernetes smoke environment. Paid-launch
gates cannot be waived because a unit test suite is green.

The minimum release invocation is:

```text
bun install --frozen-lockfile
bun run verify:025
bun run verify:032
bun run verify:034
```

If the owning earlier plan names a different finalized aggregate script, update
this block and the CI workflow together in the same change; never accept a
missing command as an implicit pass.

## Launch gates

- Release baseline and license are resolved.
- Entitlement and usage shadow mode meets the numeric 30-day, 100-tenant,
  10,000-run reconciliation/load thresholds above.
- No known path bypasses the execution router/reservation for a metered service.
- Multi-tenant object, conversation, model proxy and sandbox isolation have been
  reviewed and adversarially tested.
- Export and deletion report the truthful terminal/pending state across every
  placement; restore drill meets DB/ledger RPO <= 5 minutes and RTO <= 4 hours,
  and object/snapshot RPO <= 1 hour and RTO <= 24 hours.
- Per-user/global caps, cancellation and emergency kill switches are proven.
- Privacy/retention/AUP/terms, provider subprocessors and user-facing cost
  language are published and accurate.
- On-call ownership, dashboards, alerts, runbooks and incident communication are
  operational.
- Free/BYOK/node/full-self-host paths are documented and regression-tested; the
  full-self-host air-gap suite passes with avermate.fr, telemetry, billing and
  managed endpoints blocked.

## STOP conditions

- Do not integrate checkout before usage idempotency/reservation and entitlement
  tests pass in shadow mode.
- Do not offer hosted untrusted execution with development-container isolation,
  ambient credentials, unrestricted egress or unbounded descendants.
- Do not call the product end-to-end encrypted when the core/provider can see
  plaintext or metadata; use plan 032's exact transfer labels.
- Do not meter from logs/traces or authorize from eventual analytics.
- Do not delete user data on a billing webhook or short outage; entitlement
  restriction and lifecycle/deletion are separate workflows.
- Do not make a paid tier a prerequisite for grades, exports, external MCP,
  BYOK, custom node or full self-host.

## Definition of done

- Managed storage, inference and execution are ordinary tested placements behind
  the same contracts as self-host/BYOK/node.
- Fine-grained entitlements and append-only, idempotent usage reservations cover
  every costly path and surface understandable user totals/caps.
- Multi-tenant storage, conversation and sandbox isolation meet the launch gates,
  with export, deletion, backup, restore and incident procedures exercised.
- OTel-based telemetry and immutable audit events connect policy, runs, jobs,
  providers, artifacts and usage without leaking private content by default.
- An optional billing adapter can grant/restrict entitlements safely, including
  grace and failure states, without becoming the product's source of truth.
- The free academic core, MCP, BYOK, Avermate Node and full-self-host profiles
  remain functional, documented and tested independently of the managed tier.
- The numeric SLO, RPO/RTO, reconciliation and air-gap gates are exercised by
  `bun run verify:034`, with no required scenario skipped.
