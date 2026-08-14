# Plan 008: Build the provider sync framework and the Moodle connector (TypeScript port)

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat 46c966b..HEAD -- apps/server/src/db/schema apps/server/src/routers apps/server/src/lib apps/web/src/app`
> This plan REQUIRES plans 001 (files), 002 (jobs) and 005 (materials) DONE —
> verify their Done criteria first. On excerpt mismatch, STOP.

## Status

- **Priority**: P2 (wave 2)
- **Effort**: L
- **Risk**: MED
- **Depends on**: plans/001, 002, 005 (hard); 003 for the MCP step
- **Category**: direction
- **Planned at**: commit `46c966b`, 2026-08-14

## Why this matters

The product thesis is "NotebookLM × Papillon": one open-source app that pulls
the student's school life from the services their school imposes and makes it
AI-legible. The first connector is Moodle — the maintainer's prototype already
proved it end to end, and the audited code shows it is NOT a scraper but a
clean Moodle Web Services REST client (three WS functions + token-authorized
downloads), ~250 lines to port. But Moodle must not be hardcoded: Papillon's
value came from a provider layer (Pronote, EcoleDirecte, Skolengo…), and those
providers expose more than files — homework, timetables, even grades. This
plan builds the provider abstraction with a capability model, ships the Moodle
connector for the `files` capability, and runs syncs as plan-002 jobs feeding
plan-005 materials.

## Current state

### The prototype client to port (audited 2026-08-14)

`C:\Users\ferre\Downloads\Math-M. Coutens\moodle_sync.py` (790 lines; working
copy of `github.com/Fefe-Nayz/Fichr@prototype`):

- **Auth**: a Moodle WS token obtained via the mobile-app SSO handshake.
  `setup` prints `{base}/admin/tool/mobile/launch.php?service=moodle_mobile_app&passport=TOKEN123&confirmed=1`;
  after SSO the browser redirects to
  `moodlemobile://token=<base64("SITEID:::TOKEN")>`; `parse_moodle_token()`
  (`:338-380`) accepts the full deep link, the raw base64, or a bare token.
  No password login, no cookie scraping.
- **Transport**: every call is
  `POST {base}/webservice/rest/server.php` with form fields
  `wstoken`, `wsfunction`, `moodlewsrestformat=json` (`:124-147`); Moodle
  errors arrive as `{exception, errorcode, message}` in a 200 response.
- **Discovery**: exactly three WS functions —
  `core_webservice_get_site_info` (validates token, returns `userid`),
  `core_enrol_get_users_courses`, `core_course_get_contents`. File walk keeps
  `type == "file"` module contents, dedupes on `fileurl`, and carries
  `section/module/mod_type/filepath/timemodified/filesize/mimetype`.
- **Download**: pluginfile URL + `?token=<token>`, streamed.
- **Tree mirroring** (`build_moodle_path`, `:498-530`): section dir (skipped
  when it starts with "général"), plus the module name when
  `mod_type == "folder"`, plus internal `filepath` segments; components
  sanitized (`<>:"/\|?*` stripped, trailing dots trimmed, 100-char cap).
- **Defects the port MUST fix** (verified in code):
  1. `timemodified` is collected (`:211`) and never compared — a professor
     replacing a PDF at the same URL is never re-fetched.
  2. State is a flat JSON `{fileurl: md5}` rewritten after EVERY download
     (`:69-94`) — becomes a table.
  3. No retries/backoff at all (the OCR pipeline has them; sync does not).
  4. `session.verify = False` + warning suppression (`:39`, `:120`) — the
     token transited unverified TLS. NEVER port this; TLS verification stays
     on, with an optional per-connection custom CA (PEM) for schools with
     private chains. (The maintainer should regenerate the token once.)
  5. Extension filter hardcoded to `{.pdf,.png,.jpg,.jpeg}` (`:549`) ignoring
     config.

### Avermate side

- Plan 001: `files` table + `lib/storage.ts` (`storeFile({ purpose, ... })`).
- Plan 002: `jobs` table, `registerJobHandler(kind, fn)`, `enqueueJob` with
  `(userId, kind, idempotencyKey)` dedupe, status via `jobs` router.
- Plan 005: `material_folders` / `material_documents` with `origin` columns
  ("manual" | "moodle") and `metaJson` (typed JSON + version) reserved for
  sync identity.
