# Plan 032: Avermate Node — hybrid data plane, configurator and full self-host profiles

> **Executor instructions**: Read plans 026–031 and the current satellite/self-
> hosting docs before defining wire types. Deliver the protocol in the phased
> order below, run the conformance/failure suite for every capability, and update
> the 032 row in `plans/README.md` only after `dev-zero`, full-self-host smoke and
> full-self-host air-gap tests pass. Do not expose a node publicly, push or open
> a PR unless requested.
>
> **Drift check (run first)**:
>
> ```text
> git diff --stat <plan-025-baseline>..HEAD -- docs/satellite-protocol.md docs/self-hosting.md packages/agent-contracts apps/node apps/server/src/node apps/server/src/lib/storage.ts apps/server/src/lib/storage-backend.ts apps/web/src/components/settings deploy.yml infra
> ```
>
> Stop if the plan-025 SHA is absent, capability contracts disagree, or existing
> deployment/storage changes have not been reconciled.

> [!IMPORTANT]
> Replace the future “satellite = storage plus reserved OpenAI endpoint” concept
> with a capability-routed node. The hosted core remains authoritative for
> accounts, grades, school years and policy; a paired user node may own files,
> corpus indexes, conversations, inference, jobs and sandboxes independently.
> The same protocol must also connect components in a full self-host deployment.

## Status

- **Status**: IN PROGRESS — protocol/static/local provider cells are green;
  full-self-host runtime is host-blocked and production transports remain
  incomplete
- **Priority**: P1
- **Effort**: XL (multi-release)
- **Risk**: CRITICAL
- **Depends on**: 025, 026 and 027; storage/search/chat adapters from 028/029;
  mutating domain-tool placements depend on 030; sandbox capability depends on
  031
- **Blocks**: node-backed advanced pipelines in 033 and managed parity in 034
- **Category**: distributed systems, self-hosting, storage, execution routing
- **Planned at**: 2026-08-22
- **Planning baseline**: plan 025 baseline SHA

### Implementation checkpoint (2026-08-22)

The current evidence is recorded in
[`docs/releases/plan-032-evidence-2026-08-22.md`](../docs/releases/plan-032-evidence-2026-08-22.md).
The protocol gate passed **37 tests**; the configurator gate passed **10 tests**
plus a real loopback `dev-zero` health smoke. The storage/corpus/conversation
cells passed, and the last complete storage run passed a disposable Garage 2.3
provider conformance suite with no labelled container, volume or network left
behind. Before the Docker host failure, disposable `dev-zero`, `node-lite`,
`node-storage` with Garage, and `node-observable` profiles booted and cleaned up.

The current static-only self-host and air-gap checks pass Compose/source
assertions, but they explicitly do not prove runtime independence. The required
deployed full-self-host and air-gap runs are blocked by the Docker Desktop
content store/daemon failure (`metadata_v2.db` I/O error, HTTP 500, then
`PLAN032_DOCKER_HOST_DAEMON_UNAVAILABLE`). The aggregate `verify:032` is
therefore red by dependency; this is not converted into a skip or a false green.

Independent of Docker, product gaps remain: production Core pairing/exchange
and sealed-credential lifecycle, automatic relay enrolment and real transport
lanes, a durable Core repository for two-phase object adoption, remaining
storage-facade call-site migration, and a real sandbox artifact. Local
contracts, filesystem/Garage adapters and static Compose checks do not prove
those production seams. Plan 032 must remain in progress.

## Scope

**In scope**: versioned node protocol, outbound pairing/control/event channels,
capability grants/manifests, deterministic execution routing, storage transfer,
conversation/search/model/sandbox adapters, daemon/configurator profiles,
diagnostics, upgrades/backups and full-self-host composition.

**Out of scope**: silently relocating data, browser-held admin credentials,
building raw sandbox isolation, managed billing/operations (034), and activating
node-hosted school credentials before their dedicated threat/conformance review.

## Product modes to support

One account/application, explicit capability placement:

| Mode           | Academic core | Files/chat/search                         | Inference/execution                   |
| -------------- | ------------- | ----------------------------------------- | ------------------------------------- |
| core-only      | avermate.fr   | none/minimal metadata                     | none; external MCP remains usable     |
| BYOK           | avermate.fr   | user S3/core-configured store             | direct provider keys; no sandbox      |
| managed        | avermate.fr   | managed allowance                         | managed models/sandbox with quotas    |
| custom node    | avermate.fr   | user's node or external S3 chosen by node | user's providers/local models/sandbox |
| full self-host | user's core   | user's node/storage                       | user's providers/local models/sandbox |

