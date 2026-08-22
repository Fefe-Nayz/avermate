# Plan 038: Complete Avermate Node, full self-host lifecycle and specialist workers

> **Executor instruction**
>
> Read plan 032 as the protocol source of truth, then plans 031, 033, 035–037,
> `docs/avermate-node-protocol.md`, `docs/self-hosting.md`, every contract under
> `packages/agent-contracts`, and the existing `apps/node` implementation. This
> plan closes the product/distribution gaps; it must consume the 032 protocol and
> existing storage/conversation/model/sandbox seams rather than build a parallel
> “self-host edition.” Implement both hosted-Core + custom-Node and full-self-host
> Web flows. Do not include React Native or give any browser a Docker socket.

## Status

- **Status**: DONE (repository/Web) — repository aggregate and hosted Node
  lifecycle Chromium gate pass; LIVE BLOCKED — strict `verify:038:live`
  service/image attestation remains external
- **Priority**: P0
- **Effort**: XL / multi-release
- **Risk**: CRITICAL
- **Depends on**: 025–033 and 035–037 as capability consumers
- **Blocks**: honest self-host release and Node placements in production
- **Category**: distributed systems, self-hosting, execution, lifecycle, Web
- **Planned at**: 2026-08-22, branch `rewrite`
- **Evidence baseline**: `15a8897ce1eb82c2807f5547d9f558a59ad9a2e1`

### Repository closure amendment — 2026-08-22

The Core now uses libSQL repositories for Node object adoption, signed remote
deletion and provider-native runtime checkpoint metadata. Artifact promotion
adopts into the canonical file ledger before publishing the graph revision,
then tombstones and deletes the Node source through the authenticated relay.
Reconnect reconciles pending adoptions, deletion receipts and
captured/expired runtime checkpoint records. These checkpoints remain
owner/node/logical-snapshot bound and never replace a conversation checkpoint.

Node-owned corpus bodies now follow the same no-plaintext-mirror rule. Core
keeps authorization, immutable locators and hashes plus an AES-256-GCM recovery
envelope bound to owner/node/source/version/chunk identity; normal reads use the
signed `lexical.get-chunks` relay and fail closed offline. Core reauthorizes
every Node lexical candidate and reconstructs its snippet from a hash-verified
body. Core→Node, Node→Node and Node→Core migrations rewrite the recovery payload
inside a transaction-scoped immutable-row lease, verify exact destination
digests before switching placement, and a startup reconciler seals legacy rows
only after an identical canonical Node readback.

The loopback configurator covers the complete public schema, secret-vault,
pairing, validate/apply/rollback, preflight and deployment-preview flows. Its
persistent FR/EN selector localizes static copy, generated fields and runtime
messages. `verify:038:server` includes the SQL crash/ownership/expiry suites;
the repository aggregate reruns Plan 032 protocol, non-Docker storage contracts
and configurator gates, then complete agent-contract, Node and sandbox-worker
test suites plus focused server migration/placement/media tests.
Docker/provider evidence remains solely in the strict live gate.

The production Node entry now constructs the official OpenSandbox SDK adapter
when the reviewed profile supplies a runtime endpoint, external evidence
endpoint and exact host/runtime metadata. OpenCode/OpenHands logical snapshots
are content-addressed and owner-bound in Node storage; native checkpoints remain
separate provider state. Capability and job advertisement re-runs evidence
preflight and fails closed. Full self-host relay uses one exact signed and
credentialed Compose-internal `ws://api:5000/api/node/control` exception; all
remote profiles remain HTTPS/WSS-only.

## Outcome

Deliver one installable system supporting all six product modes through the same
contracts:

1. hosted academic Core only;
2. hosted Core + external MCP client;
3. hosted Core + BYOK providers;
4. hosted Core + paired user-owned Avermate Node;
5. optional managed capabilities;
6. complete self-host of Web, Core, Node and selected capability providers.

A non-expert can use a loopback-only visual configurator to choose storage,
models, embeddings/reranking, sandbox and creator profiles, inspect consequences,
pair with avermate.fr or generate a full-self-host deployment, verify it, back it
up, upgrade it and restore it. The browser never sees long-lived Node/provider
secrets and never runs arbitrary privileged commands.