- Secrets-at-rest: no existing encryption helper in `apps/server/src/lib`
  (verify with `grep -rn "createCipheriv\|encrypt" apps/server/src/lib`) —
  Step 2 adds one.
- Settings surface exists: `apps/web/src/app/(app)/settings/integrations/`
  is already a route — the connection UI lands there.
- Conventions: schema spreads `owner()`/`timestamps` (`db/schema/app.ts:24-36`),
  `newId(prefix)`, ownership helpers in `lib/ownership.ts`, routers modeled on
  `goals.ts`, registration in `routers/index.ts`, env pattern
  (`lib/env.ts:46-53` optional keys + `DISABLE_*`).

## Commands you will need

| Purpose | Command | Expected |
|---------|---------|----------|
| Migration | `bun run db:generate` && `bun run db:migrate` | exit 0 |
| Typecheck / tests | `bun run check-types` / `bun run --cwd apps/server test` | exit 0 |
| Full gate | `bun run format:check && bun run lint && bun run check-types && bun run test && bun run build` | exit 0 |

## Scope

**In scope**:
- `apps/server/src/db/schema/sync.ts` (create: `syncConnections`, `syncedResources`) + index export + migration
- `apps/server/src/lib/crypto.ts` (create: AES-256-GCM seal/open helpers)
- `apps/server/src/sync/provider.ts` (create: interfaces + registry), `apps/server/src/sync/moodle.ts` (create: the connector)
- `apps/server/src/jobs/handlers.ts` (register `sync.run`)
- `apps/server/src/routers/sync.ts` (create) + `routers/index.ts` + `lib/ownership.ts` (`requireSyncConnection`)
- `apps/server/src/sync/moodle.test.ts`, `apps/server/src/routers/sync.test.ts` (create)
- `apps/server/src/mcp/surfaces/` — extend the materials surface with `sync.status`/`sync.trigger` (write scope) if 003 is DONE
- `apps/web/src/app/(app)/settings/integrations/**` (connection UI) + messages

**Out of scope**:
- Pronote / EcoleDirecte / Skolengo connectors — the interface anticipates
  them (capability model below); evaluating the Papillon ecosystem's TS
  libraries (e.g. `pawnote` for Pronote) is a later spike. Do not add those
  dependencies now.
- Grades/homework/timetable ingestion — capabilities are DECLARED in the
  interface but only `files` is implemented; wiring homework into planner
  items or grades into the year is future work with real product decisions.
- Mobile connection UI (web-only for v1; mobile reads the synced result).
- Scheduled automatic sync (manual + MCP-triggered only; a recurring job is a
  one-line follow-up once wanted).

## Git workflow

- Branch: `advisor/008-provider-sync` from `rewrite`; conventional commits
  (e.g. `feat(server): provider sync framework and moodle connector`).
- Do NOT push or open a PR unless instructed.

## Steps

### Step 1: Schema

`apps/server/src/db/schema/sync.ts`:

```ts
export type SyncProviderId = "moodle";           // widens later: "pronote" | "ecoledirecte" | ...
export type SyncCapability = "files";            // later: "homework" | "timetable" | "grades"

export const syncConnections = sqliteTable("sync_connections", {
  id: text().notNull().primaryKey().$defaultFn(() => newId("sconn")),
  provider: text().$type<SyncProviderId>().notNull(),
  label: text().notNull(),                        // "Moodle PSI", user-facing
  baseUrl: text().notNull(),
  /** AES-256-GCM sealed credential blob (token etc.), never plaintext. */
  sealedCredentials: text().notNull(),
  /** Optional PEM chain for schools with private CAs; verify stays ON. */
  caCertPem: text(),
  capabilities: text({ mode: "json" }).$type<SyncCapability[]>().notNull(),
  status: text().$type<"active" | "error" | "revoked">().notNull().default("active"),
  lastSyncAt: integer({ mode: "timestamp" }),
  lastError: text(),
  yearId: text().notNull().references(() => years.id, { onDelete: "cascade", onUpdate: "cascade" }),
  userId: owner(),
  ...timestamps,
});

export const syncedResources = sqliteTable("synced_resources", {
  id: text().notNull().primaryKey().$defaultFn(() => newId("sres")),
  connectionId: text().notNull().references(() => syncConnections.id, { onDelete: "cascade", onUpdate: "cascade" }),
  capability: text().$type<SyncCapability>().notNull(),
  /** Provider-native identity, e.g. the Moodle fileurl. */
  externalId: text().notNull(),
  externalModifiedAt: integer({ mode: "timestamp" }),   // Moodle timemodified
  contentHash: text(),
  /** What it became locally, e.g. the material_documents id. */
  localKind: text().notNull(),                          // "materialDocument"
  localId: text().notNull(),
  syncedAt: integer({ mode: "timestamp" }).notNull(),
  userId: owner(),
}, (t) => [
  uniqueIndex("synced_resources_conn_ext_unique").on(t.connectionId, t.externalId),
  index("synced_resources_local_idx").on(t.localKind, t.localId),
]);
```