Capabilities are independent. A user may keep chat on the node, use external S3
for files, use a direct BYOK model and disable code execution. There is no single
“self-host everything or nothing” switch.

## Current state and change

`docs/satellite-protocol.md` currently defines a future server-to-satellite
bearer protocol, storage-only v1, and states that the browser never contacts the
satellite. That is insufficient for:

- home servers behind NAT;
- large/resumable transfers;
- job leases, progress and cancellation;
- model and embedding capabilities;
- conversation placement;
- browser/renderer/sandbox execution;
- independent capability health/quotas;
- a visual deployment builder.

Supersede the document with `docs/avermate-node-protocol.md`. Preserve the old
file as historical rationale and a migration note; do not silently redefine its
`/v1` routes.

## Topology

### Control plane

- Hosted/full-self-host Avermate core: auth, academic DB, ownership, tool policy,
  action ledger, node registry, scheduler and core-placement event replay; for a
  node-placement conversation it retains routing/ack metadata only.
- Node daemon: user-controlled capability providers, object ledger, local job
  executor, conversation/search stores and sandbox broker.
- Web app: obtains authenticated metadata and events from the core; uploads or
  streams data through a separately authorized transfer lane.

### Outbound control channel

The node opens the long-lived authenticated connection to the core relay using
TLS over WebSocket or HTTP/2. This avoids requiring the SaaS to connect to an
arbitrary user URL and works behind NAT/tunnels.

The channel carries only bounded control frames:

- hello/build/protocol/capability manifest;
- health, load and quota snapshots;
- job offer/accept/lease/heartbeat/cancel;
- ordered progress/result manifests;
- token/key rotation and shutdown notices.

Large files and model streams do not share an unbounded control-frame buffer.
The browser reads normalized agent/job events via core SSE using plan 026; the
node channel is not exposed to the browser. Persistence before publish happens
in the conversation's authoritative store, not unconditionally in the core.

Define a separate bounded stream lane for token/tool deltas and other
high-frequency run events, multiplexed by run ID with per-stream flow control,
sequence/ack cursors, byte limits and cancellation. It may use an HTTP/2 stream
or a separate logical WebSocket channel. For core placement the core persists
and redacts each canonical event before SSE. For node placement the node persists
the canonical event first, then sends a sequenced relay frame; the core stores
only bounded routing, last-seen/ack sequence and non-content health metadata and
relays the plaintext frame transiently. Backpressure pauses or cancels the
producer; it must not accumulate an unbounded model response in node or relay
memory. On SSE reconnect, the core asks the authoritative store to replay after
the browser cursor. If a node is offline, node-owned event/message content is
unavailable rather than reconstructed from core metadata.

This relay is transport-confidential with TLS but is not end-to-end encrypted:
the hosted core can observe relayed plaintext in memory even though it does not
durably store it. Make that fact visible in placement/privacy copy. Only the
separately reviewed E2E mode below may claim that the relay cannot read content.

## Identity, pairing and grants

### Node identity

On first boot the node creates:

- opaque node/instance ID;
- Ed25519 (or reviewed equivalent) signing key;
- separate key agreement/encryption material if direct/E2E data transfer is
  implemented;
- a short-lived, single-use pairing code shown only in the local configurator.

Pairing flow:

1. User signs into Avermate and enters/scans the pairing code.
2. Node's outbound channel presents the pending code and public identity.
3. Core binds `(user, nodeId, public key, protocol major)` after explicit user
   confirmation and displays a fingerprint/capability preview.
4. Core and node exchange rotating, audience-bound credentials/certificates.
5. The one-time code is consumed and never becomes a bearer token.

Store long-lived node credentials in the node secret store and sealed core DB,
never Web local storage, Compose output, logs or SSE.

### Capability grants

For each accepted job/run the core mints a short-lived signed grant bound to:

- user ID and node ID;
- job/run ID and unique `jti`;
- exact capability/tool scopes;
- resource IDs or object keys;
- byte/token/cost/time limits;
- not-before/expiry;
- intended audience.

