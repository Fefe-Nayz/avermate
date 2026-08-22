# Plan 025: Freeze a reproducible release baseline and ratify the product contract

> **Executor instructions**: Read this plan completely before staging anything.
> Preserve every user change, run every verification gate, and update the 025
> row in `plans/README.md` only after the clean-clone criteria pass. Do not push,
> open a PR or choose a licence on the maintainer's behalf. This plan cannot be
> marked `DONE`, and plan 026 cannot start, until the maintainer has selected and
> committed an explicit project licence and connector distribution policy.
>
> **Drift check (run first)**: capture `git rev-parse HEAD`,
> `git status --porcelain=v2 --branch`, `git diff --stat 37f0aff -- .` and
> `git ls-files --others --exclude-standard`. The counts need not remain 570
> because this planning wave adds files; reconcile every extra path against the
> audit inventory before continuing. Any unexplained in-scope/user change is a
> STOP condition.

> [!IMPORTANT]
> This is the entry gate for the next product wave. The current workspace contains
> the implementation of plans 020–024 and the school-sync work, but those changes
> are not represented by `HEAD`. Do not build the agent platform on top of an
> unreviewed 570-path working tree. Preserve every existing change, turn it into a
> reproducible baseline, and only then start plan 026.

## Status

- **Status**: BLOCKED — repository technical gates are green; post-commit
  clean-clone evidence and the maintainer's project-licence decision remain
- **Priority**: P0
- **Effort**: L
- **Risk**: HIGH
- **Depends on**: plans 020, 022, 023 and 024 as implemented in the current workspace
- **Blocks**: every plan from 026 onward
- **Category**: release engineering, governance, documentation
- **Planned at**: 2026-08-22, branch `rewrite`
- **Planning baseline**: commit `37f0aff`; 277 tracked files modified and 293
  untracked paths at audit time

### Implementation checkpoint (2026-08-22)

The committed 025–034 implementation base is
`15a8897ce1eb82c2807f5547d9f558a59ad9a2e1`, with the later completion wave in
the shared working tree. On 2026-08-22 the recorded baseline passed the root
monorepo test gate: **7/7 packages**, including **783 server tests passed, 1
external-network test skipped, 0 failed** and **805 Web tests passed, 0 failed**.
`bun run check-types`, `bun run lint`, `bun run format:check`, the full release
security guard and `git diff --check` also pass; the production build passed in
the same verification wave. Migration history, prefix and representative legacy
fixtures are green after cross-platform line-ending and test-budget hardening.

The current shared tree also passes the global slop/lint/type/format/release
guards. `bun run verify:025:clean-clone` still cannot validate the final
candidate until the shared wave is committed, so there is no release tag or
final release SHA yet.

The current tree contains **66** SQL migrations and **66** Drizzle snapshots,
from `0000` through append-only migration `0065`. Migration history, checksum,
fresh baseline, every historical prefix, representative legacy fixtures and a
populated `0060` → `0065` upgrade are green. The populated upgrade verifies that
all 15 dependent triggers survive the `0061` table reconstructions, then covers
the `0062` Node conversation rewrite and `0063` sealed-corpus transition; a
dedicated `0064` fixture proves immutable custom-MCP Node binding while
preserving Core sources, and `0065` persists the exact transcription-model
provenance on recording transcripts. A fresh-database pass alone is still
insufficient evidence; these upgrade gates remain mandatory for the final
candidate.

The repository still has no declared project licence. No implementation or
test result can resolve that governance decision on the maintainer's behalf;
the open-source claim and plan 025 remain blocked until the licence, notices and
connector distribution matrix are committed.

## Outcome

Produce one clean, cloneable and testable baseline that honestly describes what
Avermate already is:

- a mature academic/grade/planning core;
- a materials, ingestion, transcription and document-studio workspace;
- an OAuth-scoped MCP server;
- a full self-host deployment;
- not yet an embedded NotebookLM-style agent;
- not legally publishable as “open source” until a project licence is chosen.

