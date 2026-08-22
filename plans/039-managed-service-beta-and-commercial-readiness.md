# Plan 039: Managed service beta, operations and commercial readiness

> **Executor instruction**
>
> Read plan 034 completely, then plans 025, 031–033 and 035–038 plus
> `docs/managed-plane.md` and every managed/usage/billing/operations/privacy
> implementation under `apps/server/src`. Plan 034's shadow accounting is the
> foundation; do not replace it with billing-provider state. This plan activates
> real managed placements in stages and implements the complete Web/operator
> experience. No money-moving action may be enabled until its explicit launch
> gate, legal/licence decisions and external sandbox/storage proofs pass.

## Status

- **Status**: IMPLEMENTED AS SAFE REPOSITORY BETA — external launch gates remain
  blocked and checkout remains off
- **Priority**: P1 after 035/036/038; P0 before advertising managed AI/storage
- **Effort**: XL / operational
- **Risk**: CRITICAL
- **Depends on**: 025, 031–038; consumes 034's entitlements, reservations, usage,
  pricing snapshots, deletion and readiness gates
- **Blocks**: public managed AI/storage and paid convenience plans
- **Category**: multi-tenancy, SRE, billing, privacy, Web product
- **Planned at**: 2026-08-22, branch `rewrite`
- **Evidence baseline**: `15a8897ce1eb82c2807f5547d9f558a59ad9a2e1`

## Implementation status — 2026-08-22

The repository now contains the invite/consent control plane, guarded
capability and quota enforcement, customer Web experience, role-gated operator
console, privacy export/deletion state, redacted evidence/incident/gate model,
test-mode billing boundary, runbooks and `verify:039` repository aggregate.
`docs/releases/plan-039-evidence-2026-08-22.md` records the exact checked-in
evidence and outstanding external proofs.

This does **not** complete the operational launch definition below. Exact
deployed managed providers, strong isolation, alert/load/privacy exercises,
encrypted backup/restore with measured RPO/RTO, air-gap evidence and a selected
billing/legal/tax/price decision remain unavailable. `verify:039:launch` fails
closed without a current evidence manifest for the exact release revision.
`checkoutEnabled`, `billingEnabled` and `launchReady` remain hard-coded `false`;
there is no production checkout or portal procedure.

## Outcome

Operate an invite-only managed Avermate capability plane that can safely host
selected files, conversations, retrieval, inference and sandbox jobs while the
academic Core remains free and all BYOK/Node/full-self-host paths remain usable.
Then, only after measured beta evidence, enable a provider-backed paid plan with
correct entitlements, checkout, portal, invoicing state and support operations.

The managed path uses the same AgentRuntime, ToolBroker, corpus, storage,
sandbox, jobs and artifact contracts as self-host. It is a placement, not a
second product or cloud-only fork.

## Current-state evidence and gaps

1. Plan 034 implements provider-neutral entitlements, hard reservations,
   immutable usage/pricing ledgers, circuit breakers, tenant-aware storage,
   deletion/export, redacted telemetry and shadow billing fixtures.
2. `apps/server/src/routers/managed.ts:55-76` truthfully reports
   `checkoutEnabled: false`, `billingEnabled: false` and `launchReady: false`.
3. The plan-034 accounting/deletion/repository-restore/load fixtures are green,
   including 10,000 simulated runs and 1,000 concurrent SQL reservations with no
   drift/double charge.
4. The restore evidence is explicitly a repository fixture, not an operational
   backup of a deployed managed stack.
5. `verify:034:isolation` correctly remains red without a real strongly isolated
   managed provider. Unit mocks cannot satisfy the gate.
6. Docker Desktop is currently host-broken, so full self-host/air-gap cells have
   not been rerun on the exact tree. This does not authorize a managed launch.
7. No production checkout/customer portal/provider webhook/entitlement mapping
   is enabled and there is no complete customer usage/billing UI or operator
   console.

## Mandatory drift check

```text
git rev-parse HEAD
git status --short
rg -n "checkoutEnabled|billingEnabled|launchReady" apps/server/src apps/web/src docs
rg -n "shadow|reservation|pricing|entitlement|breaker" apps/server/src/usage apps/server/src/billing apps/server/src/operations
rg -n "managed.*storage|tenant" apps/server/src/storage apps/server/src/privacy
bun run verify:034:accounting
bun run verify:034:deletion
bun run verify:034:restore
bun run verify:034:load
```

