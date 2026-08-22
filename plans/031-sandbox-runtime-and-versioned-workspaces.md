# Plan 031: SandboxProvider, isolated workers and versioned agent workspaces

> **Executor instructions**: Read plans 026/027, the completed conversation
> checkpoint store from 029 and the provider security docs linked by the accepted
> ADR. Implement the disabled/mock provider and common
> conformance suite before any real runtime; update the 031 row in
> `plans/README.md` only when the advertised deployment profiles pass their own
> isolation gates. Do not weaken host policy, push or open a PR unless requested.
>
> **Drift check (run first)**:
>
> ```text
> git diff --stat <plan-025-baseline>..HEAD -- packages/agent-contracts apps/server/src/sandbox apps/server/src/jobs apps/server/Dockerfile infra deploy.yml package.json bun.lock
> ```
>
> Reconcile any changed execution, storage, queue or image behavior; stop if the
> environment cannot truthfully enforce the profile's claimed isolation.

> [!IMPORTANT]
> Pyodide fences and a locked-down Tectonic command are useful specialized
> renderers; they are not a general agent computer. No model-generated Python,
> shell, browser session, Manim scene, package install or media command may run
> in the API process or its container.

## Status

- **Status**: DONE (repository) — LIVE BLOCKED until an attested provider,
  pinned images and host-policy evidence are available
- **Priority**: P1
- **Effort**: XL
- **Risk**: CRITICAL
- **Depends on**: 026, 027 and 029
- **Blocks**: workspace-aware mutations in 030, execution capabilities in 032
  and advanced pipelines in 033
- **Category**: execution plane, isolation, storage, jobs
- **Planned at**: 2026-08-22
- **Planning baseline**: plan 025 baseline SHA

### Implementation checkpoint (2026-08-22)

The provider/job/workspace contracts, disabled and mock paths, durable snapshot
ledger, admission policy and the official OpenSandbox SDK transport are present.
The production dependency is pinned as `@alibaba-group/opensandbox@0.1.11`;
provider construction is wired through the environment-aware factory. The full
repository sandbox suite passes **42 tests with 0 failures**, including SQL
snapshot durability, profile/image attestation policy, artifact adoption and
provider transport behavior. The checked-in `sandbox:conformance` entrypoint
fails closed rather than treating a mock or disabled provider as production
evidence.

There is currently no configured live OpenSandbox control plane with pinned
profile images and an external, host-produced baseline-evidence endpoint. As a
result, no real isolation profile has passed the required attested conformance
suite in this checkout. Unit mocks prove contract behavior only. E2B and
Microsandbox also have no activated production transport here. No workload may
be advertised as securely sandboxed, and no mock result may satisfy plan 031's
live gate, until those provider/image/host-policy inputs exist and the full
conformance report is recorded.

Plan 025's repository-wide type, lint, format, release-security and migration
gates are green independently of this activation boundary. Its maintainer
licence decision and a post-commit clean-clone rerun remain external release
evidence.

## Scope

**In scope**: provider/job contracts, disabled/mock and three provider adapters,
versioned workspace lifecycle, reviewed execution profiles, package/LaTeX bundle
resolution, artifact adoption, resource/egress/secrets policy and common
conformance tests.

**Out of scope**: a home-grown Firecracker control plane, long-lived VM per
conversation, node pairing/routing (032), browser/media product behavior (033),
managed billing (034) and any general execution inside the API/Web process.

## Selected provider strategy

| Deployment                       | Default                                            | Notes                                                                  |
| -------------------------------- | -------------------------------------------------- | ---------------------------------------------------------------------- |
| development, no active execution | `DisabledSandboxProvider`                          | chat/search work; every execution request is refused                   |
| developer trusted spike          | OpenSandbox + Docker/runc                          | baseline required; never claim a stronger multi-tenant kernel boundary |
| personal self-host creator node  | OpenSandbox + gVisor, or experimental Microsandbox | host preflight required; Microsandbox remains pre-1.0                  |
| multi-tenant self-host/managed   | OpenSandbox + Kata on Kubernetes                   | gVisor only after egress compatibility review                          |
| managed sandbox service          | E2B adapter                                        | avoids operating Firecracker infrastructure                            |

