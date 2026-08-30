# Self-hosting Avermate

The reference deployment runs the API and web application behind Traefik. A
remote libSQL/Turso database is the simplest durable database; a local `file:`
database also works when its directory is mounted persistently.

This guide describes both the **complete self-host** shape—one operator runs the
Web application, account/academic API, jobs, database and file storage—and the
hybrid Avermate Node shape, where selected user-owned capabilities are paired
with an academic account hosted on `avermate.fr`. They share contracts and
adapters but keep distinct data authority and release evidence.

Provider inference has the same versioned capability contracts in every
deployment, with registry execution enabled per family. The public connection
API accepts direct BYOK or an actively owned paired Node; it does not grant
operator authority to create `core`, `managed` or `full-self-host` placements.
There is no general operator-key bootstrap into this registry yet. Its narrow
internal bootstrap creates only credential-free native PDF extraction.
OpenRouter, LiteLLM and Hugging Face are explicit connections, not hidden global
routers. See
[`adr/040-capability-registry.md`](adr/040-capability-registry.md) for routing,
credential custody, consent, fallback and operation-ledger invariants.

## Capability-registry rollout

Defaults are conservative and independent of the hosting profile:

```env
CAPABILITY_REGISTRY_SHADOW=false
CAPABILITY_TTS_EXECUTION=legacy
CAPABILITY_STT_EXECUTION=legacy
CAPABILITY_OCR_EXECUTION=legacy
CAPABILITY_DOCUMENT_EXTRACTION_EXECUTION=legacy
CAPABILITY_RERANK_EXECUTION=legacy
CAPABILITY_EMBEDDING_EXECUTION=legacy
CAPABILITY_LANGUAGE_EXECUTION=legacy
NODE_CAPABILITY_PROTOCOL_V1=false
```

The seven execution flags accept `legacy`, `shadow` or `registry`. The master
shadow flag affects only families without an explicit override; explicitly
setting every family to `legacy` prevents that master from upgrading them.
Shadow resolves existing routes without a second provider call or artifact
write, then executes the legacy path once. Registry never falls back silently
to legacy. Image/video workflows remain legacy and have no registry execution
flag. Deterministic extraction currently covers native PDF, not every document
format in the broader contract.

Create a registry connection, validate it, discover offerings, review disclosures
and configure policies before changing a family's mode. Legacy environment
variables and encrypted service keys remain supported by legacy paths; their
read-only UI projection does not create executable registry offerings. Rotate
or reconfigure a connection, then validate and rediscover its current offerings and
update pinned policies. A successful repeat validation of an already-ready
connection does not invalidate its pins. Health expires after five minutes and
is probed on demand; the UI readiness check is not a continuously running probe.

Compiled cloud adapters include Mistral TTS/STT/OCR, ElevenLabs TTS and Deepgram
STT, plus the language/embedding/reranking connectors in the
[inventory](capability-registry/inventory.md). LiteLLM and Hugging Face plugins
are text-only chat connections with pinned models/revisions, not universal
upstream task catalogues. HF requires an explicit provider suffix; LiteLLM
requires a single-deployment proxy with hidden retries/fallbacks disabled.
Hosted Core rejects private compatible endpoints: expose local inference
through a paired Node instead of passing a private address to the user API.

Enable `NODE_CAPABILITY_PROTOCOL_V1` in the Node process and configure
`capabilities.sidecars` only for sidecars implementing the bounded Avermate
protocol. Pin Compose images by digest and keep secret references in the local
Node secret store. Media input bytes are staged on Node, and outputs are
verified/adopted before Core publication. `CapabilityArtifactIo.write` and
`CapabilityArtifactIo.adopt` preserve the selected Node/local/S3 storage with
durable two-phase adoption; canonical Core file metadata does not imply
Core-hosted bytes. See the [Node artifact protocol](capability-registry/node-artifact-protocol.md).
A sidecar cannot use a Core file path as if it were a shared volume. The local
OCR/STT worker bridges still require
their image/runtime evidence. Zero-cloud-key development is supported without
AI; a fully local processing profile additionally needs the configured local
models/workers and healthy-host evidence.