The previously “optional” implementation seams are mandatory deliverables here:

- a real LiteLLM gateway profile and `LiteLLMProxyGateway` adapter for users or
  operators who select consolidated model routing/budgets;
- bounded OpenCode and OpenHands specialist-worker adapters for reviewed coding/
  artifact tasks inside attested sandboxes;
- provider-native runtime checkpoint capability where a conforming provider
  supports it, stored separately from conversation checkpoints and logical
  workspace snapshots;
- full model/retrieval/rerank/sandbox/job transports through Node;
- complete Web placement/pairing/status/lifecycle UI.

None becomes the source of truth for conversations, domain authorization or
academic data.

Here and in plan 035, “optional” describes activation and deployment profile
only. LiteLLM plus both specialist adapters are implemented/tested deliverables;
operators may leave their cells disabled without making them unimplemented.

## Current-state evidence and gaps

1. Plan 032 and `docs/releases/plan-032-evidence-2026-08-22.md` prove protocol,
   local providers, configurator security and static Compose cells, but list
   production pairing/relay/transports, durable adoption and storage-facade
   migration as gaps.
2. `apps/node/src/config.ts:30-61` already models filesystem/S3 storage, relay,
   models and sandbox with secret references. Extend this schema; do not invent a
   second config format.
3. `apps/node/src/control-channel.ts:225-308` implements an outbound WSS client,
   but Core has no production `/api/node/control` relay that completes its
   lifecycle.
4. `apps/node/src/daemon.ts:102-128` rejects every job offer with
   `NODE_JOB_EXECUTOR_NOT_ADVERTISED`.
5. `apps/node/src/daemon.ts:160-169` reports conversations/retrieval/models/
   sandbox as unactivated even though contract/test adapters exist.
6. `apps/node/src/configurator.ts:35-50` renders only a profile selector and
   preflight/pair buttons. The `/api/setup/config/apply` endpoint exists at
   lines 116–156, but the browser does not configure or apply storage, models,
   retrieval, sandbox, Compose, backup or upgrades.
7. `infra/node/profiles/full-self-host.yaml:5-12` leaves relay empty and models/
   sandbox disabled. `infra/compose/avermate.yml:108-140` starts Node and API but
   still points API storage at local Core.
8. `apps/node/src/cli.ts:3-28` exposes only `doctor`; backup/restore/upgrades are
   manual documentation.
9. Current full-self-host verification explicitly accepts a disabled sandbox and
   the Docker host is presently unavailable with a content-store I/O error.
   Static evidence is not a live release proof.
10. The repository has `ModelGateway`, `SandboxProvider`, durable jobs,
    `ObjectStorageProvider`, conversation/corpus adapters and placement routing.
    Reuse them.

## Mandatory drift check

```text
git rev-parse HEAD
git status --short
rg -n "NODE_JOB_EXECUTOR_NOT_ADVERTISED|provider-not-activated" apps/node/src
rg -n "/api/node/control|pairing|capabilit" apps/server/src apps/node/src packages/agent-contracts/src
rg -n "config/apply|backup|restore|upgrade" apps/node/src apps/web/src docs/self-hosting.md
rg -n "LiteLLM|OpenCode|OpenHands|sandboxRuntimeCheckpointRef" . --glob '!node_modules/**'
bun run verify:032:protocol
bun run verify:032:configurator
bun run verify:032:selfhost-airgap
```

Record Docker/host capability separately. STOP and update the plan if the 032
protocol major version, placement authority or secret model changed.

## Architecture invariants

- Hosted Core remains authoritative for accounts, academic data, global policy
  and Node registrations. Full self-host uses the same Core implementation.
- A Node establishes an outbound authenticated channel. Hosted Core never scans
  the user's LAN, opens inbound ports on their machine or contacts arbitrary
  private URLs.
- Pairing is one-use, short-lived, user-confirmed and bound to a generated Node
  Ed25519 identity plus Core account. Rotation and revocation are first-class.
- Capability manifests are signed, revisioned, bounded and revalidated at
  dispatch. Availability never implies authorization.