Do not build a raw Firecracker control plane. Do not select Daytona as the OSS
self-host default: its public core repository is no longer maintained. OpenCode
and OpenHands may run _inside_ or use a sandbox, but neither implements this
provider boundary.

## Separation of responsibilities

```text
AgentRuntime       decides the next bounded step
ToolBroker         authorizes Avermate/domain actions
JobScheduler       leases, retries, cancels, meters and reports work
SandboxProvider    isolates active code/browser/process/filesystem/network
ObjectStore        persists input snapshots and adopted outputs
ActionLedger       records domain effects and compensation
```

The harness itself can run in a trusted worker/node. Only active untrusted
execution enters a sandbox. A sandbox receives no database connection, auth
cookie, storage administrator credential or provider key.

## Core contracts

### Sandbox provider

```ts
interface SandboxProvider {
  capabilities(): Promise<SandboxCapabilities>;
  preflight(input: SandboxPreflightInput): Promise<SandboxPreflightResult>;
  create(input: CreateSandboxInput): Promise<SandboxHandle>;
  execute(input: ExecuteSandboxInput): AsyncIterable<SandboxEvent>;
  putFiles(input: PutSandboxFilesInput): Promise<void>;
  getFiles(input: GetSandboxFilesInput): Promise<SandboxFileManifest>;
  snapshotWorkspace(
    input: SnapshotWorkspaceInput,
  ): Promise<WorkspaceSnapshotRef>;
  forkWorkspace(input: ForkWorkspaceInput): Promise<SandboxHandle>;
  stop(input: StopSandboxInput): Promise<void>;
  destroy(input: DestroySandboxInput): Promise<void>;
}
```

`execute` accepts an executable plus an argv array selected by a first-party
profile. It does not accept a shell command string. If an optional coding worker
needs a shell internally, that worker is itself a bounded sandbox workload and
cannot receive core credentials or arbitrary host mounts.

### Mandatory `UntrustedSandboxBaseline`

Define one versioned `UntrustedSandboxBaseline` contract in
`packages/agent-contracts` and require it for **every** enabled workload and
execution profile: LaTeX, Python, browser, slides, media, Manim, coding workers,
dependency/image builders and future profiles. A workload is not exempt because
its command is first-party, its input looks harmless, it runs on a personal node
or its provider is labelled trusted development. Providers may add stronger VM
or kernel isolation, but may not remove baseline controls.

Baseline version 1 requires, at minimum:

- a numeric non-root UID/GID, `privileged = false`, no setuid/setgid escalation,
  no ambient privileges and `no-new-privileges` enforced;
- an immutable image selected by digest and a read-only root filesystem;
- every Linux capability dropped, with any narrowly required capability treated
  as a new reviewed baseline version rather than a per-job override;
- isolated PID, mount, IPC, UTS, network, user and cgroup namespaces (or a
  capability-tested stronger VM boundary), with no host namespace sharing;
- no host path, container-engine/runtime socket, device, Docker/Podman socket,
  Kubernetes service-account token or arbitrary mount. Inputs are copied into a
  read-only owned area and writes are limited to the isolated workspace volume;
- a minimal, read-only/masked `/proc` and `/sys`; no access to host processes,
  kernel interfaces, raw block devices or control groups;
- bounded `tmpfs` mounts only where required (`nodev,nosuid,noexec` mandatory),
  with explicit byte/inode ceilings and no unbounded `/tmp`, `/run` or shared
  memory;