Managed usage is optional and separate: a broker must reserve supported quotas
before dispatch and conservatively settle uncertain work. No managed pool is
automatically activated by a registry flag. Unknown provider prices remain
unknown. Inspect ambiguous outcomes before relaunching from the original
workflow; there is no generic capability-operation retry endpoint.

## Deployment modes

| Mode                                  | Current status                | Data and execution boundary                                                                                                                                                       |
| ------------------------------------- | ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Local development                     | Implemented                   | Local SQLite-compatible database and local file storage work without Garage; optional provider keys enable OCR/transcription                                                      |
| Complete self-host                    | Release candidate             | Operator owns Web, API, local database/storage and configured providers; final Compose/air-gap proof is still blocked by the test host                                            |
| Hosted academic core                  | Product mode                  | Accounts and academic data may be hosted on `avermate.fr`; this baseline promises neither hosted file storage nor hosted inference                                                |
| Hosted core plus user Avermate Node   | Repository-complete candidate | Pairing, sealed credentials, relay transports, SQL adoption/deletion/checkpoints, placements and configurators are implemented; deployed relay/provider evidence remains external |
| Optional managed AI and file capacity | Safe repository beta          | Quotas, metering, customer/operator surfaces and test billing exist behind disabled activation; isolation/load/restore/legal launch gates remain external                         |

The current repository exposes scoped MCP and the production embedded assistant
runtime with durable branches, checkpoints, streamed status/tool parts,
attachments, dictation and export. Direct/BYOK, paired-Node and optional
LiteLLM model paths are explicit placements. Sandbox/provider contracts and the
conformance matrix are documented in [`sandbox-runtime.md`](sandbox-runtime.md);
every real sandbox remains unavailable until its immutable image and
host-produced baseline evidence pass. Self-hosting does not manufacture that
evidence or silently replace an unavailable provider with a mock.

The Plan 032 foundation is documented in
[`avermate-node-protocol.md`](avermate-node-protocol.md). In particular,
`dev-zero` can boot directly with filesystem storage and no Garage. The
`node-storage` profile and disposable Garage v2.3 provider pass the shared
storage conformance suite. Core pairing, authenticated relay, conversation,
retrieval/model/sandbox operation transports, durable adoption, signed remote
deletion and provider-native runtime-checkpoint metadata are wired. The
remaining release boundary is operational: exact-image provider attestations,
healthy-host Compose/backup/restore/N−1 and air-gap proofs must still pass.

The Plan 032 profile-aware source is `infra/compose/avermate.yml`; the Plan 038
full candidate cells (LiteLLM, vector/embedding/rerank, specialist workers and
sandbox) live in `infra/compose/plan-038.yml` with fail-closed image variables.
Public Node configuration is generated/validated against
`infra/node/config.schema.json`. `docker compose ... config` is only a static
syntax/interpolation check. It is not boot, backup, restore, isolation or
air-gap evidence.

The complete self-host profile uses one deliberately narrow relay exception:
Node connects to the exact internal Core address `http://api:5000`, producing
`ws://api:5000/api/node/control`. The host-facing configurator is still bound to
`127.0.0.1`; arbitrary HTTP Core URLs remain invalid, and every hosted or remote
Node continues to require HTTPS/WSS.

OpenCode and OpenHands are not test-only injections. The production Node entry
constructs the official OpenSandbox SDK provider, stores logical workspace
snapshots in the selected Node object store, and can use provider-native runtime
checkpoints separately. Activation requires these public, immutable deployment
values in addition to the pinned images/digests:

```env
AVERMATE_NODE_PUBLIC_SANDBOX_EVIDENCE_ENDPOINT=https://attestor.example/evidence
AVERMATE_NODE_PUBLIC_SANDBOX_RUNTIME_VERSION=opensandbox-0.1.11
```

