# Sandbox runtime and versioned workspaces

**Implementation status (2026-08-28):** provider-independent contracts,
fail-closed adapters, security policy, deterministic mock conformance, artifact
adoption, versioned structured workers, LaTeX dependency analysis, a durable
SQL snapshot ledger/outbox and durable job-event replay are implemented. **No
real execution provider or worker image is enabled, attested or proven by this
repository state.**

This document is the operational truth for plan 031. Application code targets
one `SandboxProvider`; deployment-specific transports and host probes remain
outside the API process.

## Availability model

| Provider | Default state | Requirement before availability |
| --- | --- | --- |
| `DisabledSandboxProvider` | Selected by default | None; it intentionally exposes zero profiles |
| `MockSandboxProvider` | Tests only, explicit `--mock` | Never valid as production evidence |
| `OpenSandboxProvider` | Unavailable | Injected transport, reviewed pinned images and fresh host-produced evidence |
| `E2BSandboxProvider` | Unavailable | Injected managed transport, reviewed templates and fresh provider evidence |
| `MicrosandboxProvider` | Unavailable/experimental | Opt-in, host virtualization attestation, transport, images and evidence |

Selecting `SANDBOX_PROVIDER`, setting an endpoint or installing an SDK does not
advertise a capability. `capabilities()` returns a profile only after live
preflight succeeds. `create()` repeats preflight and binds its handle to the
exact provider, profile version, image digest, host-policy digest and evidence
nonce.

No adapter invokes a shell in the API process. A transport accepts an exact
executable plus argument vector. Real provider SDK/HTTP implementations must be
injected by a deployment module after compatibility and security review; none
is silently inferred from environment variables.

The LaTeX build, material-preview and media-segmentation jobs dispatch through
the reviewed worker client when no test fixture is injected. They fail closed
when an attested `latex` or `media` profile is unavailable and never fall back
to `Bun.spawn` in the API process. Their injected compiler/renderer functions
remain test-only composition seams. The Plan-033 static sandbox audit
scans every non-test TypeScript runtime file under `apps/server/src` and rejects
native process APIs unless a path is explicitly reviewed and allowlisted; the
checked-in allowlist is empty.

## Versioned worker catalogue

The server admits only an exact worker ID, profile, executable and argv tuple.
The durable executor re-reads the immutable object manifest, parses the worker's
strict schema, repeats provider preflight, invokes the fixed tuple, verifies the
declared result and output descriptors, streams every output through artifact
adoption, then destroys the sandbox. A forged ID/argv combination is rejected
before sandbox creation.

| Worker ID | Profile | Structured operation |
| --- | --- | --- |
| `browser-capture.v1` | `browser` | fresh-context public-page capture |
| `video-audio-extract.v1` | `media` | YouTube-only download and WAV normalization |
| `media-segment.v1` | `media` | bounded MP3 segmentation |
| `media-timeline-render.v1` | `media` | immutable-asset FFmpeg timeline render |
| `material-preview.v1` | `media` | PDF/image preview normalization |
| `manim-build.v1` | `manim` | data-only scene DSL translated to fixed Manim code |
| `latex-build.v1` | `latex` | cached, untrusted Tectonic build without shell escape |
| `slides-build.v1` | `slides` | macro-free headless PDF conversion |

Worker manifests never carry a command or arbitrary flag. Inputs live under
`/workspace/input`; scratch/output paths are fixed under `/workspace/tmp` and
`/workspace/output`; output count, bytes, duration, pages/slides, codecs and
formats are bounded and re-inspected. The API runtime image intentionally ships
none of Chromium, yt-dlp, FFmpeg, ImageMagick, Poppler, Tectonic, LibreOffice,
Manim or Python.

`apps/sandbox-worker/docker/worker.Dockerfile` builds one least-privilege
profile image at a time. Both builder and toolchain bases must be immutable OCI
digest references. `apps/sandbox-worker/scripts/build-image.ts` hashes the
Dockerfile, lockfile, contracts, worker sources and patches, then prints an
argv-only Docker build plan; it runs Docker only with an explicit `--execute`.
The checked-in tests validate the plan without contacting Docker. A deployment
must still provide a reviewed toolchain base, build and scan the image, publish
SBOM/provenance/signature, pin the resulting digest and pass live baseline
conformance. Source digesting is not runtime attestation.