- Durable object/conversation/index ownership is explicit per object. Offline
  produces `node-unavailable`; there is no silent Core copy or managed fallback.
- Browser Web code receives redacted capabilities and status only. Secrets stay
  in the loopback configurator/Node secret store or sealed Core BYOK store.
- No Web/API/Node component receives the Docker socket. The configurator emits
  validated declarative files and exact commands for the human/operator.
- `conversationCheckpointRef`, logical `workspaceSnapshotRef`, provider-native
  `sandboxRuntimeCheckpointRef` and `domainCursorRef` remain separate histories.
- A runtime checkpoint is an optional optimization tied to exact provider/image/
  profile/architecture. Logical workspace snapshots remain the portable truth.
- LiteLLM, OpenCode and OpenHands are adapters/workers. They cannot own domain
  policy, message history, tool definitions, credentials or source files.
- Full self-host release artifacts are digest-pinned, signed, SBOM-backed and
  installable offline. `latest`/local mutable tags do not count.

## In scope

- Production Core Node registry, pairing and outbound relay.
- Every advertised capability lane: storage, conversations, corpus/retrieval,
  embeddings/rerank, models, jobs, sandbox and artifact workers.
- Durable two-phase object adoption/deletion and remaining storage call-site
  migration.
- LiteLLM, OpenCode and OpenHands bounded integration.
- Runtime checkpoint contract and at least one real conforming provider cell.
- Loopback configurator, hosted Web settings and full-self-host Web onboarding.
- Compose profiles, offline bundle, diagnostics, backup/restore and N−1 upgrade.
- Threat tests, live conformance and operator documentation.

## Out of scope

- Kubernetes/HA as a requirement for personal single-node self-host.
- Claiming hostile multi-tenant isolation for Docker/runc personal profiles.
- Arbitrary Compose generation, arbitrary shell, IDE replacement or autonomous
  repository deployment.
- Hosting school credentials on Node by default before a separate policy
  decision; the capability seam may be implemented without moving them.
- Billing/checkout.
- React Native.

## Implementation sequence

### 1. Complete Core Node registry and pairing

- Add append-only Core tables for Node identity, account binding, pairing claim,
  credential generations, capability manifests, connection epochs, revocation
  and last verified health. Store public keys and sealed/hashed credentials only.
- Implement authenticated Core APIs for create pairing intent, confirm displayed
  Node fingerprint/capabilities, rotate, revoke, list and inspect status.
- Complete the loopback Node pairing exchange. A pairing code may be consumed
  once, expires quickly, cannot authorize a different account/Node key and is
  removed from logs/browser history.
- Issue independently rotatable relay and capability credentials with overlap
  windows. Revocation terminates active channels and blocks replay immediately.
- Audit every lifecycle transition without secret/body logging.

### 2. Implement the production outbound relay

- Add the versioned Core WSS endpoint expected by `control-channel.ts`, behind
  normal TLS/auth/rate limits and connection epoch fencing.
- Authenticate the Node handshake, negotiate protocol/capability revisions and
  reject downgrade, duplicate-primary and revoked identities.
- Persist only routing/sequence/ack metadata for Node-owned conversations/objects;
  no durable plaintext mirror.
- Implement bounded request/response and ordered stream lanes with operation IDs,
  deadlines, cancellation, reconnect replay and backpressure.
- Make duplicate/reordered frames idempotent and reject gaps beyond the retained
  replay window with a typed resynchronization outcome.
- Add heartbeat/offline state without declaring failure from one transient missed
  ping.

### 3. Activate every Node capability transport

- **Storage**: filesystem, Garage/S3 and external S3 providers through the same
  object contract; range/read/write/delete, digest verification, quotas and
  placement-bound opaque handles.
- **Conversations**: canonical Node store, durable event append/replay, branch/
  export/delete and explicit offline behavior.
- **Corpus**: lexical store and exact owner-bound chunk reads are mandatory;
  vector/embedding/rerank spaces are advertised only when ready. Route plan-036
  operations with owner/source grants. Node placement keeps no readable Core
  body or FTS mirror and never uses its encrypted recovery envelope offline.