The evidence endpoint must be an external host-produced baseline attestor; the
OpenSandbox workload cannot attest itself. If it is missing, stale, mismatched
or unreachable, sandbox and specialist job capabilities are omitted from the
signed manifest rather than replaced by a mock.

### Offline OCR and speech-to-text

The `full-self-host` profile routes document OCR and audio transcription to the
paired local Node. Core sets `OCR_PROVIDER=node` and
`TRANSCRIPTION_PROVIDER=node`, keeps both disable switches false, and does not
resolve a Mistral, BYOK or managed fallback for these operations. If the Node or
the exact worker profile is unavailable, the operation fails explicitly; source
documents and audio are never sent to a cloud provider as a fallback.

The Plan 038 Compose environment requires all of the following values:

```env
# Each image value is an exact repository:tag@sha256:<digest> reference. The
# adjacent digest must be the same sha256 value and is checked by Node preflight.
OCR_WORKER_IMAGE=
OCR_WORKER_DIGEST=
TRANSCRIPTION_WORKER_IMAGE=
TRANSCRIPTION_WORKER_DIGEST=

# Immutable identifiers from the signed offline bundle; never use latest/main.
AVERMATE_NODE_PUBLIC_OCR_MODEL_REVISION=
AVERMATE_NODE_PUBLIC_TRANSCRIPTION_MODEL_REVISION=
```

Compose exposes those operator inputs to the public Node profile as
`AVERMATE_NODE_PUBLIC_OCR_WORKER_IMAGE`,
`AVERMATE_NODE_PUBLIC_OCR_WORKER_DIGEST`,
`AVERMATE_NODE_PUBLIC_TRANSCRIPTION_WORKER_IMAGE` and
`AVERMATE_NODE_PUBLIC_TRANSCRIPTION_WORKER_DIGEST`. They are public
configuration, as are the two model-revision variables; none is a credential.
OCR/STT needs no private provider key; leave `MISTRAL_API_KEY` and
`TRANSCRIPTION_API_KEY` unset for this profile.

The `ocr` image contains the local `tesseract`, `pdfinfo` and `pdftoppm`
executables plus pinned `fra`/`eng` trained data. Its fixed
`/opt/avermate/bin/local-ocr` entrypoint runs with a read-only root filesystem
and `egress: none`; it cannot fetch an engine or language pack. The signed Node
catalogue advertises this stack exactly as `tesseract-ocr`, provider
`tesseract+poppler`, with the immutable OCR revision above. The
`speech-to-text` image contains the reviewed `whisper.cpp` binary, its fixed
`/opt/avermate/bin/local-transcription` entrypoint and the pinned weights at
`/models/whisper-large-v3-turbo-q5_0.bin`; the model is advertised exactly as
`selfhost/whisper-large-v3-turbo-q5_0` with the immutable revision above. The
weights are part of the digest-pinned image/offline bundle: there is no runtime
download, arbitrary host-model mount or HTTP model service. Both workers run
with network access denied.

Build the corresponding `profile-ocr` and `profile-speech-to-text` targets from
`apps/sandbox-worker/docker/worker.Dockerfile` with a reviewed, digest-pinned
`WORKER_RUNTIME_IMAGE` that already contains those tools/data/weights. The build
fails closed if any executable, trained-data file or Whisper weight is missing.
The repository intentionally supplies no unverified image digest: publish the
resulting exact `tag@sha256`, record it in the signed release manifest/offline
bundle and copy that verified value into the required Compose variables.

Static profile validation and `docker compose ... config` can prove only that
the required references and provider selection are present. The signed Node
manifest advertises each OCR/STT job only after the matching image, profile,
host-policy and egress evidence passes readiness. A real OCR/transcription run
and an active network-denial observation remain mandatory release evidence.

The Plan 032 runtime harness uses loopback-only published ports and an internal
Docker network. Its release proof signs in, performs academic CRUD, uploads and
range-reads a local object, runs local-fixture chat/search/export/delete, calls
OAuth-protected MCP, scans the built Web bundle/HTML for hosted Avermate domains,
and actively verifies that DNS/HTTP egress cannot leave API, Web or Node. A
profile with no conforming sandbox reports that capability unavailable; it does
not fabricate a sandbox artifact.

