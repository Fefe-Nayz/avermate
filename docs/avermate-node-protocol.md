# Avermate Node protocol v2

This document is the normative boundary for the new capability-routed Avermate
Node. It supersedes the storage-only satellite v1 sketch without redefining its
routes. The current implementation is a **developer foundation**, not a claim
that every Plan 032 product profile is released.

## Current implementation status

| Area                                                                                     | Status in this checkout                                                                                             |
| ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| Versioned schemas, signed manifest, Ed25519 node identity                                | Implemented and unit-tested                                                                                         |
| One-time fingerprint-bound pairing primitives                                            | Implemented; the Core registry/exchange endpoint is not wired                                                       |
| Short-lived resource/audience/limit grants and persistent `jti` replay ledger            | Implemented and unit-tested                                                                                         |
| Outbound bounded WSS control connector                                                   | Implemented with mock reconnect/direction tests; the daemon does not yet auto-enrol with a hosted relay             |
| Canonical job envelope, durable node ledger, leases, events, cancellation and commit ack | Implemented as a local protocol ledger; no production executor is advertised                                        |
| Bounded high-frequency stream lane                                                       | Implemented and unit-tested; no hosted relay endpoint is wired                                                      |
| Deterministic Core execution router                                                      | Implemented with explicit fallback and transfer consent                                                             |
| Node filesystem/S3 storage and Core-to-Node signed transport adapter                     | Implemented; filesystem, Core adapter, signed Node adapter and disposable Garage pass the shared conformance suite  |
| Core compatibility storage adapter                                                       | Implemented as a new adapter; repository-wide legacy facade migration is not complete                               |
| Two-phase object adoption                                                                | Coordinator and crash reconciliation are implemented; a durable Core repository adapter still has to be wired       |
| Remote deletion                                                                          | Signed manifests/receipts, tombstone guard and offline/revoked states are implemented behind a repository interface |
| Conversation/search/model/sandbox Core-to-Node adapters and execution plane              | Implemented with local reusable conformance; production relay/direct transports and daemon activation are not wired |
| Unproven or unavailable Node provider capabilities                                       | Filtered from routing and the signed daemon manifest; explicit fallback only                                        |
| Direct HTTPS or end-to-end encrypted transfer                                            | Not implemented                                                                                                     |
| Garage/real-S3 Node provider conformance                                                 | Disposable Garage v2.3 is implemented and passed; an operator endpoint remains an explicit opt-in gate              |
| Full-self-host runtime and air-gap proof                                                 | Harness is implemented and fail-closed; final proof is blocked by the current Docker Desktop content-store failure  |
| Path-filtered Plan 032 CI                                                                | Protocol/provider/configurator and both Compose runtime gates are required; no green hosted run is recorded yet     |

The daemon health response exposes these limitations. A configured but
unimplemented model or sandbox provider is reported as unavailable and is never
added to the signed capability manifest.

The exact 2026-08-22 command results, last successful Garage/runtime cells and
Docker host blocker are recorded in the
[Plan 032 verification evidence](releases/plan-032-evidence-2026-08-22.md).

## Trust and topology

The hosted or self-hosted Core remains authoritative for accounts, academic
data, ownership and policy. A paired Node can own bytes and, after their
providers pass conformance, conversations, indexes, inference, jobs and
sandboxes. The Node never imports the Core database or receives a browser
session.

The Node initiates the relay connection over WSS. The rotating channel
credential is sent in the upgrade request header, never a URL or browser
storage. Control frames are limited to 256 KiB. High-frequency frames use a
separate bounded lane with per-stream sequence/ack cursors, fair draining and a
2 MiB aggregate cap.

Core relay transport is TLS-confidential but **not end-to-end encrypted**: Core
can observe relayed plaintext in memory. Direct HTTPS and E2E relay modes must
not be shown as available until their separate protocols and tests exist.

## Identity, pairing and credentials

First boot persists an Ed25519 identity in an owner-only file. `nodeId` and
`keyId` are derived from the public key; loading fails if the persisted IDs do
not match the key. The local configurator can produce a five-minute,
single-use pairing offer containing a hash of the human code and the public-key
fingerprint. Consumption binds the exact attempt, code, fingerprint, user and
protocol major.

The implementation currently stops at that safe local primitive. The Core
registry, explicit capability confirmation and sealed credential rotation must
be implemented before the hosted product labels a Node “paired.” The raw
channel credential returned by the internal pairing primitive must be sealed
immediately; it is deliberately absent from the configurator response.

