# Feature parity: `main` → `rewrite`

This document is the acceptance matrix for the rewrite. It compares the
feature-bearing `main` snapshot at `d3f2c5ea666aa6b270cdf2cd13658e699f1ac122`
with the rewrite base at `e0f30bddc2109251f875fdfa0904565bfaeec638`.
The implementation status below includes the server, web, and mobile parity
commits `3fe2797`, `8e38e59`, and `1066b86`.

Parity means that a workflow is usable end to end, preserves the same domain
rules and is available on both the web application and the Expo application
when the platform supports it. A route, database table or unused procedure on
its own does not count as parity.

The rewrite may intentionally offer more. Its dashboard is also intentionally
different: it uses configurable metric cards and goals instead of reproducing
the layout of `main` pixel for pixel. The underlying grades, averages,
subjects, periods and analytics must nevertheless produce equivalent results.

This file now has two purposes. The first matrix preserves the historical
`main` → `rewrite` acceptance contract. The second records the broader platform
baseline assembled for plan 025. That newer baseline is not a declaration that
plans 025–034 are complete, and it does not impose a new Expo implementation
wave on server/Web agent work.

## Acceptance matrix

| Area                         | `main` capability                                                    | Rewrite web                                                                                                                     | Expo                                                                                                   | Status                                                       |
| ---------------------------- | -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------ |
| Authentication               | Password, Google/Microsoft, email OTP, reset                         | Server-rendered auth shell with equivalent flows                                                                                | Native OTP, reset and OAuth flows                                                                      | Implemented; real-device smoke remains a release gate        |
| Onboarding                   | New account and additional-year setup, presets, semesters/trimesters | Shared year setup wizard with managed presets and all period templates                                                          | Native setup with the same templates                                                                   | Implemented                                                  |
| Managed presets              | Fixed setup presets                                                  | Admin-created, immutable versions; linked/update/customized states with previews and blockers                                   | Equivalent native admin editor and year membership controls                                            | Rewrite enhancement implemented                              |
| Years                        | Select, create and configure school years                            | Select/create/edit plus reorder, archive, restore and counted deletion                                                          | Select/create/edit, reorder, archive/restore and counted deletion                                      | Implemented                                                  |
| Periods                      | Date-based and cumulative periods                                    | Identity-preserving bulk editor and ordering                                                                                    | Native create/edit/delete                                                                              | Implemented                                                  |
| Subjects                     | Nested categories/subjects, coefficients, main subjects              | CRUD, move/reparent/reorder, impact-aware subtree deletion                                                                      | Equivalent native CRUD and safe child handling                                                         | Implemented                                                  |
| Grades                       | Simple and composite grades, notes, dates, coefficients, periods     | Equivalent workflows and impact previews; timeline, hierarchy and calendar layouts                                              | Equivalent native workflows with grouped searchable history                                            | Implemented; layouts are platform-adapted                    |
| Custom averages              | Weighted entries, include descendants, headline average              | CRUD, visible subject-page cards, general/custom detail analytics and accessible ordering                                       | Native CRUD and general/custom detail analytics, including descendants                                 | Implemented                                                  |
| Calculations                 | Weighted averages, cumulative periods, impacts, trends               | Shared `@avermate/core` engine                                                                                                  | Same shared engine                                                                                     | Implemented and covered by core tests                        |
| Analytics                    | Overview and subject/grade/detail analytics                          | Rich insights, hierarchy tables, radar and detail charts, including child-subject series                                        | Native insights and general/subject/custom-average detail analytics                                    | Implemented                                                  |
| Charts                       | Global, subject and grade time series                                | TanStack Charts 0.11.0, independent nearest points, semantic zoom/pan                                                           | Native `react-native-svg` renderer with gesture-driven viewport controls                               | Implemented on both clients                                  |
| Time travel                  | Historical snapshot date across the app                              | Cookie/local-state timeline filters all derived views                                                                           | Native scope timeline filters the shared graph                                                         | Implemented on both clients                                  |
| Year recap                   | Seasonal story, activity percentile, music, share/export             | Rich story port with seasonal trigger and server view marker                                                                    | Native recap library and immersive story with music/share                                              | Implemented on both clients                                  |
| Goals                        | Not implemented in `main`                                            | General/subject/custom goals, plans, due dates, status and ordering                                                             | Equivalent native workflows                                                                            | Rewrite enhancement implemented                              |
| Dashboard cards and Insights | Disabled scaffold in `main`                                          | Versioned declarative analytics definitions, recursive formula/chart editor, persistent Dashboard and customizable Insights     | Same shared definitions, generated editor and native chart renderers                                   | Intentional rewrite enhancement                              |
| System widget                | None                                                                 | PWA/application dashboard only                                                                                                  | Opt-in, privacy-redacted iOS widget using `expo-widgets`; Android system widget intentionally disabled | iOS enhancement implemented                                  |
| Profile                      | Name, email and avatar                                               | Equivalent server-authoritative profile                                                                                         | Equivalent native profile                                                                              | Implemented                                                  |
| Account security             | Providers, password, sessions, export/delete                         | Link/unlink, add/change password, sessions, complete export, reset/delete                                                       | Equivalent native account controls                                                                     | Implemented                                                  |
| Appearance                   | Light/dark/system, custom palette, fonts/radius, seasons, Mokattam   | Structured light/dark studio, fonts, radius, seasons and guarded custom CSS                                                     | Native presets and synced preferences                                                                  | Implemented; final theme QA pending                          |
| Chart preferences            | Auto Y, trend controls, descendants                                  | Persisted and consumed by charts                                                                                                | Synced native preferences                                                                              | Implemented                                                  |
| Announcements                | Active banner, dismiss and history                                   | Year-scoped SSR-prefetched banner/inbox plus global or multi-preset admin audiences                                             | Native banner/inbox and equivalent targeted admin editor                                               | Implemented                                                  |
| Feedback                     | Categorised report with optional image                               | Manual and deduplicated automatic reports stored in Avermate; searchable admin triage, labels, assignment, comments and replies | Native submission/history and role-guarded triage                                                      | Implemented; no Discord relay                                |
| Administration               | Metrics, users, roles/bans, Mokattam, announcements                  | SSR-guarded analytics, deep users, announcements, presets, feedback and social moderation/audit                                 | Equivalent role-guarded native workflows                                                               | Implemented; device QA remains a release gate                |
| Private profile and friends  | None                                                                 | Opt-in average/history/subject sharing, requests/invitations, blocks and reports                                                | Equivalent native flows                                                                                | Rewrite enhancement implemented                              |
| Private groups/classes       | None                                                                 | Invite-only groups, fixed academic class templates, live cohort comparisons and opt-in rankings                                 | Equivalent native group and comparison flows                                                           | Rewrite enhancement implemented                              |
| Social safety                | None                                                                 | Global feature flag, ownership and sharing checks, freezes, blocks, notifications, export/reset and admin moderation/audit      | Equivalent user/admin controls                                                                         | Rewrite enhancement implemented; rollout disabled by default |
| PWA / native                 | Installable responsive PWA                                           | Installable manifest and install guidance                                                                                       | Full Expo application                                                                                  | Implemented                                                  |
| Legacy compatibility         | Existing data and old bookmarks                                      | Migration covers all reconstructible relations and redirects old routes                                                         | Same migrated account data                                                                             | Implemented                                                  |
| AI integration               | None                                                                 | OAuth client/consent management and MCP 2026-07-28 protected resource                                                           | OAuth client/consent management and the same remote MCP server                                         | Implemented and protocol-tested                              |
| SSR/data loading             | Client-heavy route loading                                           | Request-scoped server prefetch, shared oRPC query options, hydration and focused streaming                                      | Native TanStack Query cache and typed oRPC transport                                                   | Rewrite architecture implemented                             |