The latest local run is not release evidence: Docker Desktop's
containerd/BuildKit content store failed first with an input/output error in
`metadata_v2.db` and then returned HTTP 500 for the read-only `/system/df`
probe. A final read-only retry timed out on `docker info`. The gate classifies
these as `PLAN032_DOCKER_HOST_CONTENT_STORE_UNHEALTHY` and
`PLAN032_DOCKER_HOST_DAEMON_UNAVAILABLE` before creating a Compose project. Fix
the host and rerun both commands; do not replace them with `--static-only`:

```sh
bun run verify:032:selfhost
bun run verify:032:selfhost-airgap
```

## Prerequisites

- Docker with Compose support;
- a Traefik instance with a TLS certificate resolver, or an equivalent reverse
  proxy configuration;
- three DNS names: web, API and the Garage S3 endpoint;
- a durable libSQL database or a persistent volume for a local database;
- the `webgateway` Docker network expected by `deploy.yml`.

For a workstation checkout, Docker, Traefik, DNS and Garage are unnecessary:
use the local setup in the root README. The prerequisites below apply to the
reference production Compose topology.

### Avermate Node visual setup

The Node starts its setup surface on the configured loopback address. Exchange
the one-time bootstrap secret written by the daemon, then use the persistent
FR/EN selector to configure:

- filesystem, Garage/S3 or external S3 storage and conversation quota;
- lexical retrieval plus explicitly enabled Gemini/TEI embeddings and
  TEI/Qwen3 reranking;
- direct or LiteLLM model routing, pinned catalogue/revisions, budgets and
  fallback chains;
- sandbox/runtime checkpoints, bounded OpenCode/OpenHands workers and their
  allowlists;
- pairing, jobs, backup, restore, N−1 upgrade, offline and telemetry policy.

Validate before applying. Secrets are submitted to the Node vault through the
dedicated secret endpoint and are returned only as configured/not-configured
state. Deployment preview produces deterministic Compose/config/backup command
arguments; the browser never receives the Docker socket and never runs those
commands. Applying an optional cell makes it eligible only after its readiness
and evidence checks pass.

Docker profiles mount their reviewed profile as a read-only first-boot template.
The daemon copies it once to `/data/node/avermate-node.yaml`; pairing and visual
configuration then update that owner-only file in the persistent Node volume.
Restarts always prefer the mutable file, so credentials and reviewed settings
are not discarded while the shipped template remains immutable. The container
keeps its canonical listener on `127.0.0.1`; a separate bounded bridge listener
is published by Compose only on host `127.0.0.1:5188`. Do not change that
host-side binding to `0.0.0.0` or expose the setup port publicly.

When corpus placement is `node`, the Node is the only readable/searchable body
store. Hosted Core retains authorization, locators and hashes plus encrypted
recovery envelopes; it does not retain a plaintext FTS/body fallback. Search,
citations and assistant context therefore return an explicit availability error
while the paired Node is offline.

## Configure

1. Copy `deploy.yml` and replace the three canonical host rules with your domains.
2. Set all required API values: `DATABASE_URL`, optional
   `DATABASE_AUTH_TOKEN`, public `BETTER_AUTH_URL`, a unique
   `BETTER_AUTH_SECRET` of at least 32 characters, `CLIENT_URL`, and the
   narrow shared `AUTH_COOKIE_DOMAIN` when the hosts are sibling subdomains.
3. Set the web values: browser-visible `NEXT_PUBLIC_API_URL` and
   `NEXT_PUBLIC_APP_URL`, plus `API_INTERNAL_URL=http://api:5000` for server
   rendering.
