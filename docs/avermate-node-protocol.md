# Avermate Node protocol v2

This document is the normative boundary for the new capability-routed Avermate
Node. It supersedes the storage-only satellite v1 sketch without redefining its
routes. The Plan 032 repository foundation is complete; plan 038 owns the
remaining end-to-end placement/distribution work. Neither status is a claim
that every product profile has passed live deployment evidence or is released.

## Current implementation status

| Area                                                                                     | Status in this checkout                                                                                             |
| ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| Versioned schemas, signed manifest, Ed25519 node identity                                | Implemented and unit-tested                                                                                         |
| One-time fingerprint-bound pairing primitives                                            | Core registry/exchange routes, explicit confirmation and sealed credential lifecycle are wired and tested           |
| Short-lived resource/audience/limit grants and persistent `jti` replay ledger            | Implemented and unit-tested                                                                                         |
| Outbound bounded control connector                                                       | WSS is mandatory remotely; one exact `ws://api:5000` Compose-internal full-self-host route is wired and tested       |
| Canonical job envelope, durable node ledger, leases, events, cancellation and commit ack | Implemented; specialist and deterministic artifact handlers are advertised only after exact image/profile preflight |
| Bounded high-frequency stream lane                                                       | Implemented through the durable Core relay and provider transport; no deployed hosted-relay proof is recorded       |
| Deterministic Core execution router                                                      | Implemented with explicit fallback and transfer consent                                                             |
| Node filesystem/S3 storage and Core-to-Node signed transport adapter                     | Implemented; filesystem, Core adapter, signed Node adapter and disposable Garage pass the shared conformance suite  |
| Core compatibility storage adapter                                                       | Implemented; full-self-host Core↔Node placement and migration completion are owned by plan 038                      |
| Two-phase object adoption                                                                | Coordinator, SQL repository, production adoption service and crash reconciliation are wired and tested              |
| Remote deletion                                                                          | SQL repository, signed manifests/receipts, tombstone guard and reconnect reconciliation are wired and tested        |
| Provider-native runtime checkpoint metadata                                              | Owner/node-bound SQL lifecycle is wired to capture/restore/delete relay operations and the logical snapshot ledger  |
| Conversation/search/model/sandbox Core-to-Node adapters and execution plane              | Production relay/dispatch and routed call sites are wired; external provider/runtime attestation remains a live gate |
| Node corpus body ownership                                                               | Signed exact-chunk reads, Core reauthorization, sealed recovery envelopes and transactional placement migration ship |
| Local OCR and speech-to-text                                                              | Offline Node routes and exact worker/model contracts are wired; digest-pinned release images and live readiness remain gates |
| Unproven or unavailable Node provider capabilities                                       | Filtered from routing and the signed daemon manifest; explicit fallback only                                        |
| Direct HTTPS or end-to-end encrypted transfer                                            | Not implemented                                                                                                     |
| Garage/real-S3 Node provider conformance                                                 | Disposable Garage v2.3 is implemented and passed; an operator endpoint remains an explicit opt-in gate              |
| Full-self-host runtime and air-gap proof                                                 | Harness is implemented and fail-closed; final proof is blocked by the current Docker Desktop content-store failure  |
| Path-filtered Plan 032 CI                                                                | Repository gates are green; Docker-dependent full-self-host and air-gap evidence remain fail-closed and unavailable |

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

The Node initiates the relay connection over WSS. The sole transport exception
is `full-self-host` in offline lifecycle mode: the immutable profile may select
`local-compose`, which maps exactly `http://api:5000` to
`ws://api:5000/api/node/control` on the private Compose network. Every other
plaintext URL, host, port or path is rejected; the setup port remains published
on host loopback only. The rotating channel
credential is sent in the upgrade request header, never a URL or browser
storage. Control frames are limited to 256 KiB. High-frequency frames use a
separate bounded lane with per-stream sequence/ack cursors, fair draining and a
2 MiB aggregate cap.

Remote Core relay transport is TLS-confidential but **not end-to-end
encrypted**: Core can observe relayed plaintext in memory. The explicit
single-host Compose exception relies on the private Docker network and signed,
credentialed application frames rather than TLS. It must never be exposed as a
remote Node route. Direct HTTPS transfers and E2E relay modes must not be shown
as available until their separate protocols and tests exist.