Every capability grant is signed and binds issuer, audience, node, user, actor,
job, `jti`, scopes, exact object refs and byte/token/cost/deadline limits. The
Node verifies the grant independently from the job digest. Its durable replay
ledger accepts an exact retry and rejects reuse with another principal or
envelope.

## Manifests and compatibility

The schema is `NodeCapabilityManifestV2` in
`packages/agent-contracts/src/node.ts`. The signed payload contains:

- protocol `avermate-node/2`, node/build/key IDs and a public configuration
  digest;
- independently versioned feature descriptions;
- observed limits and an expiry;
- an Ed25519 signature over canonical JSON.

Retrieval is schema-valid only with a lexical backend. Vector indexes are
optional acceleration. Unknown capability names are preserved for signature
verification and ignored by routing; the known capability bodies and all
privileged request envelopes remain strict. An incompatible major prevents
dispatch. A new manifest revision invalidates a cached routing decision.

## Routing

`DeterministicExecutionRouter` inspects only the explicit selected placement,
durable placement and named fallback chain. It rejects offline/degraded
providers, missing capabilities, incompatible versions, insufficient storage,
weak isolation and missing renderer image digests. Moving bytes to a fallback
requires explicit `allowDataTransfer`; there is no implicit managed/paid
fallback.

`CapabilityExecutionPlane` binds storage, conversations, retrieval, models and
sandbox dispatch to that router. A Node provider is eligible only when its
capability was explicitly proven against the same manifest revision that is
still live immediately before dispatch. The Core-side adapters validate
ownership, bounded responses and terminal stream framing; the Node-side local
transport keeps Core dependencies out of the Node package. This is an actual
in-process conformance path, not a claim that the production relay or direct
data lanes are implemented.

A durable object stays on its recorded placement when the provider is offline.
The outage is returned as an availability error rather than changing placement
or fabricating a 404. Tombstoned resources must pass the remote-deletion guard
before routing or grant issuance.

## Jobs and streams

Immutable job envelope fields are RFC-8785-style canonicalized and SHA-256
hashed. The durable idempotency key is scoped by the canonical principal
fingerprint. Delivery is at least once: exact duplicate offers return the same
state; a changed payload fails before execution.

The Node ledger persists offers, leases, heartbeat fencing, monotonic events,
durable cancellation, terminal result manifests and Core commit
acknowledgement. It rejects expired/lost leases, invalid stage transitions,
out-of-order events and completion without a result manifest. No executor kind
is advertised by `dev-zero`, so these records are protocol infrastructure, not
a simulated worker.

## Object storage and adoption

The exact `ObjectStorageProvider` contract lives in
`packages/agent-contracts/src/storage.ts`. All refs contain an opaque
owner/namespace/key tuple and disallow traversal. Providers expose truthful
capabilities for stat, get/range, put, delete, multipart, copy, reconcile and
short-lived one-object transfer grants.

The Node filesystem provider streams into an owner-only temporary file, checks
the declared size and SHA-256 before rename, then commits metadata atomically.
It supports ranges, resumable multipart, same-owner copy, quota accounting and
reconciliation. A retry can adopt exact bytes left by a crash between the byte
rename and metadata commit; it never overwrites a conflicting orphan.

The Core compatibility provider wraps the existing byte backend and
keeps an independent digest/ownership journal. It advertises neither multipart
nor server-side copy because that compatibility backend cannot yet guarantee
them. `NodeObjectStorageProvider` mints a signed operation grant and validates
the Node response/body digest and size. An offline Node returns
`NODE_STORAGE_OFFLINE`, not not-found.

Uploads that create a canonical file record use `TwoPhaseObjectAdopter`:

1. durably reserve the adoption intent;
2. commit and verify the provider object;
3. persist `object_committed`;
4. atomically create/verify the canonical row and mark `adopted`;
5. reconcile exact half-commits after a crash, or require operator action on a
   mismatch.

The coordinator requires an `ObjectAdoptionRepository`; this checkout does not
yet wire a Core database implementation, so callers must not bypass the current
file upload transaction and claim two-phase canonicality.

The Node S3 provider uses the same opaque owner/namespace/key model and keeps a
local integrity journal. The required disposable Garage v2.3 harness provisions
random credentials and a temporary project, exercises the shared provider
suite, and audits project-labelled containers, networks and volumes after
cleanup. `PLAN032_REAL_S3_CONFORMANCE=1` adds the operator-supplied endpoint; it
is never silently treated as covered by the disposable fixture.