The node cannot use the grant to query the database or impersonate the user's
browser. When node-hosted tools need academic data, they call the normal MCP/tool
broker with that grant; ownership and action policy remain central.

Rotate credentials without re-pairing where possible. Support user/core/node
revocation and an emergency denylist. A revoked/offline node remains visible but
receives no new jobs.

## Versioned capability manifest

Use a signed manifest equivalent to:

```ts
type NodeCapabilityManifestV2 = {
  protocol: "avermate-node/2";
  nodeId: string;
  build: string;
  configRevision: string;
  features: {
    storage?: {
      version: 1;
      maxObjectBytes: number;
      multipart: boolean;
      directTransfer: boolean;
      encryptionModes: string[];
    };
    conversations?: { version: 1; search: boolean; maxBytes: number };
    retrieval?: {
      version: 1;
      lexical: boolean;
      vectorSpaces: Array<{ model: string; dimensions: number[] }>;
    };
    models?: { version: 1; models: ModelCapability[] };
    jobs?: { version: 1; kinds: string[]; maxConcurrent: number };
    sandbox?: {
      version: 1;
      isolation: "none" | "runc" | "gvisor" | "kata" | "microvm";
      workspaceSnapshots: boolean;
      runtimeCheckpoints: boolean;
      browser: boolean;
      gpu: boolean;
    };
    renderers?: { version: 1; kinds: string[]; imageDigests: string[] };
    schoolConnectors?: { version: 1; providers: string[] };
  };
  limits: NodeLimitSnapshot;
  issuedAt: string;
  signature: string;
};
```

Rules:

- advertise observed isolation/runtime, never configured aspiration;
- each capability versions independently under a protocol major;
- unknown additive capabilities are ignored;
- incompatible majors prevent job dispatch but preserve pairing/configuration;
- manifest change invalidates cached routing and appears in settings;
- health/load is separate from static capability support.
- a `retrieval` capability is valid only when `lexical: true`; vector search is
  optional acceleration, never a substitute for lexical/exact-locator search.

## ExecutionRouter

Add a central, deterministic router:

```ts
interface ExecutionRouter {
  resolve(input: CapabilityRequest): Promise<CapabilityPlacement>;
  dispatch(input: RoutedOperation): Promise<RoutedHandle>;
}
```

Resolution inputs:

- user-selected placement for this capability;
- object/thread/project placement and data residency;
- provider/key/model compatibility;
- node online/healthy/load/limit state;
- required isolation and renderer image digest;
- privacy constraints and allowed data movement;
- managed entitlement/quota;
- explicit fallback policy.

Resolution produces an inspectable decision. Never silently fall back from node
or BYOK to paid/operator inference or storage. A user may opt into a named
fallback chain and sees it before execution.

Persist placement on durable objects (`files`, corpus sources/indexes,
conversations, workspaces/artifacts). Do not infer current placement from the
node's online state.

## Node job protocol

### Envelope

```ts
type NodeJobV1 = {
  id: string;
  principalRef: {
    userId: string;
    nodeId: string;
    actorKind: "embedded-agent" | "mcp" | "system" | "user";
    actorClientId?: string;
  };
  kind: string;
  capabilityVersion: number;
  inputRefs: NodeArtifactRef[];
  policyRef: string;
  limits: {
    cpuMillis: number;
    memoryBytes: number;
    inputBytes: number;
    outputBytes: number;
    deadline: string;
  };
  idempotencyKey: string;
  envelopeDigest: string;
  grant: string;
};
```

Canonicalize every immutable envelope field except `grant` and
`envelopeDigest` with RFC 8785 JSON Canonicalization Scheme, SHA-256 that byte
encoding, and require it to equal `envelopeDigest`.
The grant claims must independently match `principalRef`, job ID, node ID,
capability, limits and input refs. The node's durable idempotency record is keyed
by `(principalRef fingerprint, idempotencyKey)` and stores the envelope digest,
lease and terminal manifest. An exact replay returns the same state/result; the
same principal/key with a different digest fails with
`IDEMPOTENCY_PAYLOAD_MISMATCH` before execution. A key from another principal
cannot retrieve, collide with or infer the first principal's record.

Delivery is at least once:

1. core offers a job;
2. node validates grant/capability/space and accepts a lease;
3. core marks placement/lease;
4. node sends heartbeat and ordered events;
5. cancellation is durable and acknowledged;
6. node uploads/commits outputs and sends a digest manifest;
7. core validates/adopts the manifest and acknowledges commit;
8. node retains retry metadata until acknowledgement;
9. duplicate offer returns the same terminal manifest or current lease state.

Node job events have monotonic sequence IDs. Core persists bounded operational
job state before publishing it to Web SSE. Conversation token/tool content obeys
the placement rule above and is not copied into job result/status columns. A
forged/out-of-order event cannot advance terminal state.

## Storage and transfer plane

### Storage provider

Introduce the exact provider contract in
`packages/agent-contracts/src/storage.ts`:

```ts
interface ObjectStorageProvider {
  readonly id: string;
  capabilities(): Promise<ObjectStorageCapabilities>;
  stat(input: ObjectStorageStatInput): Promise<ObjectStorageMetadata | null>;
  get(input: ObjectStorageGetInput): Promise<ReadableStream<Uint8Array>>;
  getRange(input: ObjectStorageRangeInput): Promise<ObjectStorageRange>;
  put(input: ObjectStoragePutInput): Promise<ObjectStorageCommit>;
  delete(input: ObjectStorageDeleteInput): Promise<ObjectStorageDeleteResult>;
  beginMultipart(input: MultipartBeginInput): Promise<MultipartHandle>;
  uploadPart(input: MultipartPartInput): Promise<MultipartPartReceipt>;
  completeMultipart(
    input: MultipartCompleteInput,
  ): Promise<ObjectStorageCommit>;
  abortMultipart(input: MultipartAbortInput): Promise<void>;
  copy?(input: ObjectStorageCopyInput): Promise<ObjectStorageCommit>;
  reconcile(
    input: ObjectStorageReconcileInput,
  ): AsyncIterable<ObjectStorageEntry>;
  authorizeTransfer(
    input: ObjectTransferGrantInput,
  ): Promise<ObjectTransferGrant>;
}
```

Adapt the current local/S3 behavior in
`apps/server/src/lib/storage-backend.ts`—including
`putStorageObject`, `readStorageObject`, `deleteStorageObject`,
`headStorageObject` and `signedStorageObjectUrl`—behind
`CoreObjectStorageProvider`. Keep those functions temporarily as a thin
compatibility facade that resolves the provider and delegates; no domain router
branches on `local | s3 | node`. Implement
`NodeObjectStorageProvider` against the node protocol and run the same contract
suite against core-local, core-S3, node-filesystem, Garage and opt-in real S3.
Delete the compatibility facade only after repository-wide call-site migration.

Required provider semantics:

- stat/head, get/range, put, delete;
- multipart/resumable begin/upload-part/complete/abort;
- server-side copy when advertised;
- list/reconcile only within an opaque owned prefix;
- checksums and exact byte/MIME metadata;
- short-lived single-object transfer authorization.

The node may back this with local filesystem, Garage or an external S3-compatible
store. Avermate keeps the object ledger, ownership, purpose, size and digest; the
node keeps bytes at the selected placement.

### Transfer lanes

Support and label three modes:

1. **Core relay** — universal NAT-friendly path; bytes transit the core relay but
   are not persisted there. Do not claim the core cannot see plaintext.
2. **Direct HTTPS** — optional node public/tunnel endpoint; core issues a
   short-lived one-object grant, exact origin CORS and digest/size constraints.
   No administrative node credential reaches the browser.
3. **End-to-end encrypted relay** — later/optional reviewed protocol where the
   browser encrypts to the paired node and the relay handles ciphertext. Do not
   market this property until key verification, replay, range/resume and recovery
   are implemented and audited.

Uploads complete in two phases: node object commit, then core file-row adoption
with matching digest/size. Orphan reconciliation handles either half failing.
Downloads use range support and revocable expiry. A disconnected node yields a
specific unavailable state, not a misleading 404.

## Conversation and retrieval placement

Implement adapters promised by plans 028/029:

- exactly one `ConversationStore` is canonical per thread. `CoreConversationStore`
  persists the DAG/events/checkpoints before core SSE for core placement;
  `NodeConversationStore` persists the DAG, events, context manifests,
  conversation checkpoints and usage content before sending relay frames for
  node placement;