- a reviewed seccomp policy plus the host LSM available for the deployment
  (AppArmor/SELinux or provider-equivalent). Escape-oriented syscall classes such
  as mount namespace manipulation, `ptrace`, BPF, perf, kernel modules, raw
  devices and keyrings fail closed in every profile; profile-specific policies
  may add only reviewed workload syscalls outside those escape classes;
- cgroup-enforced CPU, memory/swap, PID, wall-time, disk/file-count and output
  ceilings, plus deterministic cancellation and teardown;
- default-deny network and DNS. Any profile egress is added by the external
  destination policy below, never by giving the workload the host network;
- an empty/synthetic environment allowlist with no inherited host, database,
  object-store, auth, provider, pairing or orchestration credentials.

Represent capability evidence explicitly rather than with a single `secure`
boolean:

```ts
type UntrustedSandboxBaselineVersion = 1;

type UntrustedBaselineCheckId =
  | "non-root-unprivileged"
  | "readonly-rootfs"
  | "capabilities-dropped"
  | "no-new-privileges"
  | "host-namespaces-isolated"
  | "host-mounts-sockets-devices-denied"
  | "proc-sys-masked"
  | "bounded-tmpfs"
  | "seccomp-lsm-enforced"
  | "cgroup-limits-enforced"
  | "network-default-deny"
  | "environment-sanitized";

interface SandboxBaselineEvidence {
  baselineVersion: UntrustedSandboxBaselineVersion;
  runtimeKind: string;
  runtimeVersion: string;
  imageDigest: string;
  hostPolicyDigest: string;
  checkedAt: string;
  checks: Record<UntrustedBaselineCheckId, "pass" | "fail" | "unknown">;
}

interface SandboxPreflightInput {
  executionProfileId: string;
  executionProfileVersion: number;
  requiredBaselineVersion: UntrustedSandboxBaselineVersion;
}

type SandboxPreflightResult =
  | { ok: true; evidence: SandboxBaselineEvidence }
  | { ok: false; missing: UntrustedBaselineCheckId[]; safeReason: string };
```

`capabilities()` reports features only after host/runtime inspection;
configuration strings and provider marketing claims are not evidence. Run
`preflight` at provider startup, whenever the runtime/policy/image digest changes
and immediately before admitting a job. `create` repeats the profile/digest
binding and refuses stale evidence. If one required check is missing, failed or
unknown, the scheduler must not advertise that profile, enqueue its jobs or
silently fall back to a weaker provider. It returns a typed unavailable reason;
`DisabledSandboxProvider` reports no executable profile and rejects every
`create` call.

The `runc-trusted-dev` label may still describe the absence of a stronger
multi-tenant kernel boundary, but its workloads must satisfy this process-level
baseline. Passing the baseline does not, by itself, authorize hostile
multi-tenant production; the deployment-specific gVisor/Kata/VM gates remain in
force.

### Do not overload “snapshot”

Model these separately:

```ts
type ImageTemplateRef = { imageDigest: string; profileVersion: number };
type WorkspaceSnapshotRef = {
  provider: string;
  digest: string;
  format: string;
};
type SandboxRuntimeCheckpointRef = {
  provider: string;
  opaqueRef: string;
  portable: false;
};
type ConversationCheckpointRef = { runtimeId: string; checkpointId: string };
type DomainCursorRef = { userId: string; sequence: number };
```

- **Image template**: immutable OS/toolchain base.
- **Workspace snapshot**: durable filesystem state; the portable branching
  primitive.
- **Runtime checkpoint**: optional memory/process snapshot with strict provider,
  CPU and version compatibility; optimization only.
- **Conversation checkpoint**: harness state from plan 026.
- **Domain cursor**: action boundary from plan 030.

Branch correctness relies on the workspace snapshot, not a provider-specific hot
VM checkpoint. If a runtime checkpoint is incompatible, restore the workspace
into a fresh sandbox and resume from the conversation checkpoint.