Record live infrastructure, region and provider versions separately. STOP and
update the plan if any money-moving integration or managed provider is already
active.

## Product contract

The following remain available without a managed subscription, subject only to
the published free-service and self-host policies:

- accounts, years, subjects, grades, averages, school sync and planning;
- external MCP access within scopes;
- BYOK model/OCR/transcription/embedding/reranking;
- paired custom Node and full self-host;
- local/Node storage, conversations, search, sandboxes and artifacts;
- full export and deletion.

Managed plans may charge only for measurable Avermate-funded convenience:
object bytes/operations/egress, OCR/transcription pages or seconds, embeddings,
reranking, model tokens, TTS characters, sandbox compute and retained snapshots.
No UI may imply that paying improves grade calculations or unlocks ownership of
the user's academic data.

## Invariants

- Every costly dispatch requires an enabled entitlement and durable reservation
  before its first external effect. Settlement records actual normalized usage
  and releases the exact remainder.
- Billing-provider customer/subscription state is evidence, not authority. The
  Avermate entitlement ledger determines access and is changed only by reviewed,
  idempotent lifecycle commands.
- Pricing snapshots are immutable and bound before dispatch. Never recalculate
  historical user charges from a new price.
- Provider/model usage that cannot be normalized is quarantined for operator
  reconciliation, not estimated onto a user bill.
- Strong tenant isolation is observed on the exact deployed sandbox/storage/
  model paths. Namespace labels and unit mocks are insufficient.
- Managed services never receive school passwords or unrestricted ToolBroker
  authority. Workloads receive scoped opaque handles/capability grants.
- Raw prompts, documents, copies and model output are excluded from default
  telemetry. Audit metadata is bounded/redacted and retention-controlled.
- Free/BYOK/Node behavior never silently falls back to managed spend.
- Deletion/export works for suspended/cancelled users and does not require an
  active subscription.
- Checkout and billing remain disabled until the launch checklist is signed off;
  development/test-mode integration is not a production launch.

## In scope

- Real managed object, model/retrieval/rerank and sandbox provider placements.
- Strong isolation and accounting conformance on exact release infrastructure.
- Invite/allowlist, quotas, abuse controls, support and operator workflows.
- Operational backup/restore, regional recovery, load and incident exercises.
- Complete customer Web usage/privacy/plan/billing/delete/export experience.
- Provider-neutral billing boundary and one production-grade adapter after an
  explicit provider decision; Stripe is the default implementation candidate,
  not an unreviewed authority.
- Staged free beta, metered beta and eventual paid activation gates.

## Out of scope

- Making managed services mandatory or weakening self-host/BYOK.
- Enabling arbitrary managed shell/Python before a matching strong-isolation
  profile passes.
- Advertising HA/SLA/data residency not proven by deployment evidence.
- Selecting prices, tax/legal entity or refund terms solely in source code.
- React Native.

## Implementation sequence

### 1. Select and prove managed placements

- Record a decision for managed object storage, sandbox, model gateway,
  embedding/rerank providers, regions and processors/subprocessors.
- Implement each behind the existing provider contract and deterministic
  placement router. Keep direct/Node adapters in the same conformance suites.
- For sandbox, use an E2B/OpenSandbox or equivalent provider only after exact
  image/profile/host evidence proves required isolation, egress, secret, resource,
  artifact and tenant controls.
- For model operations, deploy the plan-038 LiteLLM profile only if it improves
  multi-tenant virtual keys/budgets/operations; Avermate usage remains authority.
- For storage, enforce tenant prefixes/buckets, server-side encryption, object
  immutability where required, range/size limits, lifecycle and deletion receipts.
- Run cross-tenant hostile tests from inside the real workload, not only through
  mocked APIs.

### 2. Turn shadow decisions into guarded enforcement

- Keep shadow logging and compare would-allow/would-block against expected beta
  policy for at least a representative observation window.
- Add per-capability/account/tenant/global hard caps, reservation TTL/recovery,
  concurrency and daily/monthly limits.
- Promote one capability at a time from shadow to enforcement behind a revisioned
  kill switch. Never flip all managed placements together.