- **Models**: OpenAI-compatible local/BYOK model catalogue, stream normalization,
  usage and cancellation through plan 035.
- **Sandbox**: exact plan-031 profiles, images, evidence and artifacts through
  lifecycle calls; no raw host executor.
- **Jobs**: advertise only registered deterministic handlers. Replace
  `NODE_JOB_EXECUTOR_NOT_ADVERTISED` with a durable lease/renew/cancel/complete
  implementation and fail closed for unknown kinds/versions.
- Bind all dispatch to manifest revision, owner, capability, operation, resource
  limits and current credential generation.

### 4. Finish durable adoption and deletion

- Implement the production Core `ObjectAdoptionRepository` and reconciliation
  worker using the existing two-phase contract.
- Migrate all selected file/corpus/checkpoint/artifact writers from Core-local
  assumptions to the storage facade. Catalogue call sites and fail the gate when
  an unclassified direct provider call is added.
- Fence crash windows: reserve, upload/commit, verify digest, adopt DB reference,
  acknowledge. Orphan/lost-ack cases reconcile without duplicate canonical rows.
- Deletion tombstones first, delivers a nonce/manifest-bound command and becomes
  complete only after a valid receipt; revoked/offline is visible and retryable.
- Export includes placement/object relationships without granting raw bucket or
  filesystem access.

### 5. Implement LiteLLM as a real selectable profile

- Add a digest-pinned LiteLLM service/profile and minimal database/secret
  dependencies needed for virtual keys, budgets and routing.
- Implement `LiteLLMProxyGateway` behind Avermate `ModelGateway`, with exact model
  alias/revision mapping, owner/tenant virtual-key issuance, normalized usage,
  request IDs, cancellation and error redaction.
- Core/Node hold the LiteLLM admin credential; browser and sandbox receive only
  scoped short-lived access if the architecture requires it.
- Persist Avermate's authoritative entitlement/reservation/usage records even
  when LiteLLM also applies budgets. Reconcile, do not trust proxy spend as sole
  billing authority.
- Add direct-provider parity tests and a configurator choice. LiteLLM remains out
  of the default zero-config development loop and is never required for BYOK or
  local models.

### 6. Implement bounded OpenCode and OpenHands workers

- Pin reviewed versions and licenses in dependency documentation and immutable
  worker images. No runtime self-update or plugin download.
- Define narrow specialist manifests, initially:
  - create/revise a code-backed educational artifact in `/workspace`;
  - run reviewed tests/renderers;
  - return a manifest/diff/log/artifact bundle for visual/user review.
- Start from an exact logical workspace snapshot in an attested sandbox. Mount no
  repository or account secret by default.
- Expose only the scoped ToolBroker capabilities explicitly granted to the job;
  no raw academic DB, MCP admin token or arbitrary network credential.
- Enforce path roots, command/resource/egress budgets, dependency lock policy and
  artifact adoption. All external changes require plan-030 approval.
- Normalize worker progress/tool/status into the same agent events. Do not import
  OpenCode/OpenHands session history as the Avermate conversation.
- Conformance fixtures must prove cancellation, restart, malicious path/symlink,
  secret access, network denial, oversized output and deterministic adoption.

### 7. Implement provider-native runtime checkpoints

- Extend `SandboxProvider` capability discovery with runtime checkpoint create,
  restore, delete and compatibility metadata.
- Persist `sandboxRuntimeCheckpointRef` separately with provider, region,
  architecture, runtime/image/profile digests, source workspace snapshot,
  capture state, expiry and adopted object references.
- Require a committed logical workspace snapshot before capture. On restore,
  verify exact compatibility; otherwise start a fresh sandbox from the logical
  snapshot.
- Runtime checkpoint failure never corrupts the conversation or portable
  workspace. Expiry/GC is independent and auditable.
- Pass one live provider conformance cell. A provider without the feature reports
  unavailable and uses the logical path; mocks do not satisfy release evidence.

### 8. Build the complete local configurator