**Verify**: migration generated + applied; `bun run check-types` exit 0.

### Step 2: Sealed credentials helper

`apps/server/src/lib/crypto.ts`: `seal(plaintext: string): string` /
`open(sealed: string): string` using `node:crypto` AES-256-GCM with a key
derived from `env.BETTER_AUTH_SECRET` via HKDF (`crypto.hkdfSync("sha256",
secret, "avermate-sync", "credential-sealing", 32)`); output format
`v1.<iv b64>.<ciphertext b64>.<tag b64>`. Unit-test roundtrip + tamper
rejection in `crypto.test.ts`. Never log or return `sealedCredentials` or its
plaintext from any procedure.

**Verify**: `bun run --cwd apps/server test` → crypto tests pass.

### Step 3: Provider interface + Moodle connector

`apps/server/src/sync/provider.ts`:

```ts
export interface ProviderFile {
  externalId: string;            // fileurl for Moodle
  fileName: string;
  folderPath: string[];          // mirrored tree segments, already sanitized
  mimeType: string | null;
  byteSize: number | null;
  modifiedAt: Date | null;       // timemodified
  courseRef: { externalId: string; name: string };
}
export interface SyncProvider {
  id: SyncProviderId;
  capabilities: SyncCapability[];
  /** Turn user input (deep link, base64, raw token) into sealed-able credentials; throws with a user-safe message. */
  parseCredentialInput(baseUrl: string, input: string): Promise<{ credentials: string; accountLabel: string }>;
  listCourses(conn: OpenConnection): Promise<{ externalId: string; name: string }[]>;
  listFiles(conn: OpenConnection, courseExternalId: string): Promise<ProviderFile[]>;
  download(conn: OpenConnection, file: ProviderFile): Promise<Blob>;
}
export const SYNC_PROVIDERS: Record<SyncProviderId, SyncProvider> = { moodle: moodleProvider };
```