Use the names literally at persistence/API boundaries:
`imageTemplateRef`, `workspaceSnapshotRef`, `sandboxRuntimeCheckpointRef`,
`conversationCheckpointRef` and `domainCursorRef`. Never put multiple meanings
behind a generic `snapshotRef` or `checkpointRef`, and never reuse a sandbox
provider checkpoint as a harness/conversation checkpoint.

### Durable snapshot ledger

Add schema equivalent to:

```ts
workspaceSnapshots {
  id, userId, threadId, branchId,
  sequence,
  state: "pending" | "committed" | "failed",
  parentWorkspaceSnapshotRef?,
  imageTemplateRef,
  executionProfileVersion,
  conversationCheckpointRef,
  workspaceSnapshotRef?,
  sandboxRuntimeCheckpointRef?,
  portableManifestDigest?, objectRef?, byteSize?, fileCount?,
  requestId, safeError?, createdAt, committedAt?, failedAt?
}

workspaceSnapshotOutbox {
  id, workspaceSnapshotId,
  kind: "capture" | "adopt" | "publish" | "gc",
  state: "pending" | "leased" | "completed" | "failed",
  attempt, availableAt, leaseOwner?, leaseExpiresAt?,
  payloadDigest, safeError?, createdAt, completedAt?
}
```

Enforce unique `(branchId, sequence)`, `(userId, requestId)` and immutable parent,
image/profile/checkpoint fields after commit. All refs are tenant-scoped and
their target ownership is checked. `workspaceSnapshotRef` and `objectRef` remain
nullable until adoption succeeds. A `failed` row is terminal evidence; retry
creates a new request/row referencing the same parent and checkpoint.

`WorkspaceSnapshotLedger` must be co-located with the authoritative
`ConversationCheckpointStore` for that conversation placement and expose one
transaction boundary for checkpoint lookup plus snapshot-ledger transitions.
Core placement uses the core database; plan 032's node placement implements both
stores on the node. Provider snapshots/object bytes may live elsewhere, but the
checkpoint-to-ledger link may not be split across independent databases in v1.
Allow at most one committed snapshot per `(branchId,
conversationCheckpointRef)`; failed attempts remain auditable.

Snapshot/link protocol:

1. In one authoritative-store transaction, verify the committed plan-029
   conversation checkpoint and insert the `pending` snapshot row plus `capture`
   outbox record. The assistant run is not advertised as workspace-restorable
   yet.
2. A leased worker idempotently snapshots the fenced workspace for the recorded
   image/profile, verifies the provider manifest, then adopts the immutable
   object by digest.
3. In one database transaction, verify the conversation checkpoint still
   exists and belongs to the branch, set all final refs/digests, transition
   `pending -> committed`, and enqueue `publish`. Only this committed row becomes
   the branch's restorable head.
4. Publish the committed link/event from the outbox. Duplicate delivery is
   harmless. A later runtime checkpoint may be attached only as an optional
   compatible accelerator; it cannot change the portable manifest digest.
5. Permanent capture/adoption failure transitions `pending -> failed` with a
   safe error and schedules cleanup of provider/object orphans. It never moves
   the restorable head.

For node/external snapshot/object providers where blob creation cannot share the
store transaction, the outbox and digest adoption protocol is the atomicity
boundary: no API may return or restore a snapshot until its authoritative ledger
row is `committed`. Reconciliation must detect provider snapshots without rows,
objects without commits, pending rows with expired leases and committed rows
whose publish event was lost.

## Workspace lifecycle

### Thread workspace

- A new thread that requests execution starts from a pinned image template and
  an empty owned workspace.
- Inputs are copied as read-only files with opaque names and a manifest that
  maps them to source/citation IDs.
- The writable area is a dedicated `/workspace`; no host/project path is mounted.
- After each mutating execution step, create a pending ledger request linked to
  the resulting `conversationCheckpointRef`; expose the link only after the
  snapshot row is committed.
- Idle live sandboxes expire quickly. Durable state is the snapshot/object store,
  not a permanently running VM or per-chat virtualenv.