Browser capture and YouTube extraction additionally remain unavailable until a
real provider binds the manifest policy digest to connection-time DNS,
redirect and byte/request enforcement. Merely enabling a static profile or
allowing network at the container level does not satisfy that requirement.

## Untrusted-workload baseline v1

An evidence envelope identifies runtime kind/version, probe version, isolation
class, immutable image digest, host-policy digest, profile/version, nonce,
check time and expiry. It contains an explicit `pass`, `fail` or `unknown` for:

1. non-root unprivileged execution;
2. read-only root filesystem;
3. dropped capabilities;
4. `no-new-privileges`;
5. isolated host namespaces;
6. denied host mounts, sockets and devices;
7. masked `/proc` and `/sys` surfaces;
8. bounded temporary filesystems;
9. enforced seccomp/LSM policy;
10. enforced cgroup limits;
11. default-deny networking;
12. sanitized environment.

A missing check, `unknown`, failure, stale/future/expired evidence, wrong image,
wrong profile, wrong provider, wrong isolation class or wrong host-policy digest
fails preflight. Static configuration and vendor capability lists are not
evidence.

## Execution profiles and policy

The v1 catalogue defines `latex`, `python-data`, `browser`, `slides`, `media`,
`manim` and `image-builder`. Every checked-in profile is disabled and uses a
non-release placeholder image identity. Enabling a deployment copy requires:

- a reviewed immutable image digest and profile version;
- exact entrypoints rather than command strings;
- hard CPU, memory, PID, wall-time, output, workspace, tmpfs and file ceilings;
- explicit writable workspace paths and output patterns;
- default-deny egress or a bounded external allowlist;
- explicit brokered-secret policy (off in the catalogue).

The browser profile does not imply unrestricted browsing. An allowlist entry is
an HTTPS/WSS origin, port and path prefix. Connections and redirects are
re-authorized against freshly resolved public addresses. Loopback, private,
link-local, metadata, CGNAT, multicast/reserved, IPv4-mapped and recognized
NAT64-to-private destinations are denied. Host networking is never a profile.

Only a small deterministic environment allowlist crosses the boundary. The API
does not inherit its process environment. Credentials, database URLs, cookies
and tokens never become environment variables; a future credential path must
use short-lived audience/method/quota-bound grants.

## Provider configuration

`SANDBOX_PROVIDER` defaults to `disabled`. Real selections require a pinned
`SANDBOX_HOST_POLICY_DIGEST`. Evidence freshness defaults to five minutes and
may be reduced with `SANDBOX_EVIDENCE_MAX_AGE_MS`.

Each profile is configured only when all three values are present:

```text
SANDBOX_PROFILE_LATEX_ENABLED=true
SANDBOX_PROFILE_LATEX_VERSION=<reviewed-version>
SANDBOX_PROFILE_LATEX_IMAGE_DIGEST=sha256:<64 lowercase hex characters>
```

Replace `LATEX` with `PYTHON_DATA`, `BROWSER`, `SLIDES`, `MEDIA`, `MANIM` or
`IMAGE_BUILDER`. Incomplete configuration fails closed.

OpenSandbox additionally requires one compatible isolation/tenancy pairing:

- `runc-trusted-dev` with `SANDBOX_TRUSTED_DEVELOPMENT=true` and
  `SANDBOX_MULTI_TENANT=false`;
- `gvisor-personal` with `SANDBOX_MULTI_TENANT=false`;
- `kata-multitenant` with `SANDBOX_MULTI_TENANT=true`.

Microsandbox requires both
`SANDBOX_MICROSANDBOX_EXPERIMENTAL=true` and
`SANDBOX_MICROSANDBOX_HOST_VIRTUALIZATION_ATTESTED=true`. These flags permit
configuration; they are not baseline evidence.

## Workspace and checkpoint semantics

| Reference | Meaning | Portability |
| --- | --- | --- |
| Image template | Immutable profile toolchain/root filesystem | Deployment controlled |
| Workspace snapshot | Committed files at a branch boundary | Digest-addressed declared format |
| Runtime checkpoint | Provider-native VM/container acceleration | Non-portable |
| Conversation checkpoint | Harness state and interrupt continuation | Not a filesystem |
| Domain cursor | Ordered application mutations/compensations | Not filesystem/harness state |