- for node placement, core rows contain only owner/thread/placement/node IDs,
  created/updated timestamps, title-privacy policy, latest acknowledged event
  sequence and authorization/routing state. They contain no message body,
  model/tool delta, context manifest, citation payload or usage content;
- `NodeLexicalSearchBackend` is mandatory for every node corpus placement and
  must implement the plan-028 lexical/exact-locator conformance suite.
  `NodeVectorIndex` is optional ranking/recall augmentation. The router rejects
  new node corpus placement and marks existing retrieval degraded when lexical
  search is absent or unhealthy;
- a node thread cannot mix content placements implicitly; context transfer lists
  every source that would cross from core to node or vice versa;
- migration core↔node exports a versioned encrypted archive, verifies counts and
  digests, switches placement atomically and retains the source until user-
  confirmed verification/retention expires;
- node offline mode keeps metadata legible and retryable but cannot fabricate
  message/search bodies.

For reconnect/replay, the browser cursor is `(threadId, branchId, sequence)`.
Core authenticates it, forwards the bounded replay request to the owning node,
checks frame signatures/order/limits and relays returned frames without durable
content persistence. Node compaction must retain a replayable snapshot plus
events according to plan 029 retention. A missing node or expired node retention
returns an explicit `content_unavailable`/`history_expired` state, never an empty
successful transcript.

Define what minimal metadata the core stores (IDs, owner, placement, timestamps,
title policy). If the user selects “titles private,” store only an opaque/default
label centrally and fetch searchable titles from the online node.

## Inference and model placement

The node implements plan 026's model gateway contract and may route to:

- provider BYOK stored on the node;
- OpenAI-compatible Ollama/vLLM;
- optional node-local LiteLLM for routing/budgets;
- other reviewed adapters.

The manifest advertises tested per-model capabilities, not every model visible
from an endpoint. Record actual resolved model, usage and fallback on each run.
Keys never transit the core if configured locally. Domain tools still use
short-lived core grants.

## School connectors: seam now, execution later

The initial node release keeps school-service connections on the core. Define a
future `schoolConnectors` capability because users may reasonably choose to keep
school credentials local, but do not activate it until its threat model and
normalized facet conformance pass.

When implemented:

- credential placement is explicit and immutable without reconnect;
- node returns normalized preview/facet records plus stable IDs and completeness
  claims, never raw tokens/responses;
- core applies mappings, authority, provider-owned field locks and projections;
- node cannot write grades directly;
- the same network/pinned-origin rules apply locally;
- challenge/2FA continuation is job-bound and encrypted;
- moving a connection between core/node is a fresh authenticated reconnect, not
  credential export by default.

## Node daemon and visual configurator

### Repository shape

Create a separately buildable `apps/node` (or a clearly isolated equivalent)
with:

- headless daemon;
- local configuration API/UI;
- capability providers and job executor;
- migration/version manager;
- health/diagnostic CLI;
- Compose profiles and signed release image.

It must not import the core database or server router implementation. Share only
versioned contracts and provider-independent utilities.

Keep generated deployment assets at stable, reviewable paths:

- `infra/compose/avermate.yml` — validated profile-aware Compose source;
- `infra/node/config.schema.json` — generated-from-code public config schema;
- `avermate-node.yaml` — operator-local generated configuration, ignored by Git;
- an operator-selected secret file/store, never emitted into the YAML.

The existing root `deploy.yml` remains readable during migration and either
becomes a documented compatibility wrapper or is retired only after the same
full-self-host smoke suite passes against `infra/compose/avermate.yml`.

### Local-first setup UI

Before pairing, serve setup on loopback only with a one-time bootstrap secret.
The wizard:

1. explains deployment modes and data placement;
2. runs host preflight (OS/arch, disk, ports, Docker, TLS/tunnel, runtime,
   virtualization, GPU where selected);
3. selects a profile and optional external providers;
4. tests filesystem/S3/model/sandbox capabilities with non-secret probes;
5. writes config and secrets locally with restrictive permissions;
6. starts/reloads services;
7. displays pairing code/fingerprint;
8. verifies end-to-end health after pairing;
9. shows backups, updates and warnings.

Do not render generated secrets into avermate.fr, downloadable logs or a public
URL. A “Compose builder” produces a validated declarative profile and commands;
it cannot install privileged host runtimes from the browser.

The configurator is a privileged local control surface and must enforce all of
the following before parsing a mutating request:

- bind loopback only by default; validate `Host` against exact loopback hosts and
  the single explicitly configured TLS hostname. Reject IP/hostname changes,
  ambiguous ports, forwarded-host trust and DNS-rebinding targets;
- validate `Origin`/`Sec-Fetch-Site` against the exact configurator origin for
  every state-changing request. Use closed CORS (no wildcard, no reflected
  origin, no credentialed cross-origin requests) and reject WebSocket upgrades
  from other origins;
- use synchronizer CSRF tokens bound to the configurator session and rotate them
  after login/pairing/config writes. `SameSite` is defense in depth, not the only
  CSRF control;
- emit a restrictive CSP (`default-src 'self'`, no remote script/style/frame,
  `object-src 'none'`, `frame-ancestors 'none'`, constrained `connect-src`), plus
  `X-Content-Type-Options`, `Referrer-Policy: no-referrer` and no-store headers;
- never put the bootstrap secret in a URL, query, fragment, referrer, QR payload,
  access log or browser storage. Read it from the local terminal/secret file and
  exchange it once for a short-lived opaque session cookie that is `HttpOnly`,
  `SameSite=Strict`, path-scoped and `Secure` whenever TLS is used;
- rotate the session after privilege changes, expire bootstrap/session secrets,
  rate-limit and exponentially back off bootstrap, pairing and capability-test
  attempts, and invalidate all setup sessions once setup closes.

Test malicious Host headers, attacker-controlled DNS rebinding between requests,
cross-origin form/fetch/WebSocket requests, missing/stale CSRF tokens, bootstrap
replay, cookie fixation and CSP/resource injection. A custom public bind is an
advanced explicit mode requiring TLS and the same exact-origin policy; never
weaken these controls because the process is “only local.”

### Supported profiles

| Profile           | Services                                                | Host caveat                                               |
| ----------------- | ------------------------------------------------------- | --------------------------------------------------------- |
| `dev-zero`        | node + filesystem + direct providers, no active sandbox | simple Compose; no Garage required                        |
| `node-lite`       | node, local DB/job ledger, filesystem, models           | simple Compose                                            |
| `node-storage`    | node + single-node Garage + backup target               | simple Compose, no redundancy claim                       |
| `node-creator`    | storage + OpenSandbox + browser/LaTeX/media images      | gVisor/Kata installed on host separately                  |
| `node-local-gpu`  | creator + Ollama/vLLM                                   | GPU driver/runtime prerequisite                           |
| `node-observable` | chosen profile + OTel collector; optional Langfuse      | Langfuse is heavy/low-scale in Compose                    |
| `full-self-host`  | Web, API, DB, node, storage and selected execution      | personal/single-node profile, not hostile multi-tenant HA |

Existing development behavior remains: local uploads work with no Garage. The
wizard must never force storage infrastructure merely to use grades or test
chat with a direct API key.

## Full self-host composition

The complete profile runs core and node through the same protocol on a private
network/loopback pairing. It supports:

- local persistent libSQL or documented external DB;
- Web/API/auth/MCP;
- node data plane;
- filesystem or Garage/S3;
- direct/local model provider;
- optional OpenSandbox/runtime;
- reverse proxy/TLS and backups.

Provide development and production examples. Production multi-tenant claims
require Kubernetes/Kata, external durable queue/DB, HA object storage and
operator runbooks; do not imply one Compose file supplies that.

## Health, quotas and diagnostics

Per capability expose:

- configured/supported/healthy/degraded/offline;
- last success/error class/time;
- queue/load and concurrency;
- storage free/quota and object reconciliation;
- model/rate/token limits;
- sandbox isolation/runtime/image versions;
- protocol/build compatibility;
- backup recency where configured.

Safe diagnostics can be exported with IDs/hostnames/keys/content redacted.
Settings shows explicit consequences of disconnect: files/chats remaining on a
node are unavailable until migration/reconnect; they are not deleted.

## Upgrades, backup and recovery

- Signed, pinned images and release manifest.
- Node migrations are forward-only with pre-upgrade backup and tested restore.
- Rolling protocol compatibility spans at least the previous supported minor.
- Core does not dispatch incompatible capability jobs during upgrade.
- Back up node config/identity separately from object/chat/search data.
- Losing identity requires explicit repair/re-pair and proof of existing data;
  never auto-adopt objects from an untrusted replacement node.
