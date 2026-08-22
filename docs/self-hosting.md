# Self-hosting Avermate

The reference deployment runs the API and web application behind Traefik. A
remote libSQL/Turso database is the simplest durable database; a local `file:`
database also works when its directory is mounted persistently.

This guide describes the current **complete self-host** shape: one operator
runs the Web application, account/academic API, jobs, database connection and
file storage. It must not be confused with the developing Avermate Node product,
which will pair selected user-owned capabilities with an account hosted on
`avermate.fr`.

## Deployment modes

| Mode                                  | Current status       | Data and execution boundary                                                                                                                         |
| ------------------------------------- | -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| Local development                     | Implemented          | Local SQLite-compatible database and local file storage work without Garage; optional provider keys enable OCR/transcription                        |
| Complete self-host                    | Release candidate    | Operator owns Web, API, local database/storage and configured providers; final Compose/air-gap proof is still blocked by the test host              |
| Hosted academic core                  | Product mode         | Accounts and academic data may be hosted on `avermate.fr`; this baseline promises neither hosted file storage nor hosted inference                  |
| Hosted core plus user Avermate Node   | Developer foundation | Protocol, filesystem storage, local configurator and fail-closed routing exist; the hosted Core registry/relay and advanced providers are not wired |
| Optional managed AI and file capacity | Planned              | Plan 034 owns quotas, metering, tenant-isolated execution, managed storage/inference and billing                                                    |

The current repository exposes scoped MCP and an embedded read-only assistant
with a deterministic local fixture model. It does not yet include a proven
general execution runtime. It contains fail-closed sandbox/provider contracts
and a conformance matrix described in
[`sandbox-runtime.md`](sandbox-runtime.md), but every real provider remains
unavailable until its transport, immutable images and host-produced baseline
evidence pass conformance. Self-hosting the current stack does not manufacture
those future capabilities.

The Plan 032 foundation is documented in
[`avermate-node-protocol.md`](avermate-node-protocol.md). In particular,
`dev-zero` can boot directly with filesystem storage and no Garage. The
`node-storage` profile and disposable Garage v2.3 provider pass the shared
storage conformance suite. That does not make the custom-node product flow
complete: hosted pairing/relay, production conversation/retrieval/model/sandbox
transports, durable adoption repository wiring and the final full-self-host
air-gap proof still fail closed.

The profile-aware Compose source is `infra/compose/avermate.yml`; public Node
configuration is generated/validated against
`infra/node/config.schema.json`. `docker compose ... config` is only a static
syntax/interpolation check. It is not boot, backup, restore, isolation or
air-gap evidence.

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
   - AI: `MISTRAL_API_KEY`,
     `TRANSCRIPTION_API_KEY`, `TRANSCRIPTION_PROVIDER`, `INFERENCE_API_KEY`,
     and `OCR_MAX_PAGES_PER_DOCUMENT`;
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
self-hosted Garage service.
Disable switches provide explicit local or self-hosted degradation. When
per-user BYOK is configured, a user's sealed key takes precedence over the
instance fallback.

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
document jobs, embedded read-only assistant and MCP. Paid upstream integrations
use the operator's or student's own supported key where BYOK exists. The
repository does not yet contain a production Avermate Node data plane, managed
capacity or an enabled general sandbox described by plans 026–034. Sandbox
contracts and corpus foundations are not the same as an operational provider or
complete product surface.

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