- Reconcile provider usage/cost to operation/reservation IDs. Alert and quarantine
  missing, duplicate, late or conflicting records.
- Implement support adjustments as append-only signed/audited entries with
  reason, actor and limits; never edit consumption.

### 3. Add invite-only beta control plane

- Add invite issuance/redemption, account allowlist, terms/privacy acceptance
  revision, region/placement selection and beta cohort metadata.
- Separate capability eligibility from subscription tier so staff can disable one
  unsafe provider without removing academic access.
- Add waitlist/invite/admin procedures with exact roles, rate limits, audit and no
  ability to view user content by default.
- Build user-visible limits before use and explicit reservation/denial messages
  during jobs/chat. Show no invented monetary charge in free beta.
- Provide emergency account/provider/capability/global breakers with tested
  propagation to running and queued work.

### 4. Build the customer Web experience

- Settings → AI & storage shows current mode (disabled/BYOK/Node/managed), region,
  providers/processors, data categories, limits, usage and retention.
- Add usage dashboards by capability and period using authoritative normalized
  units; display estimate vs settled state and explanatory drill-down without
  raw sensitive payloads.
- Add plan comparison that never places export/delete/BYOK/self-host or academic
  accuracy behind a paid tier.
- Add invite activation, consent, quota-denied, breaker/outage, provider
  degradation, cancelled/suspended and migration-away flows.
- Add one-click export and staged deletion with impact preview, grace period where
  selected, offline-Node pending state and final receipts.
- After billing activation, add checkout return, customer portal, payment action
  required, cancellation/end-of-period, invoice/credit and support-contact states.
- Accessibility, responsive Web, French copy and complete loading/empty/error
  states are release gates.

### 5. Build the operator console and runbooks

- Add role-gated readiness, cohorts, capability health, reservation/settlement
  reconciliation, cost anomalies, breakers, deletion backlog, provider incidents,
  backup freshness and restore-drill status.
- Never expose document/chat content in aggregate operations screens. Content
  access requires a separate audited support process and user/legal authority.
- Add redacted correlation search from user-visible operation ID through Core,
  queue, provider and settlement.
- Create runbooks for provider outage, cost spike, abuse, suspected cross-tenant
  leak, lost webhook, quota drift, stuck deletion, backup failure and regional
  recovery.
- Add on-call alerts with tested thresholds and deduplication; dashboards without
  exercised alerts do not count.

### 6. Prove operational backup, restore and recovery

- Back up Core managed tables, object metadata/bytes, conversation/corpus stores,
  usage/pricing/entitlements, keys needed for decryption/signature and provider
  configuration under a consistent recovery point.
- Encrypt, checksum, inventory and retain backups according to documented policy.
- Restore into an empty isolated environment, reconcile provider objects and
  compare table/object/ledger digests.
- Measure and publish honest RPO/RTO from the deployed drill; the repository
  fixture remains a unit/integration test only.
- Test partial-region/provider failure and migration to a replacement provider
  without losing ownership, citation locators or accounting lineage.

### 7. Load, abuse and privacy validation

- Replay a 30-day representative workload with school-calendar bursts, document
  batches, concurrent chat, OCR, embeddings/rerank, TTS and sandbox artifacts.
- Prove no negative balance, double grant/charge, oversubscription or cross-tenant
  object/vector/event result under concurrency and retries.
- Measure queue wait, SSE latency, provider p50/p95/p99, cancellation, deletion
  completion, cost/unit and fallback rate per capability.
- Run prompt/tool/data exfiltration, SSRF, decompression/JSON bombs, malicious
  documents, sandbox escapes at the application boundary, secret redaction and
  support-role abuse tests.
- Complete a privacy inventory/DPIA-equivalent review appropriate to the launch
  region, processor contracts and child/student data before public use.

### 8. Implement billing only behind the final gate

- Ratify billing provider, legal entity, currency/tax/refund/cancellation policy
  and prices outside code. Record the decision and test-mode account.
- Define a provider-neutral `BillingProvider` with checkout, portal and signed
  webhook normalization. Implement the selected adapter with pinned API version,
  signature verification, bounded bodies and idempotent event inbox.
- Map immutable price IDs to versioned Avermate plan revisions. Unknown prices/
  customers/events quarantine; email matching is never identity.