- Disconnect, revoke and purge are separate operations with inventory/migration
  previews.

## Deletion, revocation and offline nodes

Track remote deletion independently from core access revocation:

```ts
type RemoteDeletionState =
  | "pending_remote_deletion"
  | "verified_deleted"
  | "revoked_unreachable"
  | "user_action_required";
```

On delete/purge, the core first creates an owned tombstone that blocks reads,
transfers, new grants, routing and resurrection, then handles bytes by placement:

- core-managed storage deletes and HEAD-verifies absence before
  `verified_deleted`;
- an online paired node receives a signed, nonce-bound deletion manifest of
  exact object/conversation/index/workspace refs and digests, deletes locally,
  verifies absence and returns a node-signed receipt. Core verifies identity,
  nonce, manifest digest and timestamp before `verified_deleted`;
- an offline node remains `pending_remote_deletion`; the signed deletion command
  is delivered through a deletion-only reconnect path. Revocation blocks all
  ordinary grants/jobs but may accept only this cleanup acknowledgement from the
  previously bound node identity;
- if that identity is revoked/lost before a verified receipt, record
  `revoked_unreachable`. If an external S3/filesystem/provider cannot produce a
  trustworthy absence proof, transition to `user_action_required` with exact
  operator instructions. Neither state may be called deleted.

The core may retain the minimal tombstone/manifest digest needed to prevent
resurrection and reconcile a later signed receipt, subject to the retention
policy; it must not retain the deleted content. Re-pairing a replacement node
does not inherit or satisfy another node's deletion command. Account export and
settings show pending/unverified remote deletion states.

## Tests

### Required repository entrypoints

Add checked-in cross-platform runners under `scripts/verification/` and expose
these exact root scripts:

```text
bun run verify:032:protocol
bun run verify:032:storage
bun run verify:032:configurator
bun run verify:032:selfhost
bun run verify:032:selfhost-airgap
bun run verify:032
```

- `verify:032:protocol` runs pairing, grants, canonical-envelope idempotency,
  compatibility and bounded control/stream-lane suites.
- `verify:032:storage` runs the `ObjectStorageProvider`, corpus lexical/citation
  and conversation-store conformance suites against Core and disposable Node
  placements, including migration and offline deletion receipts.
- `verify:032:configurator` runs loopback and TLS fixtures plus the full
  Host/Origin/CORS/CSRF/CSP/cookie/rate-limit/DNS-rebinding attack matrix.
- `verify:032:selfhost` boots each supported Compose profile in a clean
  temporary project, including `dev-zero` without Garage, and runs its declared
  smoke/capability checks.
- `verify:032:selfhost-airgap` starts the published full-self-host Compose
  profile on an egress-deny test network. It blackholes `avermate.fr`, configured
  telemetry collectors, billing providers and every managed endpoint to local
  fail-fast fixtures; academic CRUD, MCP, the BYOK/local-provider fixture,
  upload/search/chat with the local fixture model and export/delete must still
  pass. Packet/proxy/DNS evidence must show zero attempted connection to the
  blocked destinations. Billing, Avermate telemetry and managed components must
  be absent rather than merely configured with dummy keys.
- `verify:032` executes all five commands and fails on a missing binary,
  capability mismatch or skipped required scenario. Add a required
  `.github/workflows/plan-032-node-conformance.yml` using pinned images and no
  production credentials.

The air-gap check is a network assertion, not an environment-variable check. It
must run in plan 032's required CI before the full-self-host profile can be
called independent of avermate.fr; plan 034 re-runs the same command rather than
owning a later substitute.

### Protocol

- pairing replay/expiry/fingerprint mismatch/revocation/rotation;
- node reconnect and manifest change;
- at-least-once job delivery, duplicate offer and lease loss;
- canonical envelope digest verification; same principal/key/same digest replay;
  same principal/key/different digest rejection; cross-user/client/node
  idempotency isolation;
- event ordering, cancellation and terminal acknowledgement;
- high-frequency lane sequence/ack replay, per-stream fairness, bounded buffers,
  slow-browser backpressure and cancellation without starving control frames;
- expired/wrong-audience/wrong-resource capability grants;
- previous-minor compatibility and unknown capability fields.

### Routing/failures