## Platform baseline beyond historical parity

These capabilities were added after the original parity commits. A capability
counts as implemented here only when its server and intended Web workflow are
connected; a schema or unused route alone is not sufficient.

| Area                             | Implemented baseline                                                                                                                                     | Explicit boundary                                                                                                                   |
| -------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| Planning                         | Personal tasks, academic assignments, agenda, calendar, timetable series/exceptions, school events, holidays/workdays and recording links                | Agenda, calendar and task board are separate views over shared data; the new roadmap does not require an Expo port                  |
| School-source grades             | Pending-source preview, create-or-map onboarding, stable pupil/year link, subject/period mappings, field ownership, grade authority and local overlays   | ÉcoleDirecte is distributable; PRONOTE and Skolengo remain development/test-only pending the project licence decision               |
| Materials and storage            | Folders, files, links, text, tags, stars, trash/restore, local and S3-compatible storage, direct upload, download, PDF/common-format preview and cleanup | Local development needs no Garage; production S3/Garage and destructive cleanup still require operator configuration and backups    |
| Source ingestion                 | Readable static Web pages, caption-first YouTube, Moodle, OneDrive and Google Drive course-material synchronization                                      | No arbitrary browser renderer, DRM/cookie bypass, generic video download fallback or guaranteed transcript when captions are absent |
| OCR and transcription            | Durable PDF OCR, uploaded/recorded media transcription, per-user provider keys, retries, batch enqueue and live progress                                 | Provider keys and capability switches are required; scanned content is not searchable before OCR succeeds                           |
| Study documents and artifacts    | Markdown documents, references/transclusion, quiz attempts, mind maps, slides, LaTeX/PDF, PPTX, Anki, HTML and podcast artifacts                         | No general agent workspace, visual-review loop, Manim renderer or narrated-video composition yet                                    |
| External AI access               | OAuth-protected MCP resource with scoped read/write/delete tools, ownership checks, confirmation and replay protection                                   | This is not an embedded assistant and does not host conversation history or model inference                                         |
| Embedded assistant and retrieval | None in the baseline                                                                                                                                     | Durable branches, corpus versions, hybrid retrieval, citations, harness checkpoints and in-app chat belong to plans 026–031         |
| Hybrid user backend              | Architecture documents only                                                                                                                              | Pairing, placement, Node-owned storage/conversations/search/models/sandboxes and the visual configurator belong to plan 032         |
| Managed AI/storage               | Disabled technical shadow for entitlements, reservations, usage, isolated object storage, export/deletion and operational fixtures                    | No checkout, charging or production managed dispatch; real isolation, air-gap and operational restore evidence remain blockers     |

