# Managed-plane beta operations runbook

This runbook applies to Plan 034's accounting foundation and Plan 039's
invite-only control plane. It does not authorize public deployment, billing,
checkout, customer communication or a production-readiness claim. The operator
console records only redacted metadata. An incident record is not evidence that
an alert, restore or provider drill happened.

## Readiness and safe defaults

Keep `MANAGED_ACCOUNTING_MODE=shadow`, `MANAGED_ADAPTERS_ENABLED=false` and
`MANAGED_BETA_ENFORCEMENT_ENABLED=false` unless a separately reviewed environment is
running the complete conformance suite. `/health` proves process liveness;
`/ready` proves database reachability and the additive managed schema without a
costly upstream call. A full-self-host deployment remains ready when all
optional managed tables/adapters are absent.

The admin overview is metadata-only: pools, queue/reservation states, deletion
backlog, billing-inbox shadow state, storage categories and circuit breakers.
Do not add prompts, document bodies, object URLs, keys, grants or raw provider
payloads to this response or telemetry.

The Web console is at `/admin/managed`. It can issue one-time invitations,
suspend managed eligibility, publish quotas, operate breakers, reconcile
expired reservations, publish redacted incidents and attach evidence to launch
gates. None of those actions can enable checkout. A gate may be marked passed
only by current `deployed-drill` or `external-attestation` evidence; a
`repository-fixture` is rejected server-side.

## Routine checks

- Run `bun run verify:034:accounting` after entitlement, provider or usage
  changes.
- Run `bun run verify:034:storage` after object-store or namespace changes.
- Run `bun run verify:034:isolation` after image, sandbox, proxy or egress
  changes.
- Run `bun run verify:034:deletion` after ownership, retention or node protocol
  changes.
- Run `bun run verify:034:restore` and retain its digest/RPO/RTO summary after a
  database, object schema or backup change.
- Run `bun run verify:034:load` before changing caps, transaction strategy or
  reconciliation scheduling.
- Run `bun run verify:034:selfhost-airgap` against the exact candidate images.
- Run `bun run verify:039` after a managed beta control-plane, disclosure,
  quota, billing-boundary or runbook change. This is the repository gate only.
- Run `bun run verify:039:launch` in the candidate environment. It must fail
  when deployed isolation, backup/restore, load, privacy, alert and billing-test
  evidence is absent or stale.

The `maintenance.reconcileManagedUsage` durable job reconciles expired
reservations in bounded batches. Replays use existing idempotency keys; never
repair accounting by updating immutable usage rows manually.

## Recovery objectives and drill

The launch objectives are DB/ledger RPO at most 5 minutes and RTO at most 4
hours; managed object/snapshot RPO at most 1 hour and RTO at most 24 hours. The
repository drill captures the explicit allowlist of managed tables plus an
opaque object manifest, verifies a canonical SHA-256 digest, restores only into
an empty target, validates every column against the target schema, restores and
checks each object, then re-captures the target and requires an identical
digest. Its emitted RPO/RTO fields are labelled
`repository-fixture-not-operational`; they validate the algorithm and threshold
arithmetic, not backup-provider or production-infrastructure SLOs.

For a real environment, take provider-supported consistent DB/PITR and object
version backups; do not copy a live SQLite file without its journal. Record the
last durable DB event and object version before failure, restore into isolated
infrastructure, run the checked-in restore/reconciliation procedure, measure
RPO/RTO from observed timestamps, and keep only non-content evidence.

## Incident playbooks

### Credential leak

Open the relevant provider/global circuit breaker, revoke the provider key and
all issued proxy grants, rotate the key-versioned envelope material, inspect
immutable secret-access audit events, and validate redacted logs/exports. Do
not paste the credential into a ticket. Restore service only with a new key and
a minimal validation request.

### Suspected cross-tenant exposure

Disable the affected storage/model/sandbox capability globally, preserve
auditable metadata, and run adversarial account A/account B stat/range/list/
download tests. Revoke grants and affected keys. Treat existence disclosure as
exposure. Follow the reviewed incident/privacy notification process; none is
published by this repository yet, so public launch remains blocked.

### Runaway spend or loop

Open the global or provider circuit breaker. Cancel queued reservations and use
the user/account emergency stop where scoped. Do not mark already-dispatched
provider calls free: reconcile provider-authoritative usage or conservatively
settle the reserved maximum. Append any correction as an audited adjustment.

### Provider or region outage

Keep the selected placement immutable. Do not silently fall back across cost or
residency boundaries. A saved fallback may run only after a fresh router state
and manifest revision check. If the exact policy no longer matches, reject with
`ROUTING_DECISION_STALE` and request a new decision.

Triage provider health, affected capability and region without opening user
payloads. Open the narrowest breaker that stops new external effects, cancel
queued reservations and keep ambiguous dispatched calls reserved. Publish a
redacted incident with the affected capabilities. Close only after a fresh
provider probe, settlement reconciliation and an alert recovery observation.

