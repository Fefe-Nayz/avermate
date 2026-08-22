# Plan 032 verification evidence — 2026-08-22

This record separates implemented checks from evidence that could not be
reacquired after the Docker Desktop host failed. A static validation, an old
successful cell, and a current end-to-end run are not treated as interchangeable.

## Green evidence in the current checkout

| Check                                         | Result             | Evidence                                                                                                                                                                                                                |
| --------------------------------------------- | ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Contracts, Node and Server typechecks         | Green              | All three current `tsc --noEmit` runs completed with exit code 0.                                                                                                                                                       |
| `verify:032:protocol`                         | Green              | 38 tests: 3 harness-diagnostic, 3 contract, 17 Node identity/control/job/deletion/stream tests, and 15 Core routing/deletion tests.                                                                                     |
| `verify:032:configurator`                     | Green              | 16 security/config/preflight tests, generated-schema write, and a real loopback `dev-zero` process health smoke.                                                                                                        |
| Storage/corpus/conversation cells             | Green              | 7 storage/corpus contract tests, 4 filesystem provider tests, and 38 Core/Node adapter, adoption, deletion, lexical, citation, corpus and conversation tests.                                                           |
| Full `verify:032:storage`, last completed run | Green              | The then-current contracts/filesystem/Core↔Node cells and a disposable Garage v2.3 provider passed; cleanup found no labelled container, volume or network. Plan 034 independently consumed the same gate successfully. |
| `verify:032:selfhost -- --static-only`        | Green, static only | Hosted-domain source assertion and all seven Compose profile configurations passed. The command explicitly says runtime is not proven.                                                                                  |
| `verify:032:selfhost-airgap -- --static-only` | Green, static only | Full-self-host Compose configuration and loopback/internal-network/hosted-domain source assertions passed. The command explicitly says air-gap runtime is not proven.                                                   |
| Workflow and formatting                       | Green              | Plan 032 workflow YAML parses; the touched workflow, scripts, Compose, docs and Web files pass Prettier. Both runtime jobs are required on pull requests, pushes to `main`, and manual dispatches.                      |

The storage gate was expanded after its last complete Garage run to add the
corpus/lexical/citation/conversation cells listed above. Those new cells pass,
and the unchanged Garage cell last passed, but the exact expanded command could
not be rerun as one process after Docker failed.

## Runtime evidence acquired before the host failure

Disposable Compose projects booted and cleaned up for `dev-zero`, `node-lite`,
`node-storage` with real Garage/S3, and `node-observable`. The creator and
local-GPU profiles were honestly not applicable on this host because their
preflight found no required gVisor/Kata isolation runtime; no capability was
fabricated. The last cleanup audits found no Plan 032-labelled container,
volume, or network. The unrelated `openbacktest` project was not touched.

## Blocked current gates

| Check                        | Status            | Exact reason                                                                  |
| ---------------------------- | ----------------- | ----------------------------------------------------------------------------- |
| `verify:032:storage` re-run  | Host-blocked      | Its required Garage cell cannot start while Docker is unavailable.            |
| `verify:032:selfhost`        | Host-blocked      | Full current run cannot pass the read-only Docker preflight.                  |
| `verify:032:selfhost-airgap` | Host-blocked      | The deployed functional/network proof was not started after preflight failed. |
| `verify:032`                 | Red by dependency | The aggregate includes the three Docker-dependent checks above.               |

Docker first failed inside BuildKit/containerd with
`containerd-overlayfs/metadata_v2.db: input/output error`. A read-only
`docker system df` retry returned HTTP 500. The final read-only `docker info`
probe timed out and was killed after 20 seconds. The harness classifies these
before project creation as `PLAN032_DOCKER_HOST_CONTENT_STORE_UNHEALTHY` or
`PLAN032_DOCKER_HOST_DAEMON_UNAVAILABLE`; it does not mislabel them as an
Avermate test failure. No restart, prune, or further live probe was performed.

## Repository closure and live blockers

After the original evidence run, the repository added and gated the Core
pairing registry/exchange, sealed credential lifecycle, authenticated relay,
Node auto-connect and capability dispatch, SQL object-adoption repository and
remote-deletion reconciliation. Those former foundation gaps are now closed in
repository tests, so the Plan 032 roadmap row can honestly be marked
`DONE (repository foundation)`. Plan 038 has now delivered those conversation
placement, full-self-host Core↔Node storage/relay composition, migration UX and
specialist-worker contracts in repository evidence; deployed conformance
remains external.

This does not change the runtime evidence above. The full-self-host and air-gap
profiles still need successful deployed runs on a healthy Docker host. The
full-self-host profile also continues to advertise sandbox unavailability until
a real provider/image passes attested isolation conformance. No local or static
result in this record is a hosted-relay, sandbox, air-gap or release proof.