`InMemorySnapshotLedger` remains the deterministic contract reference for
tests. Production uses `CoreSqlSnapshotLedger`, which persists pending,
committed and failed transitions, outbox leasing, owner/branch/checkpoint
validation, idempotency, immutable parent/image/profile fields, portable
manifest size/count/digest evidence, capture/adopt/publish/GC recovery and
orphan reconciliation. Only committed, authorized rows are restorable; latest
restore also requires exact profile/image compatibility. An optional provider
runtime checkpoint may be attached later only as a compatible accelerator and
never changes the portable snapshot. Production activation remains blocked on
live provider and isolation evidence, not on snapshot-ledger persistence.

## Artifact adoption

Outputs remain untrusted after a process exits. Adoption validates normalized
relative paths and byte/count ceilings; rejects traversal, case collisions,
symlinks and device nodes; restricts path and type; streams to an untrusted
staging upload while recomputing SHA-256/size; checks MIME/kind content; then
commits verified bytes to trusted storage. It returns an opaque object reference
with job, tool, profile, image and input-revision provenance—not a sandbox path.

Failed multi-file adoption aborts staging and asks the store to revoke objects
committed before a later commit failure.

## LaTeX dependency extension

The detector reads `documentclass`, `usepackage`, font and bibliography
declarations after stripping comments and can classify missing `.sty`, `.cls`,
font and bibliography diagnostics. Detection never installs anything.

Only dependencies in a reviewed name-to-bundle catalogue can produce an
immutable image-extension proposal. It pins its parent image, profile version
and dependency-lock plus bundle digests and remains `review-required`. Unknown dependencies
report `needs-extension`; `write18`, shell escape and raw file primitives report
`unsupported`. Host installation, mutable images and `--shell-escape` remain
forbidden.

The image-builder profile is rootless, disposable, tenant-cache-scoped and
forbids host runtime sockets. Its output is quarantined until a trusted
post-build verifier validates the approved proposal binding, result digest,
baseline evidence, policy/egress digests, scan result, SBOM, provenance and an
allowed signer. Builder flags or a mutable image tag cannot enable a workload.

## Job and progress boundary

`StoreBackedJobRuntime` defines enqueue, ownership-fenced inspection,
structured leased/provisioning/running/snapshotting/adopting stages, bounded
progress/log/usage/heartbeat/cancellation events, ordered replay/streaming and
queued-only cancellation. Lease loss fences result adoption. `SandboxJobAdmission`
requires fresh profile/image/host evidence before enqueue, while provider
creation repeats preflight in the worker. The runtime refuses non-durable
stores. `job_runtime_metadata` and `job_runtime_events`, introduced by migration
`0058_small_deathstrike.sql`, provide durable stages and ordered replay; no
in-memory production fallback is wired.

## Conformance

Run the fail-closed default matrix:

```sh
bun run sandbox:conformance
```

It emits JSON for every provider/profile cell. In the default checkout every
cell is `unavailable`; this proves fail-closed behavior only and is not managed
isolation evidence.

Run deterministic fixtures with:

```sh
bun run sandbox:conformance:mock
```

This report sets `mockEvidence: true` and exercises lifecycle, structured
execution, path/env/resource/network denial, manifests, snapshots and fork
divergence for all profiles. It cannot authorize a real runtime. An explicitly
selected real provider exits non-zero when no enabled profile produces live
matching evidence or an advertised check fails.

## Durable persistence now in place

Plan 031 originally stopped at an in-memory reference because the next migration
prefix was owned elsewhere. That historical limitation has since been removed.
Migration `0058_small_deathstrike.sql`, `db/schema/sandbox.ts` and
`sandbox/sql-snapshot-ledger.ts` now provide:

- immutable workspace-snapshot rows with owner, thread, branch, sequence,
  checkpoint, execution-profile and image fences;
- uniqueness constraints for request replay, branch sequence and committed
  branch checkpoints;
- a transactional snapshot outbox with durable states, leases, attempts and
  reconciliation;
- captured and adopted object provenance, portable manifest digests and
  terminal-state invariants;
- runtime-checkpoint metadata that can attach only to an already committed
  logical snapshot.

Provider activation still requires matching live isolation evidence, reviewed
images and the external conformance gates described above. The existence of the
SQL ledger proves restart-safe persistence; it does not by itself prove a
production sandbox deployment.