`apps/server/src/sync/moodle.ts` implements it with `fetch`: the three WS
functions, the error-envelope unwrap, the deep-link/base64/raw token parser
(port the three accepted shapes), the tree mirroring rules (section dir minus
"général" prefix, folder-module dir, internal filepath segments, the exact
sanitization: strip `<>:"/\|?*`, trim trailing dots, 100-char component cap),
and streamed downloads. Retry/backoff on 429/5xx/network errors: exponential
1s→20s cap, 6 attempts (mirror the prototype's OCR helper semantics). TLS:
default verification; when `caCertPem` is set, pass a custom CA to Bun's fetch
(`tls: { ca }` on the request or an agent — verify Bun's current API and STOP
if custom-CA fetch is not supported in the pinned Bun version; in that case
record the limitation and skip the CA feature, never disable verification).
Accepted extensions come from a module const
`SYNC_FILE_EXTENSIONS = [".pdf", ".png", ".jpg", ".jpeg", ".webp"]` — one
place, honored, unlike the prototype.

**Verify**: `bun run check-types` exit 0; `sync/moodle.test.ts` covers the
token parser (3 input shapes + garbage), the error-envelope unwrap, and the
path mirroring rules with fixture JSON (no network — inject a `fetch` stub).

### Step 4: The `sync.run` job

Register in `apps/server/src/jobs/handlers.ts`: payload
`{ connectionId }`, idempotency key `connectionId + UTC date-hour` (manual
re-runs within the hour replay the stored result). The handler:

1. Load + `open()` credentials; provider = `SYNC_PROVIDERS[conn.provider]`.
2. `listCourses` → `listFiles` per course.
3. For each file: look up `syncedResources` by `(connectionId, externalId)`.
   Skip when `externalModifiedAt` is unchanged AND a local document still
   exists. Otherwise `download` → `storeFile({ purpose: "course-material" })`
   → upsert the `material_folders` path (`origin: "moodle"`, reusing plan
   005's tree helpers) → create or update the `material_documents` row
   (`origin: "moodle"`, new `fileId`; the replaced old `files` row is
   `deleteFile`d) → upsert `syncedResources`.
4. Locally deleted synced documents are NOT resurrected: if the
   `syncedResources` row exists but its `localId` no longer resolves, leave
   both alone (the user deleted it on purpose) — record the rule in a comment.
5. Return `{ downloaded, updated, skipped, errors }` as the job result;
   set `lastSyncAt`/`lastError` on the connection.

**Verify**: handler unit test with a stubbed provider (in-memory DB bootstrap;
no network): first run downloads 2 fixture files; second run skips both;
bumping `modifiedAt` re-downloads exactly one and swaps the document's
`fileId`.

### Step 5: Router + web UI

`routers/sync.ts` (+ `requireSyncConnection`): `connections.list`,
`connections.create` (input baseUrl + pasted token/deep-link → provider
`parseCredentialInput` → `seal` → insert; NEVER return credentials),
`connections.delete` (destructive semantics: plain procedure here; MCP wraps
destructively), `run` (`enqueueJob("sync.run")`, returns `jobId`),
`status` (connection + last job). Web: in
`apps/web/src/app/(app)/settings/integrations/`, a "Connected services" card
list — provider picker (Moodle only), base URL + paste-the-link field with the
handshake instructions (show the `launch.php?...&passport=...` URL for THEIR
base URL and explain the `moodlemobile://` redirect copy-paste), sync-now
button polling `jobs.get`, last-sync status line. en/fr messages.

**Verify**: `bun run --cwd apps/server test` exit 0; manual: create a
connection against a stubbed/unreachable base URL → clean user-safe error; UI
renders states.

### Step 6: MCP exposure (if 003 DONE)

Extend the materials surface (or a small `sync` surface appended in
`surfaces/index.ts`): `sync.status` (read scope) and `sync.trigger` (write
scope, enqueues the job and returns `jobId` — the agent then polls the jobs
tool if plan 002 exposed one, else returns the final connection status).
Update harness enumerations + `docs/mcp.md`.

**Verify**: `bun run --cwd apps/server test` exit 0.

### Step 7: Full gate

**Verify**: all root gates exit 0.

## Test plan

Per steps 2–4: crypto roundtrip/tamper; token-parser shapes; envelope unwrap;
path mirroring fixtures; sync job first/skip/re-download flows with stubbed
provider and in-memory DB (bootstrap pattern:
`integrity.integration.test.ts:8-130`). No test touches the network.

## Done criteria

- [ ] Migrations create `sync_connections` + `synced_resources`; fresh migrate exits 0
- [ ] `grep -rn "verify = false\|rejectUnauthorized: false" apps/server/src` → no matches (TLS never disabled)
- [ ] `grep -rn "sealedCredentials" apps/server/src/routers/sync.ts` shows it is written but never selected into a response
- [ ] Sync job tests prove: initial download, unchanged skip, `timemodified`-driven re-download (the prototype's #1 defect is fixed)
- [ ] Connection UI exists under settings/integrations with the handshake instructions
- [ ] All root gates exit 0; `git status` clean outside scope
- [ ] `plans/README.md` status row updated

## STOP conditions

- Plans 001/002/005 not actually DONE.
- Bun's fetch cannot do custom-CA per-request in the pinned version AND a
  school CA is required for testing — ship without the CA feature, never with
  verification off; report.
- The UploadThing transport (plan 005's decision) rejects typical course PDFs
  during real testing — report with sizes; do not raise caps ad hoc.
- Moodle WS responses in real testing do not match the prototype's assumed
  shapes (envelope, contents walk) — capture the payload shape and report.

## Maintenance notes

- Adding a provider = one file implementing `SyncProvider` + a
  `SyncProviderId` union member + a settings-UI picker entry. The Pronote /
  EcoleDirecte spike should start from the Papillon ecosystem's TS clients
  (e.g. `pawnote`) and will add non-`files` capabilities (homework →
  planner items, timetable → agenda events, grades → grade import) — each of
  those crossings is a product decision needing its own plan; the
  `capabilities` column and `SyncCapability` union are the prepared seam.
- The maintainer should regenerate their Moodle token once TLS-verified sync
  works (the old one transited unverified TLS in the prototype).
- Reviewer attention: credentials never in logs/responses; the
  deleted-locally rule (step 4.4); `syncedResources` uniqueness under re-runs.