The output is a reviewed commit series, a clean clone verification, a release
tag or annotated baseline commit, current documentation, and an explicit licence
decision. This plan adds no product feature.

## Current state and evidence

### The implementation is far ahead of `HEAD`

At planning time:

```text
git rev-parse --short HEAD  -> 37f0aff
git status --porcelain      -> 570 paths
tracked modifications       -> 277
untracked paths             -> 293
```

Thirty-three migrations (`apps/server/drizzle/0021_*` through `0053_*`) are
untracked. New schemas, jobs, routes, MCP surfaces and Web pages are also
untracked. A passing test run in this workspace is therefore not evidence that
a new contributor can clone and reproduce the application.

### The public product description is stale

At audit start, the plan registry still said generated video was permanently
rejected and that the embedded agent was merely a future revisit. This new
025–034 planning wave corrects that planning record, but the product/release
documentation still needs to be reconciled against the eventual clean
baseline. The current product vision has explicitly triggered the revisit.
`docs/ai-architecture.md` currently says:

```text
Avermate is MCP-first. The current product does not embed a chat agent.
```

That was a sound earlier decision, but it is no longer the target contract.
Plan 026 will supersede it after this baseline is frozen.

### The repository is source-available, not yet open source

`README.md` explicitly records that no project licence exists. Two implemented
school adapters remain development-only because their dependencies declare
GPL-3.0-or-later. A licence file is a distribution decision, not formatting:
the maintainer must choose the intended obligations before production packages
or images are changed.

## Scope

### In scope

- Preserve and inventory every current tracked and untracked change.
- Split the current work into reviewable commits by already-implemented plan or
  cohesive subsystem.
- Verify migrations from an empty database and from representative historical
  schemas.
- Verify production images and a fresh clone, not only the original workspace.
- Reconcile `README.md`, `plans/README.md`, current docs and feature flags with
  the code that actually ships.
- Decide and add the project licence, notices and connector distribution policy.
- Tag or record the exact baseline consumed by plan 026.

### Out of scope

- Chat, retrieval, embeddings, agent actions, sandbox or node implementation.
- Rewriting history or deleting existing local work.
- Enabling GPL-dependent connectors without the explicit licence decision.
- Treating database backup files as migration fixtures.
- React Native parity; this wave remains Web/server/Core only unless separately
  requested.

## Non-negotiable safety rules

1. Never use `git reset --hard`, `git clean`, `git checkout -- .`, or an
   equivalent destructive command.
2. Before staging anything, save a binary patch **and a complete archive of every
   non-ignored untracked file** outside the repository. An inventory alone is not
   a backup. Hash both artifacts, restore the archive into an empty temporary
   directory, and compare every restored path, byte length and SHA-256 digest
   with the source before continuing.
3. Do not commit `dev.db`, `*.db.bak*`, credentials, `.env` files, provider
   challenge payloads, OAuth tokens or generated user content.
4. Do not regenerate all Drizzle migrations. Existing numbered migrations may
   already encode reviewed data movement; compare and test them as written.
5. If a changed file cannot be attributed to a completed feature or intentional
   user edit, stop before staging it and ask the maintainer.

## Implementation plan

### 1. Capture a recoverable inventory

Run from the repository root:

```powershell
git status --porcelain=v2 --branch
git diff --stat
git diff --name-status
git ls-files --others --exclude-standard
git diff --check
```

Before staging, create a private backup directory outside both the repository
and any directory later copied into the repository. The archive can contain
credentials or personal material, so restrict its filesystem ACL to the current
user and the operating-system account only, never upload it, and delete it only
after the clean-clone baseline and restore drill have passed. On Windows,
disable inherited ACLs and grant explicit full control only to the current user
and `SYSTEM` on both the backup and restore roots. Verify owner and effective
ACL before writing the first patch, manifest or archive byte. Use this sequence
on the current Windows workspace:

```powershell
$repoRoot = (git rev-parse --show-toplevel).Trim()
$backupRoot = Join-Path (Split-Path $repoRoot -Parent) `
  ("avermate-baseline-backup-" + (Get-Date -Format "yyyyMMdd-HHmmss"))
$restoreRoot = Join-Path $env:TEMP `
  ("avermate-untracked-restore-" + [guid]::NewGuid().ToString("N"))
New-Item -ItemType Directory -Path $backupRoot, $restoreRoot | Out-Null

$currentIdentity = [System.Security.Principal.WindowsIdentity]::GetCurrent()
$currentUserSid = $currentIdentity.User
$systemSid = [System.Security.Principal.SecurityIdentifier]::new("S-1-5-18")

function Set-PrivateDirectoryAcl([string] $path) {
  $acl = Get-Acl -LiteralPath $path
  $acl.SetAccessRuleProtection($true, $false)
  foreach ($rule in @($acl.Access)) {
    [void] $acl.RemoveAccessRuleAll($rule)
  }
  $acl.SetOwner($currentUserSid)

  $rights = [System.Security.AccessControl.FileSystemRights]::FullControl
  $inheritance = [System.Security.AccessControl.InheritanceFlags]::ContainerInherit `
    -bor [System.Security.AccessControl.InheritanceFlags]::ObjectInherit
  $propagation = [System.Security.AccessControl.PropagationFlags]::None
  $allow = [System.Security.AccessControl.AccessControlType]::Allow
  foreach ($sid in @($currentUserSid, $systemSid)) {
    $accessRule = [System.Security.AccessControl.FileSystemAccessRule]::new(
      $sid,
      $rights,
      $inheritance,
      $propagation,
      $allow
    )
    [void] $acl.AddAccessRule($accessRule)
  }
  Set-Acl -LiteralPath $path -AclObject $acl
}

function Assert-PrivateDirectoryAcl([string] $path) {
  $acl = Get-Acl -LiteralPath $path
  if (-not $acl.AreAccessRulesProtected) {
    throw "ACL inheritance remains enabled on $path"
  }

  $ownerSid = [System.Security.Principal.NTAccount]::new($acl.Owner).Translate(
    [System.Security.Principal.SecurityIdentifier]
  )
  if ($ownerSid.Value -ne $currentUserSid.Value) {
    throw "Unexpected owner on ${path}: $($ownerSid.Value)"
  }

  $expectedSids = @($currentUserSid.Value, $systemSid.Value) |
    Sort-Object -Unique
  $rules = @(
    $acl.GetAccessRules(
      $true,
      $true,
      [System.Security.Principal.SecurityIdentifier]
    )
  )
  $actualSids = @($rules | ForEach-Object { $_.IdentityReference.Value }) |
    Sort-Object -Unique
  if (Compare-Object $expectedSids $actualSids) {
    throw "Unexpected ACL principal on $path"
  }

  foreach ($sid in $expectedSids) {
    $matchingRules = @(
      $rules | Where-Object { $_.IdentityReference.Value -eq $sid }
    )
    if ($matchingRules.Count -ne 1) {
      throw "Expected exactly one explicit ACL rule for $sid on $path"
    }
    $rule = $matchingRules[0]
    if (
      $rule.IsInherited -or
      $rule.AccessControlType -ne $allow -or
      ($rule.FileSystemRights -band $rights) -ne $rights
    ) {
      throw "ACL rule for $sid is not explicit FullControl on $path"
    }
  }
}

foreach ($privateRoot in @($backupRoot, $restoreRoot)) {
  Set-PrivateDirectoryAcl $privateRoot
  Assert-PrivateDirectoryAcl $privateRoot
}