4. Set a separate `MCP_REQUEST_STATE_SECRET` in production. The Compose file
   exposes the complete optional inventory from `.env.example`:
   - MCP: `MCP_RESOURCE_URL`, `MCP_ALLOWED_HOSTS`,
     `MCP_ALLOWED_ORIGINS`, and the normally-disabled `MCP_ENABLE_DCR` bridge;
   - sign-in and notifications: both Google/Microsoft client ID and secret
     pairs, plus `RESEND_API_KEY` and `EMAIL_FROM`;
   - OneDrive Materials: `ONEDRIVE_CLIENT_ID`, `ONEDRIVE_CLIENT_SECRET`,
     `ONEDRIVE_TENANT_ID`, `ONEDRIVE_REDIRECT_URI` and the public HTTPS
     `ONEDRIVE_WEBHOOK_URL`;
   - storage: `STORAGE_DRIVER=s3`, public `S3_ENDPOINT`, `S3_REGION`,
     `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_BUCKET` and
     `S3_PRIVATE_BUCKET`;
   - AI: `MISTRAL_API_KEY`, `OCR_PROVIDER`, `TRANSCRIPTION_API_KEY`,
     `TRANSCRIPTION_PROVIDER`, exact-origin `OPENAI_API_KEY`,
     `OPENROUTER_API_KEY` and `ELEVENLABS_API_KEY`, plus
     `OCR_MAX_PAGES_PER_DOCUMENT`. The legacy `INFERENCE_API_KEY` is ignored
     unless `INFERENCE_PROVIDER=openai|openrouter` binds it to one exact
     destination;
   - native renderers (normally keep defaults): `TECTONIC_BIN`, optional
     pinned `TECTONIC_BUNDLE`, persistent `TECTONIC_CACHE_DIR`, air-gapped
     `TECTONIC_ONLY_CACHED`, `PDFTOPPM_BIN`, `PDFINFO_BIN` and `MAGICK_BIN`;
   - explicit degradation: `DISABLE_EMAIL`, `DISABLE_UPLOADS`,
     `DISABLE_JOBS`, `DISABLE_OCR`, and `DISABLE_TRANSCRIPTION`.

   Leave an optional value empty when the integration is not configured. BYOK
   remains available for individual OCR and transcription users even when the
   corresponding instance fallback is empty.

5. Generate a 64-character hexadecimal `GARAGE_RPC_SECRET`, an access key ID
   beginning with `GK`, and a secret access key. Set the Compose project
   variables `GARAGE_RPC_SECRET`, `GARAGE_ACCESS_KEY_ID` and
   `GARAGE_SECRET_ACCESS_KEY`. The reference deployment reuses that key for
   the application's `S3_*` credentials, creates the `avermate` bucket and
   applies its browser CORS policy automatically.

6. Create the external network if necessary:

   ```sh
   docker network create webgateway
   ```

Public `NEXT_PUBLIC_*` values are embedded during the Next.js image build. If
your domains differ from the published image's build values, build the web
image locally with the correct values instead of relying on runtime overrides.

## Start and verify

```sh
docker compose -f deploy.yml pull
docker compose -f deploy.yml up -d
docker compose -f deploy.yml logs -f api
```

The API applies reviewed migrations before starting. Confirm the API health
endpoint, then open the web origin and create the first account. Set its ID in
`ADMIN_USER_IDS` for bootstrap administration.

This startup check is not the plan 025 clean-clone acceptance run. Before
calling an image releasable, also run the repository formatting, lint, type,
test and production-build gates, migrate both an empty and a representative
upgrade database, inspect the production dependency graph and exercise a file
upload plus one MCP read. The current candidate evidence and unresolved gates
are recorded in the
[2026-08 baseline notes](releases/2026-08-baseline.md).

## Optional integrations

The checked-in `apps/server/.env.example` is the canonical inventory. OAuth,
Resend email, OCR and transcription keys are optional. Storage needs no setup
in development (`local` is the default); production uses the bundled
self-hosted Garage service. Disable switches provide explicit local or
self-hosted degradation. Outside the `full-self-host` Node placement, a user's
sealed BYOK key may take precedence over the instance fallback. The local Node
OCR/STT placement is deliberately different: it accepts no cloud-key fallback.