- Process out-of-order/replayed events by provider event time/version without
  regressing entitlements. Payment failure follows documented grace policy and
  never blocks export/delete or corrupts academic access.
- Reconcile subscription/invoices with entitlement revisions and usage. Metered
  provider invoices, if used, consume settled ledger aggregates and idempotency
  keys; never raw client counters.
- Keep `checkoutEnabled` false until all launch gates below are signed and the
  operator explicitly enables the kill switch in production configuration.

## Launch phases and gates

### Phase A — staff only, no money

- Real providers, synthetic/staff data, enforcement on, all breakers/alerts,
  weekly restore drill. No external invites.

### Phase B — small free invite beta

- Explicit consent and limits, no checkout, manual cohort expansion, support and
  deletion SLA measured. Publish beta limitations.

### Phase C — metered free/credit beta

- User-visible settled usage, provider cost reconciliation and credit ledger.
  Still no money-moving checkout.

### Phase D — paid invite beta

- Legal/licence/privacy/provider decisions complete, billing adapter test/live
  isolation, invoices/support/refunds/reconciliation and incident drills green.
  Enable only selected accounts/prices.

### Phase E — public managed plan

- Requires explicit maintainer authorization after a sustained error/cost/
  support/security observation window. It is not an automatic result of merging
  this plan.

## Verification matrix

Harden `verify:034` so the shadow suite is green independently while its release
aggregate cannot pass without a live isolation report. Add `verify:039:*` for
providers, isolation, enforcement, beta, Web, operations, restore, load, privacy
and billing.

Mandatory cases:

- all plan-034 accounting/reservation/pricing/breaker invariants under real
  provider adapters;
- hostile cross-tenant storage/vector/conversation/sandbox/model tests;
- provider timeout/retry/cancellation and cost/usage reconciliation;
- invite replay/account mismatch/terms revision/capability revocation;
- quota UI and exact server enforcement, including concurrent oversubscription;
- export/delete while active, cancelled, unpaid, suspended and Node offline;
- operator role isolation, audit/redaction and breaker propagation;
- deployed backup/restore with measured RPO/RTO and tamper/non-empty rejection;
- representative load with zero drift/double charge/grant/negative balances;
- billing signature, replay, out-of-order, unknown price/customer, checkout return,
  grace/cancel/portal and reconciliation in provider test mode;
- Chromium customer/operator E2E and accessibility;
- root format/lint/types/tests/build, migration fixtures, release security,
  dependency/image/SBOM/signature and air-gap parity.

## STOP conditions

STOP, preserve evidence and request an explicit decision if:

- real managed isolation or cross-tenant tests are unavailable/failing;
- a provider lacks required data-use, residency, deletion or processor terms for
  the intended school data;
- authoritative usage cannot be reconciled to provider effects/cost;
- checkout would be enabled before licence/legal/tax/privacy/price/support
  decisions or without a production kill switch;
- billing provider state would become the sole entitlement authority;
- a paid failure would block export/delete or modify academic data;
- telemetry/support tooling requires routine access to raw user content;
- backup/restore is only a repository fixture or cannot meet the published RPO/
  RTO;
- a disabled/mock/static gate would be relabelled live;
- managed work would weaken BYOK, Node or full-self-host paths.

## Definition of done

- Real managed storage, model/retrieval/rerank and at least one strong-isolation
  sandbox profile pass the same contracts as direct/Node placements.
- Entitlements and reservations enforce safely after a measured shadow period;
  settled usage reconciles with provider effects and user-visible units.
- Invite, consent, limits, usage, privacy, export/delete and operational status
  are complete in Web and operator tooling with accessibility coverage.
- Deployed backup/restore, load, incident, breaker, privacy and cross-tenant
  exercises have immutable evidence and honest measured results.
- The billing boundary and selected adapter pass full test-mode conformance.
  Production checkout is enabled only if every Phase-D gate and explicit
  maintainer authorization are recorded; otherwise the completed result remains
  a safe free invite beta with `checkoutEnabled: false`.
- Academic Core, MCP, BYOK, Node and full-self-host continue to work without a
  managed subscription or silent managed fallback.

## Maintenance trigger

Re-run provider/isolation/accounting/load/restore/privacy/billing conformance when
any provider/API version, price/entitlement, region/processor, image/model,
retention policy, usage normalization, Web disclosure or incident runbook
changes.