$trackedPatch = Join-Path $backupRoot "tracked.patch"
$untrackedList = Join-Path $backupRoot "untracked-paths.txt"
$untrackedArchive = Join-Path $backupRoot "untracked.tar"
git diff --binary --full-index --output=$trackedPatch HEAD -- .
$untracked = @(git -c core.quotepath=false ls-files --others --exclude-standard)
$untracked | Set-Content -LiteralPath $untrackedList -Encoding utf8NoBOM
tar -cf $untrackedArchive -T $untrackedList

$sourceManifest = foreach ($relativePath in $untracked) {
  $absolutePath = Join-Path $repoRoot $relativePath
  [pscustomobject]@{
    path = $relativePath.Replace("\", "/")
    length = (Get-Item -LiteralPath $absolutePath).Length
    sha256 = (Get-FileHash -Algorithm SHA256 -LiteralPath $absolutePath).Hash
  }
}
$sourceManifest | Sort-Object path |
  ConvertTo-Json -Depth 3 |
  Set-Content -LiteralPath (Join-Path $backupRoot "untracked-manifest.json") `
    -Encoding utf8NoBOM

tar -xf $untrackedArchive -C $restoreRoot
$restoredManifest = foreach ($entry in $sourceManifest) {
  $restoredPath = Join-Path $restoreRoot $entry.path
  [pscustomobject]@{
    path = $entry.path
    length = (Get-Item -LiteralPath $restoredPath).Length
    sha256 = (Get-FileHash -Algorithm SHA256 -LiteralPath $restoredPath).Hash
  }
}
$manifestDiff = Compare-Object `
  ($sourceManifest | Sort-Object path | ConvertTo-Json -Depth 3) `
  ($restoredManifest | Sort-Object path | ConvertTo-Json -Depth 3)
if ($manifestDiff) { throw "Untracked backup restore verification failed" }

Get-FileHash -Algorithm SHA256 -LiteralPath $trackedPatch, $untrackedArchive |
  Format-Table -AutoSize |
  Out-String |
  Set-Content -LiteralPath (Join-Path $backupRoot "backup-artifact-sha256.txt") `
    -Encoding utf8NoBOM
```

On POSIX systems, use an owner-only `0700` directory as the semantic equivalent
before writing any backup content. Set `umask 077`, verify both owner UID and
mode for the backup and restore roots, and stop if the platform cannot report
them reliably:

```bash
set -eu
umask 077
repo_root="$(git rev-parse --show-toplevel)"
backup_root="$(mktemp -d "$(dirname "$repo_root")/avermate-baseline-backup.XXXXXX")"
restore_root="$(mktemp -d "${TMPDIR:-/tmp}/avermate-untracked-restore.XXXXXX")"
chmod 700 "$backup_root" "$restore_root"

private_dir_fingerprint() {
  case "$(uname -s)" in
    Linux) stat -c '%a:%u' "$1" ;;
    Darwin) stat -f '%Lp:%u' "$1" ;;
    *) return 64 ;;
  esac
}

for private_root in "$backup_root" "$restore_root"; do
  fingerprint="$(private_dir_fingerprint "$private_root")" || {
    echo "Cannot verify private directory ACL/mode on this POSIX platform" >&2
    exit 1
  }
  test "$fingerprint" = "700:$(id -u)" || {
    echo "Unsafe owner or mode on $private_root: $fingerprint" >&2
    exit 1
  }