- Drive forms from the versioned Node config schema: profile, data paths,
  Core/pairing, filesystem/Garage/external S3, model endpoints, embedding/rerank,
  LiteLLM, sandbox runtime, worker images, observability and resource limits.
- Store secret values directly in the Node secret store and write only secret
  references to config. Redact previews, responses and logs.
- Add real validate/preflight/apply flow, change preview, restart-required state
  and rollback to last valid config. Applying config does not invoke Docker.
- Probe storage, model, embedding, rerank and sandbox endpoints with minimum safe
  operations and explicit outbound destinations.
- Generate validated profile/override/env files plus exact operator commands,
  checksums and warnings. Do not emit arbitrary YAML keys or shell fragments.
- Bind to loopback, require bootstrap/session/CSRF, rotate bootstrap secret and
  disable setup mode after completion unless locally re-enabled.

### 9. Build hosted and self-host Web management

- Add Settings → Avermate Node for pairing, fingerprint confirmation,
  capabilities, placements, connection health, credential rotation/revocation,
  pending deletions and diagnostics.
- Add per-capability placement controls with consequences: where durable data
  lives, which provider sees content, offline behavior, cost and migration plan.
- Add migration wizards for supported Core↔Node moves with inventory, space,
  progress, pause/retry, validation and no silent fallback.
- In full self-host, add an onboarding/readiness page using the same APIs; do not
  assume avermate.fr.
- Render missing Node/provider states throughout materials, search, assistant and
  artifact UI with actionable links, not generic 500 errors.
- Add complete loading/empty/error/offline/revoked/upgrade-required states,
  accessibility and responsive Web coverage.
- Localize both hosted Web management and the standalone loopback configurator.
  The latter persists FR/EN in browser storage and must translate schema-driven
  labels, validation errors and action results, not only its navigation shell.

### 10. Produce release profiles and offline bundle

- Finalize `dev-zero`, `node-lite`, `node-storage`, `node-byok`, `node-local-ai`,
  `node-creator`, `node-observable` and `full-self-host` as schema-validated
  compositions.
- Full self-host must actually route at least storage, conversations/retrieval,
  model and one sandbox artifact through Node; “container present but disabled”
  is not completion.
- Pin every image by digest and model by immutable revision. Generate SBOM,
  provenance/attestation and signed release manifest.
- Build an offline bundle containing exact images, migrations, Web assets,
  configuration schema, required model metadata or optional selected weights,
  verification scripts and checksums.
- The air-gap install must make zero request to avermate.fr, managed billing,
  telemetry or public registries after bundle import.

### 11. Add lifecycle CLI and operator flows

Extend the bounded Node CLI with:

- `doctor [--json]`;
- `backup plan|create|verify`;
- `restore plan|apply|verify` to an empty target only;
- `upgrade plan|apply|verify` with exact N−1 support;
- `bundle verify|import`;
- `config validate|show-redacted`;
- `identity rotate` through a confirmed procedure.

Backups coordinate Core DB, object inventory/bytes, corpus/conversations,
artifact/snapshot metadata, Node identity/config and required encryption/signing
keys. They are encrypted, checksummed and restorable without network. Upgrades
create/verify a backup first, run append-only migrations fail-closed, verify all
capabilities before traffic and preserve a documented recovery path.

## Verification matrix

Keep every plan-032/031/033 gate, harden them so unavailable/mock cells cannot
satisfy live requirements, and add `verify:038:*` gates for pairing, relay,
capabilities, LiteLLM, workers, checkpoints, configurator, lifecycle, fullself and
airgap.

The repository aggregate uses complete deterministic suites for
`packages/agent-contracts`, `apps/node` and `apps/sandbox-worker`. Its server
cells select the whole `src/node` suite plus custom-MCP transport/migration,
append-only migration history/prefix upgrades, placement migration, signed
grants, OCR/transcription providers and the materials/recordings integration
paths. This intentionally captures newly added tests without enumerating a list
that can silently become stale. No `*:live`, provider-evaluation, Docker
conformance or operator-evidence command is part of this aggregate.

Mandatory scenarios:

- one-use pairing, account/fingerprint mismatch, expiry, replay, rotation,
  revocation during an active stream and reconnect;