### Abuse or denial-of-service pattern

Do not disable the academic account. Open the account/capability breaker,
suspend only managed beta eligibility when necessary, preserve rate/operation
metadata and revoke scoped execution grants. Check quota and concurrency policy
revisions before treating traffic as abuse. Escalate suspected child-safety or
legal issues through the separately approved process; the repository defines no
content-inspection authority. Restore managed access only with a documented,
audited operator justification.

### Lost, duplicated or conflicting billing webhook

Checkout remains off during the beta. For test-mode or later reviewed adapters,
locate the callback by provider event ID and payload digest. A duplicate with
the same digest is an idempotent replay; a duplicate ID with a different digest
is a security incident. Fetch provider state only through the reviewed adapter,
process observations in provider event-time order and quarantine unknown price,
customer or event types. Never infer identity from email and never grant an
entitlement directly from the webhook. Record reconciliation evidence before
closing the incident.

### Quota or accounting drift

Open the affected capability breaker when hard limits may oversubscribe. Compare
the entitlement snapshot, quota revision, active reservations, immutable usage
events and provider operation IDs. Run bounded expired-reservation
reconciliation. Do not update settled rows. Corrections are signed/audited
append-only adjustments with reason and evidence. Require zero negative balance,
double settlement or orphan provider effects before reopening.

### Corrupted object or artifact

Quarantine the physical reference, preserve its digest/version, restore a known
version into an isolated key, verify content/type/decompression policy, then
adopt it transactionally. Never expose broad bucket listings during
reconciliation.

### Stuck deletion or offline node

Resume the durable request. Managed targets complete only with a reconciled
receipt. Keep an offline node pending until reconnect; verify its signature,
nonce, request ID, object classes and manifest digest. If revoked/unreachable,
record `revoked_unreachable` or `user_action_required`, not
`verified_deleted`.

For managed placements, alert when a target stays
`pending_remote_deletion` beyond the approved deletion objective or repeated
attempts increase without a receipt. Open no broad object listing. Correlate the
request, placement key, manifest digest and attempt metadata, retry the exact
idempotent deletion, then verify the provider receipt. Keep the public/user
state pending until verification; never clear the backlog by editing state.

### Backup failure

Freeze any RPO/RTO or availability claim. Verify the last successful encrypted
inventory, checksum, database recovery point, object versions and separately
protected key material. Do not overwrite the last known-good backup with a new
unverified run. Repair the job, take a new consistent recovery point, restore it
into an empty isolated environment, reconcile table/object/ledger digests and
record measured RPO/RTO as `deployed-drill` evidence. Repository restore
fixtures do not close this incident.

### Regional recovery

Open the affected region/provider breakers and stop admission into the failed
placement. Establish an isolated replacement with reviewed residency and
processor policy. Restore the consistent database/object/key recovery point,
verify tenant isolation, deletion lineage, citation locators and accounting
digests, then publish a new placement/router revision. Existing decisions stay
immutable; clients must obtain a fresh decision. Reopen gradually by capability
and cohort after load, alert and reconciliation evidence passes.

### Compromised sandbox image

Revoke the image digest globally, terminate descendants and deny new
admissions. Preserve SBOM/signature/provenance and non-content run metadata.
Never roll forward by mutable tag. Hosted untrusted execution stays disabled if
only the development container profile is available.

## Key, backup and support controls

Back up encryption/signing keys separately from encrypted data and rehearse
restore and rotation. Retain old decrypt-only versions for the documented
window, revoke compromised signing keys immediately, and make receipt
verification key-version aware. Support sees metadata by default; content
elevation requires an expiring, justified, immutable audit entry.

Closing an incident requires successful targeted gates, usage/object/deletion
reconciliation, documented RPO/RTO and review of circuit breakers. It does not
by itself satisfy licence, policy, staffing or paid-launch gates.

## Alert catalogue and exercise evidence

Thresholds are environment policy, not universal source constants. Before a
beta cohort is expanded, exercise and record at least these alerts with a
deduplication key and recovery notification:

- provider error/timeout and queue-wait rate per capability and region;
- reservation expiry, settlement conflict and provider-cost mismatch;
- hard-limit denial, concurrency saturation and sustained account/global usage;
- deletion backlog age and failed receipt verification;
- backup age, backup checksum failure and restore-digest mismatch;
- isolation/egress denial, secret-access anomaly and suspected cross-tenant
  existence disclosure;
- billing inbox conflict/unknown mapping in test mode only.

Evidence records contain the environment, exact release revision, source,
observed time, expiry, safe metrics and optional artifact digest/reference. Do
not place logs or dashboard URLs containing customer identifiers/content in the
reference. The launch console must keep a gate `blocked` or `pending` when the
exercise is missing, stale, failed or only a repository fixture.
