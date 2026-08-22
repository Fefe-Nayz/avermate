# Sandbox provider dependency decision

**Decision:** keep plan 031 transport-neutral until a concrete deployment
passes baseline-v1 and provider×profile conformance. No OpenSandbox, E2B or
Microsandbox SDK is a production dependency yet.

| Candidate | Adapter | Accepted isolation label | Current status |
| --- | --- | --- | --- |
| OpenSandbox | `OpenSandboxProvider` | `runc-trusted-dev`, `gvisor-personal`, `kata-multitenant` under matching tenancy restrictions | Contract only; no transport/runtime proof |
| E2B | `E2BSandboxProvider` | `e2b-managed` | Contract only; no managed transport/template proof |
| Microsandbox | `MicrosandboxProvider` | `microsandbox-experimental` after host attestation | Experimental contract only; no transport/runtime proof |

The adapter accepts an injected `RemoteSandboxTransport`. That transport owns
the version-pinned SDK/API implementation and must expose a live evidence probe
plus create, execute, files, snapshot, fork, stop and destroy operations. This
prevents a vendor import or endpoint string from being confused with a verified
security boundary.

Before selecting a transport dependency, record its exact release/protocol,
redistribution and service terms, control-plane assumptions, image pinning,
tenancy/isolation, snapshot portability/deletion, networking/secrets/resources,
and complete target-host conformance JSON. Until then `capabilities()` exposes
no real profile and the provider factory fails closed.