done
```

Only after this guard passes may the POSIX implementation run the same binary
patch, NUL-safe untracked archive, source/restored SHA-256 manifest comparison
and artifact hashing steps. If `tar --null`, a SHA-256 implementation, owner
lookup or permission verification is unavailable, stop and use a reviewed
snapshot tool; never fall back to newline-delimited filenames or an unverified
directory.

If `tar` rejects a filename, stop and use a full filesystem snapshot tool that
preserves that filename; do not silently omit it. Assert that the patch,
archive, manifests and their checksums are non-empty where expected. Keep the
restored directory until the first commit has been independently inspected.

Create an inventory grouped into at least:

- academic core and school synchronization;
- files/storage/materials/recordings;
- documents, renderers and generated artifacts;
- planning;
- MCP and OAuth/auth migrations;
- Web UI and design system;
- deployment, CI and documentation;
- local-only artifacts that must remain uncommitted.

Record why every migration exists and the schema module that requires it. The
inventory belongs in the implementation PR/commit notes, not as another opaque
generated file in the application.

### 2. Add a reproducible secret and personal-data release gate

The gate also runs the dependency advisory audit. The only accepted advisory
exceptions are the two unfixed `image-size` parser loops documented in
`docs/security/dependency-advisories.md`; both are mitigated by a checked-in Bun
patch and timeout-fenced malicious-input regression tests.

Pin Gitleaks `8.24.3` in `tools/security/`; commit the platform archive name and
its official upstream SHA-256 in `tools/security/gitleaks-checksums.txt`. The
bootstrap script must refuse an absent checksum, a checksum mismatch, a
different version, or a fallback to `latest`. If that exact release is no
longer retrievable, changing the version and checksum is a reviewed dependency
change, not an implicit download fallback.

Add these root scripts and run the same commands in a dedicated CI job on every
pull request and protected-branch push:

```text
security:secrets:workspace  # tracked diff plus candidate untracked files
security:secrets:history    # every reachable commit in the release baseline
security:personal-data     # deterministic forbidden path/type/content rules
release:guard              # all three checks above
verify:025                 # release guard plus the complete reproducible baseline matrix
```

Implement `verify:025` with a checked-in cross-platform TypeScript runner at
`scripts/verification/plan-025.ts`. It must execute, in order, `release:guard`,
`format:check`, `lint`, `check-types`, `test`, `build`, empty-database migration
and supported-upgrade migration checks, then fail on any skipped required gate.
The clean-clone CI job performs `bun install --frozen-lockfile` before invoking
`bun run verify:025`; the runner must not mutate lockfiles or install unpinned
dependencies.

The Gitleaks configuration may contain narrowly documented false-positive
allowances, but never a blanket path exclusion for migrations, fixtures, docs or
plans. `security:personal-data` must reject at least:

- `.env` variants other than reviewed examples, private keys, cookie jars,
  provider/OAuth token dumps and challenge payloads;
- `*.db`, `*.db-*`, `*.db.bak*`, storage buckets, uploads, recordings, OCR
  outputs, generated artifacts and exported conversations unless the file is an
  explicitly synthetic fixture;
- committed absolute Windows/macOS/Linux developer-home paths, personal
  email/account identifiers in fixtures, and known production tenant IDs;
- large binary fixtures without a provenance/licence sidecar and an explicit
  size allowance.

Implement fixtures containing synthetic secrets, a fake personal path, a fake
database and a permitted `.env.example`; tests must prove the first three fail
and the example passes. Run `bun run release:guard` before every commit, after
the final commit series, and inside the clean clone. A finding is resolved by
removing/rotating the material and re-running the scanner; it is never solved by
printing the secret in logs or copying the private backup into the repository.

### 3. Establish commit boundaries without rewriting user work

Use a safety branch prefixed `codex/`, preserving the dirty tree. Suggested
commit order follows dependency order, not filename order:

1. schema migrations and shared domain primitives;
2. storage/files/jobs;
3. materials, transcription and ingestion;
4. planning and school-provider projections;
5. documents/renderers/studio artifacts;
6. MCP parity and auth/OAuth migrations;
7. Web surfaces and documentation;
8. deployment and CI.

Each commit must build on the previous one. If splitting a file would produce a
known broken intermediate state, keep that file with its cohesive subsystem and
explain the dependency in the commit body. Do not manufacture green commits by
disabling tests.

Before each commit:

```powershell
bun run release:guard
git diff --cached --check
git diff --cached --stat
git diff --cached --name-only
```

Inspect the staged patch. Use Conventional Commit messages and include the
implemented plan number where one exists.

### 4. Audit migration integrity

The migration journal and every `00xx_snapshot.json` must agree with the SQL
files and current Drizzle schema exports.

Test these paths separately:

1. empty database → all migrations;
2. database produced at the last committed migration → current;
3. representative pre-materials database → current;
4. representative pre-school-sync database → current.

Create test databases from committed migrations, never from personal `dev.db`
backup files. Assertions must cover:

- all expected tables, indexes and foreign keys;
- Better Auth/OAuth resource tables, including `oauth_resources`;
- migration idempotence through the project migration runner;
- preservation/backfill of pre-existing years, grades and users;
- no orphaned files, material documents, provider projections or artifacts.

Useful commands:

```powershell
bun install --frozen-lockfile
bun run db:migrate
bun run --cwd apps/server test scripts/migrate.test.ts
bun run --cwd apps/server test scripts/migrate-legacy.integration.test.ts
```

Add a CI fixture only when it contains synthetic data and no user material.

### 5. Verify the actual release graph

Run all repository gates after the final commit series:

```powershell
bun install --frozen-lockfile
bun run release:guard
bun run format:check
bun run lint
bun run lint:slop
bun run check-types
bun run test
bun run build
```

Also build the production images using the production install path. Confirm
that development-only PRONOTE/Skolengo dependencies are absent unless and until
the licence decision explicitly changes that policy.

Create a fresh clone in a separate temporary directory, install with the frozen
lockfile, migrate an empty database, run the server and Web build, and exercise:

- sign-up/sign-in and OAuth tables;
- an academic year with a grade and average;
- local file upload without Garage in development;
- material view and PDF preview;
- one background job and its SSE/polling fallback;
- MCP discovery and one read-only call.

The fresh clone is the acceptance environment. The original workspace is not.

### 6. Ratify the licence and distribution matrix

The maintainer must make one explicit project-level choice with appropriate
legal review. At minimum compare:

- a copyleft route compatible with the desired hosted-service reciprocity;
- a permissive route that keeps GPL-dependent adapters outside distributed
  production artifacts unless replaced;
- the contribution policy and third-party notice obligations for either route.

Then:

- add the chosen `LICENSE` file;
- update package metadata and README claims;
- add `THIRD_PARTY_NOTICES.md` or the chosen equivalent;
- document source-offer/network-use obligations if applicable;
- encode the PRONOTE/Skolengo release decision in tests and image inspection;
- record that BlocksHub's Blockscho/AppScho is a distinct provider candidate,
  not a drop-in replacement for Skolengo, and give any future adapter its own
  dependency/licence row;
- remove the temporary `license-unresolved` gate only after the chosen licence
  and connector matrix are committed and verified in the production images.

Do not silently infer that “free SaaS” or “public GitHub repository” selects a
licence. If the maintainer has not made the decision, record the release gate as
`BLOCKED`: the technical commit split may be reviewed, but plan 025 is not
`DONE`, no open-source claim is allowed, and plan 026 remains blocked.

### 7. Preserve only a sanitized Fichr design reference

Inspect the historical Fichr working tree read-only at commit `b8c5714` and
create `docs/references/fichr-chat-poc.md`. The note must be sufficient for a
future executor without access to that local repository and contain only:

- the source commit and, when configured, its non-secret upstream repository
  URL;
- the observed UX concepts: thread search, model selection, edit/retry branch
  navigation, streaming status/tool blocks and copy/export actions;
- the observed architectural failures: persistence and runtime coupling,
  post-execution boolean approval, and shell execution crossing the trust
  boundary;
- a “reference, not porting material” decision and the acceptance implications
  for plans 026 and 029.

Do not copy conversations, database rows, prompts, credentials, absolute local
paths, screenshots containing user data, or source code into the note. Run the
release guard against it. If the commit cannot be verified, label each claim as
unverified instead of relying on a machine-specific path.

### 8. Reconcile product documentation

Update the source-of-truth documents to match the frozen code:

- `README.md`: school-first NotebookLM thesis, current deployment modes and
  honest feature matrix;
- `plans/README.md`: include plans 020/021, record the new 025+ wave and remove
  now-superseded “never build” wording;
- `docs/feature-parity.md`: current Web/server scope;
- `docs/school-integrations.md`: production/dev connector matrix;
- `docs/self-hosting.md`: verified clean-clone instructions;
- `docs/references/fichr-chat-poc.md`: sanitized, portable UX evidence only;
- release notes: migration count, upgrade procedure and known limitations.

Do not supersede `docs/ai-architecture.md` or `docs/satellite-protocol.md` in
this step beyond marking the upcoming decision. Plan 026 owns that change.

### 9. Mark the baseline

Record the final full SHA in plans 026–034 and in the release notes. Prefer an
annotated tag such as `agent-platform-baseline-2026-08` only after CI, fresh
clone and image checks pass. The tag must point to a clean commit.

## Test matrix

| Area     | Required evidence                                                            |
| -------- | ---------------------------------------------------------------------------- |
| Git      | clean tracked tree; local-only artifacts intentionally ignored or documented |
| Install  | frozen install succeeds in a fresh clone                                     |
| Database | empty and historical migrations reach the same expected schema               |
| Server   | tests, typecheck and production build pass                                   |
| Web      | tests, lint, typecheck and Next production build pass                        |
| MCP      | OAuth discovery plus representative read/write confirmation tests pass       |
| Storage  | local dev path and production S3/Garage path are both exercised              |
| Images   | production dependency graph matches the connector licence policy             |
| Docs     | feature and deployment claims match observed behavior                        |
| Security | pinned/checksummed Gitleaks, personal-data guard and CI all pass             |
| Recovery | patch and full untracked archive restore to byte-identical manifests         |
| Licence  | explicit project licence and connector distribution matrix are committed     |

## Done criteria

- `git status --short` is empty after cloning the baseline and running the
  documented build without generating tracked drift.
- Every migration through the then-current maximum is committed, journaled and
  covered by empty/upgrade tests.
- Full CI and clean-clone smoke tests pass.
- The baseline SHA is recorded and consumed by plan 026.
- A project licence, third-party notices and connector distribution policy are
  explicit, committed and reflected by production dependency/image checks.
- The full untracked archive has been restored and its path/length/SHA-256
  manifest matches the original; the tracked patch and archive hashes are
  recorded outside the repository.
- Pinned Gitleaks history/workspace scans, deterministic personal-data checks and
  their CI job pass from the clean clone.
- `docs/references/fichr-chat-poc.md` is portable, sanitized and passes the
  release guard.
- No personal database, secret or user artifact entered history.

## STOP conditions

- A current change cannot be attributed safely.
- A migration produces data loss, divergent schemas or an unrecoverable upgrade.
- A secret scanner reports a credential or user data in the staged history.
- The untracked archive cannot be restored byte-for-byte or any source path was
  omitted from its manifest.
- The licence decision is being guessed rather than made by the maintainer.
- Production builds differ materially between the original workspace and fresh
  clone.

## Rollback and recovery

Rollback is commit-by-commit with ordinary `git revert`; never rewrite the
shared baseline. Database rollback is restore-from-backup plus the prior image,
not reverse-running destructive migrations. Keep the pre-upgrade database
backup until the clean-clone and representative upgrade checks have both passed.

## Maintenance notes

- Future plan status may be marked `DONE` only when its code is committed and
  reproducible from a clean clone.
- Every new migration adds an upgrade fixture or an explicit reason why the
  generic fixture covers it.
- Re-run production image dependency/license inspection on dependency upgrades.
- Keep the release baseline small enough that a new contributor can reproduce
  it from the README without access to the original developer machine.