- Continuing a thread restores the latest compatible snapshot.
- Editing an old message branches the conversation only by default. Only the
  separate explicit “branch with workspace copy” action from plan 030 may fork a
  selected committed snapshot into a new workspace/branch; it never rewinds or
  deletes the newer workspace and never falls back to an implicit copy.
- Thread purge removes live sandboxes first and GC's unreferenced snapshots after
  retention checks.

Optional Git inside `/workspace` may improve text diff UX, but Git commits are
not the canonical snapshot format and binary outputs stay in object storage.

### Artifact adoption

Sandbox outputs are untrusted until adopted:

1. worker returns a manifest of relative paths, sizes, MIME guesses and digests;
2. trusted broker validates path containment, byte/count limits and expected
   output kind;
3. each file is streamed through type-specific validation/re-encoding/scanning;
4. object storage records it with an owned purpose;
5. an immutable artifact row points to input revisions, image digest, toolchain
   and output digest;
6. only then may the Web render/download it.

Never serve a sandbox file path directly.

## Execution profiles

Define reviewed, versioned profiles in code/config. Each declares image digest,
entrypoints, resources, filesystem mounts, egress and outputs. Each profile
inherits `UntrustedSandboxBaseline` version 1 without overrides; the bullets
below are additive constraints, not replacements for the common baseline.

### `latex`

- Tectonic/pinned TeX bundle and fonts;
- source files under `/workspace/input`;
- no shell escape;
- network disabled during compile;
- CPU/memory/process/output limits;
- expected PDF/log outputs;
- PDF validation and page render for visual review.

### `python-data`

- pinned Python and reviewed scientific packages;
- no host/system package manager;
- network off by default;
- structured script/notebook input and JSON/file output limits;
- no device/GPU access in v1.

### `browser`

- pinned Chromium + Playwright;
- fresh non-persistent context;
- service workers blocked, downloads denied, permissions empty;
- egress controlled outside Chromium;
- no school/provider credentials;
- bounded DOM/screenshot/network output.

### `slides`

- deterministic PPTX/document renderer plus font bundle;
- source manifest and expected slide/image/PDF outputs;
- no arbitrary macros or external resources.

### `media`

- FFmpeg/ffprobe with first-party argv builders;
- input/output codec, duration, resolution, stream and byte limits;
- no network;
- progress parsed to structured events.

### `manim`

- optional, disabled initially;
- pinned Manim/Python/LaTeX/FFmpeg image;
- strongest available isolation and no network during render;
- limited scene API/template where possible;
- validated video-only outputs.

Plan 033 implements the browser/media/Manim product pipelines. This plan makes
their execution safe and testable.

## Resource and network policy

Every sandbox creation specifies hard ceilings:

- CPU quota/time and wall deadline;
- memory and swap policy;
- PID/process count;
- workspace/input/output bytes and file count;
- stdout/stderr/event bytes;
- network bytes, destinations and request count;
- optional GPU type/time, disabled in v1.

Default egress is none. An egress-enabled profile uses infrastructure-level DNS
and IP enforcement on every connection/redirect, blocking loopback, private,
link-local, metadata, IPv4-compatible and NAT64-to-private addresses. Browser
interception is defense in depth, not the sole SSRF boundary.

OpenSandbox host/runtime compatibility must be tested: its documented gVisor
mode conflicts with an iptables NAT egress sidecar. Use an approved CNI/FQDN
policy or Kata where that control is required; never disable egress policy to
make the browser work.

### Secrets

- No long-lived secret enters environment variables or workspace files.
- Domain tools are called outside the sandbox through the broker.
- If a specialized workload needs a provider operation, use a short-lived,
  audience/job-bound proxy grant with narrow methods and quotas.
- The proxy removes credentials and returns bounded results.
- Secret access attempts are audit events and fail closed.

## Dependency/package workflow

Packages are executable supply-chain inputs. The model cannot run `apt install`,
`pip install`, `npm install` or TeX package fetches freely.

