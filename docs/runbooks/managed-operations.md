# Managed-plane operations runbook (shadow only)

This runbook applies to the technical shadow implementation from Plan 034. It
does not authorize deployment, billing, checkout, customer communication or a
production-readiness claim.

## Readiness and safe defaults

Keep `MANAGED_ACCOUNTING_MODE=shadow` and
`MANAGED_ADAPTERS_ENABLED=false` unless a separately reviewed environment is
running the complete conformance suite. `/health` proves process liveness;
`/ready` proves database reachability and the additive managed schema without a
costly upstream call. A full-self-host deployment remains ready when all
optional managed tables/adapters are absent.

The admin overview is metadata-only: pools, queue/reservation states, deletion
backlog, billing-inbox shadow state, storage categories and circuit breakers.
Do not add prompts, document bodies, object URLs, keys, grants or raw provider
payloads to this response or telemetry.

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