- WSS order/ack/gap/backpressure/cancel/deadline and protocol downgrade attacks;
- storage/conversation/corpus/model/rerank/sandbox/job contract suites over the
  real relay, including Node offline and no fallback;
- corpus Core→Node→Node→Core placement, authenticated envelope tamper/AAD,
  legacy sealing, candidate reauthorization and exact body-hash suites;
- two-phase adoption/deletion crash windows and durable reconciliation;
- LiteLLM direct-gateway parity, virtual-key isolation, budget mismatch and
  authoritative usage reconciliation;
- OpenCode/OpenHands bounded workspace/artifact jobs and hostile input suite;
- logical snapshot + live runtime checkpoint restore/fallback/expiry;
- browser configurator applies a real config with no secret in HTML/network/logs;
- hosted Web pairing/placement/migration/revocation E2E;
- full-self-host auth, academic CRUD, upload/range/delete, OCR/index/search/
  rerank/citation, chat stream/branch, approved mutation and sandbox artifact;
- backup seeded data, destroy disposable environment, restore empty environment,
  compare digests and Node identity; tamper/non-empty restore rejection;
- N−1 populated upgrade and injected pre/post-migration failures;
- offline bundle install plus live network monitor proving zero external attempt.

Run root format/lint/types/tests/build, full migration history/prefix/legacy
fixtures, release guard and image/SBOM/signature verification on the exact release
candidate.

`verify:038:live` is fail-closed. Run it from a clean checkout whose `HEAD`
equals `EXPECTED_NODE_RELEASE_REVISION`, set the six explicit health URLs and
`PLAN038_LIVE_CONFIRM=strict-real-services`, and point
`PLAN038_LIVE_EVIDENCE` at the operator manifest. Every mandatory scenario above
must have a current `deployed-drill` or `external-attestation` record bound to
that release and environment digest, with named run/attestor and a local
artifact whose SHA-256 is verified by the gate. Health endpoints alone are not
release evidence.

## STOP conditions

STOP, preserve evidence and request authorization if:

- hosted Core must call a private arbitrary endpoint or the Node needs inbound
  Internet exposure;
- a long-lived credential/admin key enters browser state, logs, public YAML,
  sandbox environment or artifact;
- implementation bypasses the signed 032 manifest/placement router;
- a Docker socket or privileged installer would be exposed to Web/API/Node;
- OpenCode/OpenHands require unrestricted host/repository/network access;
- a runtime checkpoint is treated as portable truth or conversation history;
- a release claims isolation with runc/mock/disabled rather than the required
  live attested provider/profile;
- backup cannot guarantee DB/object/identity consistency or restore would
  overwrite a non-empty target;
- upgrade needs `db push`, rewritten migration history or proceeds without a
  verified backup;
- air-gap verification is static only or contacts an undeclared external host;
- license/notices do not permit distribution of the selected project/images/
  model weights.

## Definition of done

- A user can pair/revoke a Node from the hosted Web UI and every advertised
  capability works through the production outbound relay with explicit offline
  behavior.
- Full self-host routes real user flows through Node rather than shipping
  disabled placeholder services.
- Gemini/local embeddings and cloud/local rerankers from 036, model inference,
  conversations, files and sandboxes can be placed independently and are shown
  truthfully in Web.
- LiteLLM is installable/configurable/tested as a selectable gateway while direct
  and Node-local providers still work without it.
- OpenCode and OpenHands each complete at least one bounded, attested specialist
  artifact workflow without becoming the harness or domain authority.
- One real provider-native runtime checkpoint passes compatibility, restore and
  fallback conformance; logical snapshots remain portable.
- The configurator, profiles, signed offline bundle, backup/restore and N−1
  upgrade pass reproducible live gates on the exact release artifacts.
- Documentation states security levels and unavailable capabilities honestly;
  no mock, static parse or disabled cell is promoted to production evidence.

## Maintenance trigger

Re-run protocol, provider, worker, checkpoint, backup/restore, upgrade and air-gap
conformance when any Core/Node protocol, image/model digest, secret schema,
capability contract, Compose profile, Docker/runtime version or dependency
licence changes.