### Manifest request

An execution may propose a dependency manifest. The broker:

1. normalizes package names/versions and source registry;
2. rejects URLs, VCS refs, install scripts or native capabilities outside the
   profile policy;
3. shows a user/admin preview when a new dependency is required;
4. resolves and locks in a separate ephemeral, rootless image-build sandbox;
5. scans/licence-inventories outputs as policy requires;
6. produces an immutable image/template digest plus signed provenance and SBOM;
7. runs the actual workload network-off against that digest.

### LaTeX auto-detection

Support the user's package request without guessing silently:

- statically parse `\documentclass`, `\usepackage`, font and bibliography
  declarations;
- compile once against the pinned cached bundle;
- parse missing `.sty`, class, font and package diagnostics;
- map only known CTAN packages through a reviewed resolver;
- present “available in current bundle / needs approved bundle extension /
  unsupported engine”;
- build/cache a new immutable TeX template or fetch through a controlled Tectonic
  cache phase;
- rerun compile with the chosen digest and record it on the artifact.

Never permit `\write18`/shell escape or arbitrary downloader commands. Package
auto-detection is a proposal and cache/image operation, not runtime host install.

### Image-builder trust boundary

Treat dependency resolution and every package build hook as hostile code. The
builder must:

- run rootless in a disposable sandbox/VM distinct from the API, node daemon and
  workload sandbox; never mount the host Docker/Podman/containerd socket or use a
  privileged sibling builder;
- receive no core/node database credential, auth secret, object-store admin key,
  model/provider key, pairing material, production configuration or tenant
  workspace; its only input is a normalized lock request plus verified public
  base blobs;
- allow egress only to the exact approved package/OCI registries required by the
  lock, with DNS/IP/redirect rebinding checks and byte/request/time ceilings;
- assign a tenant-scoped build/cache namespace. Do not share mutable dependency,
  compiler or build-output caches across tenants. Globally reused base layers
  must be read-only, content-addressed and signature/digest verified before use;
- disable host mounts/devices, enforce PID/CPU/memory/disk/output limits and
  destroy the builder after each job;
- generate an SPDX or CycloneDX SBOM, locked dependency manifest and SLSA-style
  provenance binding source request, builder digest and output image digest;
- sign the provenance/image through a trusted post-build signer that never
  enters the builder, then require signature, provenance, SBOM and policy
  verification before any runtime can advertise or execute that image.

An install script or native build step is permitted only in this boundary and
only when its dependency policy explicitly allows it. A failed scan, missing
attestation, mutable tag, provenance mismatch or attempted disallowed egress
quarantines the output; it cannot enter a workload cache.

## Scheduler and progress

Extend the existing durable jobs substrate rather than replacing it blindly.
Put the execution backend behind a small `JobRuntime` contract before node or
managed distribution is added:

```ts
interface JobRuntime {
  enqueue(input: JobRequest): Promise<JobReference>;
  get(jobId: string): Promise<JobSnapshot>;
  cancel(jobId: string, reason: string): Promise<void>;
  events(jobId: string, after?: string): AsyncIterable<JobEvent>;
}
```

`LocalJobRuntime` adapts `apps/server/src/lib/jobs.ts`; plan 032 supplies the
node-backed dispatch and plan 034 may add a horizontally distributed operator
adapter only when real load requires it. The contract does not hand correctness
to an external queue: Avermate still owns job identity, policy, idempotency,
result adoption and user-visible events.

Add structured job attempts/stages/events or a companion table with:

- queued/leased/provisioning/running/snapshotting/adopting/terminal stages;
- monotonic sequence and replay cursor;
- heartbeat and lease ownership;
- progress numerator/denominator/unit/message;
- cancellation requested/acknowledged;
- provider sandbox/workspace refs after redaction;
- resource usage totals.