The current deployment modes and their limitations are documented in
[self-hosting](self-hosting.md). Provider availability and ownership rules are
documented in [school integrations](school-integrations.md).

## Domain invariants preserved

- A grade, its period and its subject must belong to the same owned year.
- A subject parent must belong to the same year; a grade-bearing subject cannot
  silently become a category.
- Custom-average entries, goals and cards cannot reference another account or
  year.
- Deleting a subject either promotes its direct children or removes the full
  descendant branch, matching the confirmation shown to the user.
- Editing or reordering periods preserves retained period IDs, so existing
  grades keep their explicit period association.
- One request or one browser tab never reuses another identity's QueryClient
  cache.
- Personalised SSR data is request scoped and is never placed in a shared
  server cache.
- A linked year receives a preset update only after review. As soon as a
  student changes preset-managed subjects, custom averages, or periods, that
  year atomically enters the visible `customized` state and later admin
  versions cannot overwrite it.
- An announcement can remain global or target one or more logical presets.
  Targeting follows new preset versions, but only linked, non-detached
  memberships on active years qualify. Selecting a current year scopes the
  banner and inbox to that year; dismissed history is filtered by the same
  rule, so changing or leaving a preset cannot leak old targeted messages.
- Social access fails closed. Sharing is disabled until a member enables the
  relevant field; leaving a group, blocking a relationship or freezing a
  profile stops its projections. Class cohorts additionally require a valid,
  compatible academic template, and rank/percentile calculations stay hidden
  below their minimum sample.
- Social DTOs expose derived, allow-listed metrics and relationship
  capabilities, never raw grade rows, notes, subject names, email addresses, or
  another account's internal identifier.
- MCP OAuth scopes never bypass oRPC ownership or role checks. Destructive MCP
  operations require a signed multi-round confirmation and an idempotency key.

## Intentional differences

- The dashboard's configurable card grammar and goal cards replace the fixed
  `main` composition. This is a product decision, not a missing feature.
- The rewrite computes domain analytics in the shared core package and uses
  SSR-prefetched snapshots, while `main` used more screen-specific client
  queries. Results must remain equivalent even though data flow differs.
- The rewrite adds goals, native Expo support, managed presets, richer card
  configuration, private social sharing, centralized feedback triage, and a
  protected MCP interface. These do not permit regressions in `main`
  workflows.
- Post-parity server/Web features add Planning, Materials, provider sync and
  generated study documents without reopening a React Native parity wave.
- MCP is an external interoperability surface, not a substitute for the
  embedded assistant. The latter remains future work until its durable event,
  branch, policy and sandbox contracts are implemented.
- The web grade screen offers timeline, hierarchy, and calendar layouts. Expo
  uses a grouped native history instead of embedding a desktop calendar; the
  grade data and create/edit/detail workflows remain equivalent.
- Operating-system widgets currently target iOS only. Android still has the
  complete in-app 21-metric widget library; no unsupported Android home-screen
  extension is claimed.

## Release gates

Parity is considered complete only after all matrix rows are implemented and
the following checks pass from a clean install:

- formatting, lint, TypeScript, unit/integration tests and production builds;
- database migration from a representative legacy snapshot;
- important SSR routes, hydration and client navigation without duplicate
  initial application requests;
- mouse, precision trackpad, keyboard and touch-sized chart interaction;
- Expo iOS/Android export plus native auth, account and mutation smoke tests;
- light/dark/custom themes and both English/French catalogues;
- MCP transport, discovery, OAuth/scopes, ownership, confirmation and protocol
  conformance tests.

Plan 025 additionally requires a pinned secret/personal-data release guard,
empty and historical migration fixtures, production-image inspection and a
fresh-clone acceptance run. Passing the historical parity list alone does not
complete that plan. No open-source or production-adapter claim may be expanded
until the repository has an explicit project licence.