- every capability placement/fallback combination;
- node offline before/during upload, model stream and sandbox job;
- no silent paid fallback;
- mixed placement context-transfer preview;
- core-only grades remain available with the node down.

### Storage/data

- single/multipart/range/copy/delete and checksum mismatch;
- orphan object/file-row reconciliation;
- direct and relay transfer authorization;
- conversation/search migration count/digest round-trip;
- node conversation persistence-before-relay, reconnect replay from cursor and
  zero durable message/tool/context content in core node-placement rows;
- node offline replay returns explicit unavailable/expired state;
- node retrieval placement is rejected or degraded without a conforming lexical
  backend even when a vector index is healthy;
- cross-user/node/object denial;
- `ObjectStorageProvider` conformance against core filesystem/S3,
  node-filesystem, Garage and real S3 opt-in; compatibility facade produces the
  same bytes/digests/errors;
- offline deletion queues, revocation without receipt, deletion-only reconnect,
  forged/replayed/wrong-node receipt, external unverified deletion and eventual
  verified receipt without resurrection.

### Configurator/full self-host

- fresh `dev-zero` setup with no Garage;
- preflight truthfully rejects missing gVisor/Kata/GPU/KVM;
- secrets absent from browser output/log bundle;
- Host/Origin/CORS/CSRF/CSP/cookie/rate-limit and DNS-rebinding attacks fail
  closed in both loopback and explicitly configured TLS modes;
- backup/restore and upgrade rollback drill;
- full self-host smoke: auth, grade, upload, read chat, one sandbox artifact.
- full self-host air-gap: the same core flows pass with avermate.fr, telemetry,
  billing and managed endpoints blocked, with zero attempted egress to them.

### Commands

```powershell
bun run --cwd packages/agent-contracts test
bun run --cwd apps/node test
bun run --cwd apps/server test src/node
bun run --cwd apps/web test src/components/settings/node
docker compose -f infra/compose/avermate.yml --profile dev-zero config
docker compose -f infra/compose/avermate.yml --profile full-self-host config
bun run format:check
bun run lint
bun run check-types
bun run test
bun run build
```

## Phased delivery

1. protocol/identity/manifest/health with a mock node;
2. `dev-zero` daemon and outgoing channel;
3. node filesystem storage plus relay transfers;
4. visual configurator and backup/update path;
5. model gateway and node conversation store;
6. retrieval/index placement;
7. plan 031 sandbox dispatch;
8. optional direct/E2E transfer modes;
9. full-self-host profile;
10. school connector placement only after separate activation review.

Each phase must be usable/degradable and retain the same contracts.

## Done criteria

- The node connects outbound, pairs securely and advertises truthful capabilities.
- ExecutionRouter routes each capability explicitly with no silent fallback.
- Files, chats, retrieval, models and sandbox can be placed independently where
  implemented.
- Node outage does not break academic core or erase configuration.
- `dev-zero` works without Garage; creator profiles report host prerequisites.
- Browser/core/node never receive one another's long-lived administrative keys.
- Storage/job/conversation migrations use digests and recover from half commits.
- Node job idempotency is bound to canonical envelope digest and principal.
- Node corpus placement always has a conforming lexical backend.
- Offline/revoked deletion is reported as pending or unverified until a valid
  signed receipt proves completion.
- Full self-host uses the same node protocol, not a forked application.
- `bun run verify:032:selfhost-airgap` proves that full self-host has no runtime
  dependency on avermate.fr, billing, managed workers or operator telemetry.
- Docs state clearly when bytes transit core and when E2E/direct transfer applies.

## STOP conditions

- Hosted core must connect directly to an arbitrary user-provided/private URL.
- A browser receives node administration credentials.
- Node gets direct database access or an unscoped user session.
- Pairing uses a reusable long-lived code/token.
- Protocol assumes exactly-once delivery without idempotency.
- Core changes object/thread placement while the source copy is unverified.
- Configurator claims to install or guarantee privileged host isolation it did
  not verify.
- A privacy claim says core cannot see relayed plaintext when it can.

## Maintenance

Publish a protocol compatibility matrix and conformance kit. Pin daemon and
worker images, sign releases, rotate pairing material, run scheduled object/job
reconciliation and alert on unsupported builds. New capabilities begin disabled,
declare their own version/limits and pass the same grant, routing, failure and
privacy review before appearing in the configurator.