Long sandbox tasks must renew leases. Lost lease aborts execution or fences its
result adoption. Retrying the same idempotency key can reuse completed input
hashes but cannot adopt two competing outputs.

Publish user progress through the plan 026 event contract/SSE and keep polling
fallback. Do not put unbounded compiler logs in `jobs.result`.

## Provider adapters

### OpenSandbox

- exact compatible server/SDK versions;
- Docker mode for trusted dev/personal deployments only after the mandatory
  baseline preflight passes; runc remains truthfully labelled as lacking a
  stronger hostile multi-tenant kernel boundary;
- gVisor preflight for personal untrusted execution;
- Kata/Kubernetes profile for hostile multi-tenant use;
- server refuses to advertise isolation stronger than the configured runtime;
- test baseline evidence plus create/exec/files/snapshot/fork/cancel/destroy and
  network policy.

### E2B

- managed adapter only in initial scope;
- map templates, execution, files, snapshots and usage to the same contracts;
- no E2B-specific ID in the Web/domain schema;
- document retention, region and outbound-data implications;
- map provider controls to every baseline check and fail unknown claims; mock
  adapter in CI and opt-in live conformance suite.

### Microsandbox

- experimental personal-node adapter behind capability/preflight flags;
- require compatible KVM/libkrun or platform virtualization;
- prove the common baseline independently for every enabled profile;
- never advertise it as production multi-tenant before escape/network/snapshot
  conformance and upstream stability meet a recorded bar;
- exact pin because it is pre-1.0.

## Conformance and security tests

Every provider runs the same suite. Run the baseline probes as a
provider-by-profile matrix for `latex`, `python-data`, `browser`, `slides`,
`media`, `manim`, `image-builder` and any registered future profile; a passing
provider aggregate cannot mask one weaker profile:

- execute as non-root and prove privilege escalation, setuid/setgid helpers and
  ambient capabilities fail; verify all capabilities are dropped and
  `no-new-privileges` is effective;
- prove rootfs writes fail while only the declared isolated workspace is
  writable; bounded tmpfs hits byte/inode limits and is `nodev,nosuid,noexec`
  in every profile;
- attempt host PID/network/mount/IPC/UTS/user namespace sharing, host paths,
  container sockets, service-account paths, devices, writable procfs/sysfs and
  cgroup controls; each remains absent or denied;
- run seccomp/LSM escape fixtures for mount/setns/unshare, ptrace, BPF, perf,
  keyring and raw-device classes and assert the workload cannot reach the host;
- verify cgroup resource limits, default-deny egress/DNS and the sanitized empty
  environment from inside every profile;
- make one required baseline capability `fail` and then `unknown`; startup
  capability reporting, job admission and `create` all refuse the profile with
  the expected typed reason rather than downgrading;
- change the runtime, image or host-policy digest after preflight and prove stale
  evidence cannot admit a job until conformance passes again;

- no host file visibility without explicit input copy;
- path traversal, symlink, device and procfs escape attempts;
- CPU/memory/PID/disk/stdout/time ceilings;
- cancellation and forced cleanup;
- network deny, allowed-domain, DNS rebinding, redirect and metadata-address
  cases;
- no inherited env/credentials;
- snapshot/fork produces divergent isolated workspaces;
- pending/committed/failed snapshot transitions and immutable committed fields;
- crash before dispatch, after provider capture, after object adoption, after DB
  commit and before publish; reconciliation produces at most one committed head
  and cleans every orphan without making a pending snapshot restorable;
- missing/cross-branch conversation checkpoint prevents commit; duplicate
  capture/adopt/publish delivery is idempotent;
- incompatible runtime checkpoint falls back to workspace restore;
- artifact validation rejects polyglots, oversize/decompression bombs and
  unexpected paths/types;
- lease loss prevents result adoption;
- concurrent users/threads cannot observe each other's files/processes/events.
- malicious package fixtures cannot read credentials, mount a container socket,
  reach an unapproved/redirected/private registry target, poison another
  tenant's cache, escape through symlinks or publish unsigned/mismatched images;
