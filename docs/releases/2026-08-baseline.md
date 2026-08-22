# 2026-08 release baseline candidate

Status: **blocked candidate evidence for plan 025, not a release**.

The final baseline commit and annotated tag are intentionally pending. They may
be recorded only after the clean-clone, migration, security, image and licence
gates pass. Do not infer a release SHA from the commit that first introduced
this note, and do not mark plan 025 done from this document alone.

## Historical implementation-wave checkpoint

At the time of this candidate, the implementation base was commit
`dbd4fe87957fb23cbfd4b0815a029fc21ff6aa64` and plans 025–034 were still being
assembled in the shared working tree. Targeted tests for the agent contracts,
assistant, citations, action recovery, corpus/Node adapters and OpenSandbox
transport are green where their plan checkpoints say so. They do not replace a
single final repository-wide run or the required clean-clone acceptance of the
exact commit candidate.

Plan 025 is also governance-blocked: the repository has no maintainer-selected
project licence, completed notices or ratified connector distribution matrix.
No open-source release claim is valid until those decisions are committed.

## Product scope represented by the candidate

### Academic workspace

- owned academic years, periods, nested subjects, grade types, ordinary and
  composite grades, custom averages, bonuses and goals;
- shared average/analytics engine, configurable cards, historical views and
  year review;
- private social sharing, classes/groups, presets, feedback and administration
  behind their existing feature and authorization gates.

### School and learning-service synchronization

- ÉcoleDirecte planning and grade projections with a stable remote
  student/year binding, field-level provider ownership and local overlays;
- Moodle course/material synchronization;
- OneDrive and Google Drive read-only Materials synchronization;
- PRONOTE/Pawnote and Skolengo adapters available only in explicit development
  and test runtimes, excluded from the production registry and image while the
  project licence is unresolved.

Provider averages are not represented as Avermate averages. The latter are
calculated from the local graph, eligible synchronized grades and user-owned
configuration. See [school integrations](../school-integrations.md).

### Planning, Materials and study artifacts

- separate task-board, agenda and calendar/timetable views backed by shared
  Planning records;
- local-development and S3-compatible file storage, direct upload, folders,
  tags, stars, trash/restore, PDF/common-format viewing and durable cleanup;
- readable static-page and caption-first YouTube ingestion;
- durable PDF OCR, media/lecture transcription and batch progress when a
  provider or supported BYOK key is configured;
- revision documents, transclusion, quizzes, mind maps, LaTeX/PDF, PPTX, Anki,
  HTML and podcast artifacts.

### Interoperability

- scoped OAuth-protected MCP resource over the same academic/domain services
  used by the applications;
- ownership and role checks, bounded operations, destructive confirmation and
  idempotent replay protection.

MCP lets an external assistant interact with granted Avermate data. It is not
an embedded assistant and Avermate does not host that external conversation.

## Deployment shapes

- Development defaults to local file storage and needs no Garage service.
- The reference complete self-host deployment contains Web, API, jobs and
  Garage/S3 wiring; the operator provides domains, durable database, secrets,
  backups and optional integration/inference keys.
- The hosted academic-core product does not promise file hosting or inference
  in this baseline.
- The paired Avermate Node, visual configurator, capability placement, embedded
  assistant, versioned retrieval/citations and agent workspaces now have
  implementation in the working tree, but are not released from this candidate
  until their recorded gates and plan 025 pass. Managed service claims remain a
  separate plan-034 launch decision.

## Database and upgrade boundary

The current candidate tree contains **61** versioned migration files, from
`0000_init.sql` through `0060_wild_thanos.sql`, and 61 matching numbered Drizzle
snapshots. That count is evidence for this working candidate, not a promise that
a later release will retain the same maximum.

This tree modifies the historical `0036_lively_shiver_man.sql`, rewrites Drizzle
snapshots `0004` through `0053`, and changes the migration journal. That is an
unratified history rewrite. Before a release, it must either be replaced by an
append-only migration or explicitly approved with representative pre-0036 and
post-0036 upgrade fixtures, schema/data equivalence evidence, and an operator
compatibility note. An empty-database migration pass cannot validate existing
installations against rewritten history.

Before an upgrade:

1. back up the libSQL/SQLite database using a consistent provider snapshot or
   SQLite-safe backup;
2. back up every Garage/S3 object and the Garage metadata needed to restore it;
3. read the intervening migration SQL and these release notes;
4. run the tested migration command and stop on any failure;
5. verify authentication, an academic year and grade, Materials download/PDF
   preview, one durable job and one scoped MCP read.

Never replace a failed production migration with a forced schema push. See the
[self-hosting guide](../self-hosting.md) for the complete operational sequence.

## Earlier candidate verification observed on 2026-08-22

The following commands passed in the working candidate after its formatting
corrections:

| Gate                            | Observed result                                                                                       |
| ------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `bun install --frozen-lockfile` | Passed with Bun 1.4.0; lockfile unchanged                                                             |
| `bun run format:check`          | Passed; no worktree mutation                                                                          |
| `bun run lint`                  | Passed                                                                                                |
| `bun run check-types`           | Four workspaces passed                                                                                |
| `bun run test`                  | 1,807 passed, 0 failed, 1 opt-in live ÉcoleDirecte contract test skipped                              |
| `bun run build`                 | Server bundle and Next.js 16 production build passed; 77 static pages generated; no worktree mutation |

These results came from an earlier candidate workspace, before the complete
025–034 implementation wave. They are useful historical regression evidence but
are **not** evidence that the current working tree passes the same totals. They
do not replace the final global run, fresh-clone acceptance, migration-history
decision or production-image inspection.

## Known release exclusions and activation limits

- The embedded assistant, corpus/citations and limited action-ledger rollout
  have targeted green suites, but no pinned real-provider annotated answer
  evaluation or final release baseline yet.
- The official OpenSandbox transport exists, but no live attested provider and
  pinned image set has passed production conformance; secure sandbox execution
  is unavailable by default.
- Avermate Node has green protocol/static/local adapter cells, but production
  pairing/relay/adoption transports and the deployed full-self-host air-gap
  proof remain incomplete or host-blocked.
- Managed quotas, billing and hosted tenant sandbox remain outside this
  candidate's release claim.
- Production distribution of the PRONOTE/Pawnote or Skolengo adapters remains
  blocked by the unresolved licence/distribution decision.

## Unresolved release gates

The repository has no declared project licence. Until the maintainer publishes
one, completes third-party notices and ratifies the connector distribution
matrix, this repository must not describe itself as open source and plan 025
remains incomplete.

Before this candidate becomes a release, its final evidence must also include:

- pinned secret and deterministic personal-data scans over workspace and
  reachable history;
- empty-database and representative historical-upgrade migration fixtures;
- a clean-clone frozen install, migrations, tests, build and end-to-end smoke;
- production API/Web image builds and dependency inspection proving the GPL
  development adapters are absent;
- backup/restore evidence for tracked changes and every candidate untracked
  file from the pre-baseline workspace;
- a clean final commit and only then an annotated baseline tag.

The final release note must replace this candidate status with the verified
full commit and tag. Until then there is deliberately no baseline SHA here.