## Identity, pairing and credentials

First boot persists an Ed25519 identity in an owner-only file. `nodeId` and
`keyId` are derived from the public key; loading fails if the persisted IDs do
not match the key. The local configurator can produce a five-minute,
single-use pairing offer containing a hash of the human code and the public-key
fingerprint. Consumption binds the exact attempt, code, fingerprint, user and
protocol major.

The Core registry verifies this proof, requires explicit capability
confirmation, delivers short-lived relay/capability credentials once and stores
only sealed credentials. The configurator registers the offer, retrieves the
credential delivery, seals it in the Node secret store, acknowledges receipt
and then removes the pending offer. The raw channel credential is deliberately
absent from ordinary configurator state and health responses.

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
transport keeps Core dependencies out of the Node package. The production
relay transport uses those same operation contracts over an authenticated,
durably journaled channel. Direct HTTPS and end-to-end encrypted data lanes are
still not implemented and are never inferred from relay availability.

The retrieval lane includes `lexical.get-chunks`, bounded to 64 exact chunk IDs
and a 16 MiB response. Core authorizes those IDs from its own source/project/
version metadata before dispatch, validates exact ID cardinality and SHA-256,
and rebuilds snippets locally. For Node placement, Core FTS is empty and chunk
body columns contain only an authenticated recovery envelope. That envelope is
never served when the Node is offline. Core→Node, Node→Node and Node→Core moves
verify a canonical full-source digest before atomically rewriting the envelope,
index and placement pointer.

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

Deterministic artifact jobs use one outer object and no ambient object
authority. `inputRefs` contains exactly one `NodeArtifactRef` for an
`application/json` request object (maximum 8 MiB). `resourceRefs` contains the
outer request object's `OwnedObjectRef` plus every nested source object's ref;
the Core-signed grant must list exactly that same set. The JSON body is
`NodeArtifactWorkerRequestV1`:

```ts
{
  schemaVersion: 1;
  worker: NodeArtifactWorkerId;
  execution: { threadId: string; branchId: string };
  manifest: ExactVersionedWorkerManifest;
  inputs: Array<{ path: `input/${string}`; artifact: NodeArtifactRef }>;
}
```

The nested input set must exactly equal the digest/size/MIME/path descriptors
inside `manifest`; online browser and video jobs have no nested inputs. The
Node stages only the validated paths, invokes one fixed absolute entrypoint and
argv, verifies every output descriptor against provider metadata and bytes,
then adopts the results into owner-scoped Node storage.

The public job kind `artifact.video-audio-extract@1` is bound to the inner
`video-audio-extract.v2` contract. Its request fixes YouTube, mono 16 kHz MP3 at
48 kbit/s, 60–1200 second segments and `maximumSegmentBytes: 33554432`. Its
result contains ordered contiguous `segments[]` with start/end milliseconds
and canonical `output/audio-segment-NNN.mp3` descriptors; each descriptor and
stored object is independently capped at 32 MiB. The legacy inner v1 single-WAV
contract remains separate and is not advertised by this Node job.

Full self-host OCR uses `artifact.local-ocr@1` / `local-ocr.v1` and the distinct
`ocr` sandbox profile. Its digest-pinned image contains Tesseract, the reviewed
`fra`/`eng` trained data and Poppler's `pdfinfo`/`pdftoppm`; its fixed
entrypoint cannot download missing components. The request and result bind the
exact source digest and the signed `tesseract-ocr` catalogue revision; the
catalogue provider is `tesseract+poppler`, its modality is `image`, and the
result records `engine: tesseract+poppler` and `networkAccess: false`. Full
self-host transcription uses
`artifact.local-transcription@1` / `local-transcription.v1` and the distinct
`speech-to-text` profile. Its image contains `whisper.cpp` and the pinned model
at `/models/whisper-large-v3-turbo-q5_0.bin`. The request, result and Node model
catalogue all bind the exact ID
`selfhost/whisper-large-v3-turbo-q5_0` plus an immutable operator-supplied
revision. Audio/document bytes travel through owner-bound object references,
never inside control frames.

Both profiles declare `egress: none`, receive no provider key and have no HTTP
model service or runtime weight mount. Core's full-self-host provider selection
is `node` for both operations. An unavailable Node/profile returns an explicit
availability failure; it cannot fall back to Mistral, BYOK, managed inference or
another network destination.