- each accepted dependency image has verified digest, SBOM, provenance and
  signature, and tampering with any one makes execution fail closed.

Run trusted functional samples for LaTeX, Python, slides and media, then hostile
fixtures. Provider labels in tests must distinguish `runc-trusted-dev` from
secure profiles.

Commands include:

```powershell
bun run --cwd apps/server test src/sandbox
bun run --cwd apps/server test src/jobs
bun run --cwd apps/server sandbox:conformance
bun run format:check
bun run lint
bun run check-types
bun run test
bun run build
```

`sandbox:conformance` does not exist at planning time. Add it explicitly to
`apps/server/package.json` when the common conformance harness lands; the command
must exit non-zero when the selected provider advertises a capability whose
required host test cannot run, when any enabled provider/profile cell omits a
baseline check, or when a check reports `unknown`. Its machine-readable report
records provider, profile, baseline version, runtime/image/host-policy digests
and every check result. Trusted unit mocks remain available through the normal
server test script, but a mock result cannot authorize a real profile.

Host-dependent suites are opt-in locally but mandatory in their release profile
CI/staging.

## Rollout

1. disabled provider plus mocked conformance;
2. trusted development OpenSandbox/runc for deterministic test fixtures only;
3. gVisor personal creator profile after preflight and network tests;
4. E2B managed internal cohort;
5. Kata multi-tenant profile before any hostile shared production execution;
6. Microsandbox experimental opt-in only.

Existing in-API Tectonic/FFmpeg jobs migrate profile-by-profile. When this plan
is activated, disable each legacy active-execution path until its corresponding
sandbox profile passes the baseline and adoption tests; do not grandfather or
expand it during migration.

## Done criteria

- No new active/model-generated execution occurs in API/Web processes.
- Provider contracts and common conformance suite pass.
- Every enabled provider/profile/workload, including the image builder, proves
  the complete versioned `UntrustedSandboxBaseline`; missing, unknown or stale
  evidence makes that profile unavailable before job admission.
- Workspace branches restore from immutable snapshots and preserve newer state.
- Only `committed` snapshot-ledger rows are restorable; crash-window
  reconciliation cannot expose partial/provider-only state.
- Resource/egress/secret policies fail closed and are truthfully advertised.
- Artifact adoption validates all outputs before storage/rendering.
- LaTeX dependency detection produces reviewed immutable bundles, not host
  installs.
- Structured progress, cancellation, leases and cleanup survive restarts.
- Disabled/no-sandbox mode leaves grades/search/read-only chat fully usable.

## STOP conditions

- The only available runtime is runc but the feature is advertised for
  untrusted/multi-tenant code.
- A sandbox needs DB, auth cookie, S3 admin key or provider secret.
- Egress is enforced only by model instructions or browser routing.
- A provider snapshot's semantics are assumed rather than capability-tested.
- A result can be served directly from sandbox storage.
- Package installation can execute an arbitrary user/model command on the host.
- Any workload/profile is exempted from the baseline, runs as root/privileged,
  has a writable rootfs, retains capabilities, lacks no-new-privileges or can see
  a host namespace, mount, socket, device or unbounded tmpfs.
- Capability preflight trusts configuration/self-reporting, permits an `unknown`
  check or advertises a profile whose exact runtime/image/policy evidence is
  missing or stale.
- An image builder has core credentials, a host container socket, unbounded
  egress, a cross-tenant mutable cache or can publish an unattested image.
- Compose documentation claims it installs gVisor, Kata, KVM or GPU drivers.

## Maintenance

Pin images by digest and rebuild on security updates. Maintain an SBOM and
licence inventory per template. Run escape/network conformance on runtime,
kernel, container engine and provider upgrades. Garbage-collect live sandboxes,
snapshots and cached images only from reference-counted manifests with a dry-run
report and retention window.