## Deletion and offline semantics

Core first commits a tombstone. That tombstone blocks reads, transfers, grants,
routing and resurrection independently of whether remote bytes are reachable.
It then issues a Core-signed, nonce-bound manifest listing exact refs, sizes and
digests. The bound Node verifies issuer, node, owner, expiry, manifest digest and
signature, deletes each object, HEAD-verifies absence, and signs a receipt.

Core accepts a receipt only from the previously bound node/key with the exact
nonce, manifest digest, count and a valid timestamp/signature. Receipt replay
and replacement-node receipts fail. An offline Node remains
`pending_remote_deletion`; identity loss/revocation without a receipt is
`revoked_unreachable`, never “deleted.” The repository interface exposes
pending commands for a deletion-only reconnect path.

## Local configurator

`dev-zero` starts on loopback with filesystem storage and no Garage, model or
sandbox. The configurator exchanges a terminal/file bootstrap secret once for
an HttpOnly, SameSite=Strict, path-scoped session and a synchronizer CSRF token.
It validates exact Host, Origin and Fetch Metadata before mutating parsing,
rejects forwarded-host trust, rotates sessions after privilege changes, rate
limits attempts and emits restrictive CSP/no-store/frame/referrer headers.

The checked-in JSON Schema is generated from the Zod source into
`infra/node/config.schema.json`. YAML contains only public configuration and
secret references. The preflight reports observed architecture, free disk,
Docker daemon, gVisor/Kata and GPU availability for the selected profile; it
does not install privileged host software.

## Compose profiles and evidence

`infra/compose/avermate.yml` declares `dev-zero`, `node-lite`, `node-storage`,
`node-creator`, `node-local-gpu`, `node-observable` and `full-self-host`.
All profiles pass `docker compose config`. Before the Docker host failure in the
2026-08-22 verification run, isolated Compose projects booted and cleaned up for
`dev-zero`, `node-lite`, `node-storage` with real Garage, and
`node-observable`. Host preflight classified `node-creator` and
`node-local-gpu` as not applicable because the required gVisor/Kata isolation
runtime was absent; this is a capability result, not a skipped green profile.

The full-self-host harness builds Web/API/Node with profile-owned loopback
origins, then starts them only on an internal Docker network. It checks API and
Web health, Web-to-API service discovery, signed-in academic CRUD, local
upload/range/delete, local-fixture chat/search/export/delete, OAuth MCP
discovery, secret-free logs, declared sandbox unavailability, and blocked
DNS/HTTP egress. It also scans the emitted Web bundle and HTML for
`avermate.fr`, `nayz.fr`, and managed/billing/telemetry endpoints. The final run
has not completed: Docker Desktop's containerd/BuildKit content store returned
HTTP 500 and an earlier `metadata_v2.db` input/output error. The read-only
preflight reported `PLAN032_DOCKER_HOST_CONTENT_STORE_UNHEALTHY`; the final
read-only retry then timed out on `docker info` and is classified as
`PLAN032_DOCKER_HOST_DAEMON_UNAVAILABLE`. Both stop before touching an Avermate
Compose project.

Use the checked-in gates:

```text
bun run verify:032:protocol
bun run verify:032:storage
bun run verify:032:configurator
bun run verify:032:selfhost
bun run verify:032:selfhost-airgap
bun run verify:032
```

Protocol, configurator and all non-Docker storage/corpus/conversation cells pass
in the current checkout. The last completed `verify:032:storage` run also passed
its disposable Garage cell and cleanup. The self-host gates require a healthy
Docker daemon **and** content store and fail when runtime evidence is absent.
`verify:032:selfhost` boots every applicable profile; creator/GPU may be marked
not applicable only for the exact isolation/GPU failures returned by host
preflight. `verify:032:selfhost-airgap` refuses to substitute environment
inspection for an internal network, deployed product flows, bundle/HTML scan,
and active DNS/HTTP denial evidence.

Do not mark Plan 032 complete or update its roadmap row until both runtime gates
pass, a real sandbox artifact is supported or explicitly removed from the
release profile, and the Core pairing/relay/repository adapters plus production
provider transports are genuinely wired. Passing local transports or Compose
health cannot substitute for those production data-plane seams.