### OneDrive Materials

Register a Microsoft Entra web application with the callback
`https://<api-host>/api/connectors/onedrive/callback` and delegated permissions
`User.Read` and `Files.Read`; the connector also requests `offline_access` for
background refresh. Set that callback as `ONEDRIVE_REDIRECT_URI` and expose
`https://<api-host>/api/webhooks/graph` as `ONEDRIVE_WEBHOOK_URL`.

Tokens and PKCE verifiers are sealed in the database. Folder browsing and
manual delta synchronization work without a webhook URL, but automatic change
notifications require the public HTTPS endpoint. Subscriptions and expired
delta cursors are renewed/rebuilt by durable jobs.

## Upgrades

1. Back up the database plus the `garage-meta`, `garage-snapshots` and
   `garage-data` volumes.
2. Pull or build the new images.
3. Read the generated migration SQL and release notes.
4. Run `docker compose up -d`. The API migrates before accepting traffic and
   fails closed on a migration error.
5. Verify `/health`, authentication, an SSR page and any configured provider.

Never replace a failed migration with a forced schema push.

## Backups

For Turso/libSQL, use the provider's snapshot/export facility and test a
restore regularly. For `file:` URLs, stop the API or use a SQLite-safe online
backup mechanism; copying a live database file without its journal is not a
backup. Persist the database directory explicitly because the reference
Compose file does not create a volume.

The reference Garage service is intentionally single-node and therefore has no
storage redundancy. For a serious deployment, follow Garage's cluster guide,
use multiple failure zones and replication factor 3. Do not treat a Docker
volume as a backup.

## Parity statement

Complete self-hosting exposes the capabilities implemented in this repository:
the academic core, Planning, Materials, supported synchronization providers,
document/media jobs, production embedded assistant, advanced hybrid retrieval,
learning loop and MCP. Paid upstream integrations use the operator's or
student's own supported key where BYOK exists. The repository also contains the
production Avermate Node protocol/data-plane adapters and a disabled-by-default
managed beta. Those code paths do not make managed capacity or a real sandbox
operational: activation still requires the exact provider, isolation, quota,
backup/restore and live release gates. Full self-host never requires the managed
plane or LiteLLM; both are optional placements with implemented adapters.

PRONOTE/Pawnote and Skolengo are an explicit exception to feature parity in a
production image. Their GPL dependencies and adapters are development/test-only
while the project itself has no declared licence. See
[school integrations](school-integrations.md) for the enforced matrix.

No project licence is currently declared. Possessing a checkout or running it
locally does not by itself grant redistribution rights. Plan 025 remains
incomplete until the maintainer publishes an explicit licence, third-party
notices and a compatible connector distribution decision.

## Optional managed-plane independence

The Plan 034 technical shadow modules are optional. For a deployment that does
not use Avermate-operated inference or storage, set:

```env
AVERMATE_DEPLOYMENT_MODE=full-self-host
MANAGED_ACCOUNTING_MODE=shadow
MANAGED_ADAPTERS_ENABLED=false
MANAGED_REGION=local
```

This creates the operator-controlled local entitlement policy and keeps
checkout/billing absent. The default operational exporter is `none`; the code
does not contact Avermate telemetry. Instance-owned provider keys and BYOK are
resolved locally, and an operator key is never relabeled as a paid managed
placement. Run `bun run verify:034:selfhost-airgap` against exact release images
before making an air-gap claim; an environment-variable check alone is not
network evidence. Architecture, shadow-accounting semantics and current launch
blockers are documented in [managed-plane.md](managed-plane.md).

The 035–039 repository aggregates remain distinct from their external gates:
`verify:035:live`, `verify:036:evaluation:live`, `verify:037:live`,
`verify:038:live` and `verify:039:launch`. Full self-host operators may supply
their own exact-release artifacts, but may not relabel repository fixtures,
static Compose output or a disabled provider as live evidence.
