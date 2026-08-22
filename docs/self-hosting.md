# Self-hosting Avermate

The reference deployment runs the API and web application behind Traefik. A
remote libSQL/Turso database is the simplest durable database; a local `file:`
database also works when its directory is mounted persistently.

## Prerequisites

- Docker with Compose support;
- a Traefik instance with a TLS certificate resolver, or an equivalent reverse
  proxy configuration;
- three DNS names: web, API and the Garage S3 endpoint;
- a durable libSQL database or a persistent volume for a local database;
- the `webgateway` Docker network expected by `deploy.yml`.

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

Self-hosted instances receive every Avermate capability. Paid integrations use
the operator's or student's own keys; no application feature is licence-gated.
The future satellite is an additional deployment shape, not a requirement for
full self-hosting.