For each healthy deterministic handler, the signed capability manifest exposes
`features.jobs.executionProfiles[]` with the exact
`{ kind, sandboxProfileId, profileVersion, imageDigest,
egressPolicyDigest }`. A profile entry must be unique and its `kind` must also
appear in `features.jobs.kinds`. Core uses this signed value to construct the
worker manifest; it never guesses an egress digest. Offline FFmpeg/corpus jobs
use `media`; online YouTube extraction uses the distinct `video-audio` profile,
so their egress and image attestations cannot be conflated. OCR and
speech-to-text are likewise omitted unless their own exact image/profile
preflights pass; checked-in YAML or a Compose interpolation check is not live
readiness evidence.

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

The production service wires the coordinator to
`CoreObjectAdoptionRepository`, adopts immutable Node results into the canonical
file ledger, deletes the adopted source through the signed remote-deletion lane,
and reconciles half-commits after restart or relay reconnect. The SQL
reservation enforces exact owner/provider/idempotency binding and applies the
Core artifact quota in the same transaction as canonical file creation.
Callers must use that service rather than bypassing the two-phase invariant.

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
pending commands for a deletion-only reconnect path. Core persists manifests,
exact owned refs, state and accepted receipt digest in libSQL before delivery.
Relay reconnect retries pending commands; an expired command is marked for
operator inspection and superseded by a fresh signed manifest instead of being
silently dropped. A verified tombstone remains terminal and prevents
resurrection.

## Provider-native runtime checkpoints

Runtime checkpoints are optional accelerators, not conversation or portable
workspace authority. Core persists the full provider checkpoint metadata in
`node_runtime_checkpoints`, bound to one active owner/node relationship and one
exact committed `workspace_snapshots` row. The lifecycle is
`captured → adopted → deleted` or `captured → failed → deleted`; adoption
atomically attaches only the provider-native opaque ref to the logical snapshot
ledger. Restore requires the original owner, node, provider, image and execution
profile compatibility and falls back to the logical workspace when the higher
layer permits it.

The authenticated relay exposes capability, capture, restore and delete
operations. Core reconciles persisted captures and expired records after
restart or Node reconnect, while remote cleanup remains retryable when the Node
is offline. `assistant_runs.conversationCheckpointRef` is never read or written
by this lifecycle. A provider capture can still be orphaned only in the narrow
external-effect window before Core receives and persists the opaque ref; its
provider TTL is therefore mandatory. Eliminating that last bounded orphan
window would require a provider-supported idempotent capture token or a
pre-capture schema state, neither of which is claimed by the current schema.

## Local configurator

`dev-zero` starts on loopback with filesystem storage and no Garage, model or
sandbox. The configurator exchanges a terminal/file bootstrap secret once for
an HttpOnly, SameSite=Strict, path-scoped session and a synchronizer CSRF token.
It validates exact Host, Origin and Fetch Metadata before mutating parsing,
rejects forwarded-host trust, rotates sessions after privilege changes, rate
limits attempts and emits restrictive CSP/no-store/frame/referrer headers.

After unlock, the same loopback UI edits the complete public configuration for
filesystem/S3, conversations, embedding/rerank, direct/LiteLLM models, sandbox,
runtime checkpoints, OpenCode/OpenHands, jobs, lifecycle, backup and telemetry.
It calls separate validate/apply/rollback APIs with loading, error and success
states; provider values go directly to the local secret vault. Pairing and
deployment previews are owner-visible but never expose a long-lived credential
or execute privileged host commands. A browser-persisted FR/EN selector
localizes static copy, generated group/field labels, validation errors and
runtime action messages without discarding unsaved field values.

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
bun run verify:032:storage:contracts
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

Plan 032 may be marked complete for its repository foundation because the Core
pairing/relay/repository seams are wired and gated. That does not close plan
038's end-to-end placement, distribution, migration or specialist-worker scope.
`verify:038` reruns the protocol, non-Docker storage-contract and configurator
sub-gates before its Node/server/Web/type checks; `verify:038:live` remains a
separate release gate.
Do not mark any deployment profile released until its runtime and air-gap gates
pass on a healthy host, and do not advertise sandbox-backed capabilities without
an attested provider/image artifact. Passing repository tests or static Compose
checks cannot substitute for that live evidence.
