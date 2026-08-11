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

## Acceptance matrix

| Area                        | `main` capability                                                    | Rewrite web                                                                                                                     | Expo                                                                                                   | Status                                                       |
| --------------------------- | -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------ |
| Authentication              | Password, Google/Microsoft, email OTP, reset                         | Server-rendered auth shell with equivalent flows                                                                                | Native OTP, reset and OAuth flows                                                                      | Implemented; real-device smoke remains a release gate        |
| Onboarding                  | New account and additional-year setup, presets, semesters/trimesters | Shared year setup wizard with managed presets and all period templates                                                          | Native setup with the same templates                                                                   | Implemented                                                  |
| Managed presets             | Fixed setup presets                                                  | Admin-created, immutable versions; linked/update/customized states with previews and blockers                                   | Equivalent native admin editor and year membership controls                                            | Rewrite enhancement implemented                              |
| Years                       | Select, create and configure school years                            | Select/create/edit plus reorder, archive, restore and counted deletion                                                          | Select/create/edit, reorder, archive/restore and counted deletion                                      | Implemented                                                  |
| Periods                     | Date-based and cumulative periods                                    | Identity-preserving bulk editor and ordering                                                                                    | Native create/edit/delete                                                                              | Implemented                                                  |
| Subjects                    | Nested categories/subjects, coefficients, main subjects              | CRUD, move/reparent/reorder, impact-aware subtree deletion                                                                      | Equivalent native CRUD and safe child handling                                                         | Implemented                                                  |
| Grades                      | Simple and composite grades, notes, dates, coefficients, periods     | Equivalent workflows and impact previews; timeline, hierarchy and calendar layouts                                              | Equivalent native workflows with grouped searchable history                                            | Implemented; layouts are platform-adapted                    |
| Custom averages             | Weighted entries, include descendants, headline average              | CRUD, visible subject-page cards, general/custom detail analytics and accessible ordering                                       | Native CRUD and general/custom detail analytics, including descendants                                 | Implemented                                                  |
| Calculations                | Weighted averages, cumulative periods, impacts, trends               | Shared `@avermate/core` engine                                                                                                  | Same shared engine                                                                                     | Implemented and covered by core tests                        |
| Analytics                   | Overview and subject/grade/detail analytics                          | Rich insights, hierarchy tables, radar and detail charts, including child-subject series                                        | Native insights and general/subject/custom-average detail analytics                                    | Implemented                                                  |
| Charts                      | Global, subject and grade time series                                | TanStack Charts 0.11.0, independent nearest points, semantic zoom/pan                                                           | TanStack Charts Expo DOM surface with touch, wheel and keyboard viewport controls                      | Implemented on both clients                                  |
| Time travel                 | Historical snapshot date across the app                              | Cookie/local-state timeline filters all derived views                                                                           | Native scope timeline filters the shared graph                                                         | Implemented on both clients                                  |
| Year recap                  | Seasonal story, activity percentile, music, share/export             | Rich story port with seasonal trigger and server view marker                                                                    | Native recap library and immersive story with music/share                                              | Implemented on both clients                                  |
| Goals                       | Not implemented in `main`                                            | General/subject/custom goals, plans, due dates, status and ordering                                                             | Equivalent native workflows                                                                            | Rewrite enhancement implemented                              |
| Dashboard cards             | Disabled scaffold in `main`                                          | Persistent configurable card dashboard with 21 metrics                                                                          | Native 21-metric widget library and card settings                                                      | Intentional rewrite enhancement                              |
| System widget               | None                                                                 | PWA/application dashboard only                                                                                                  | Opt-in, privacy-redacted iOS widget using `expo-widgets`; Android system widget intentionally disabled | iOS enhancement implemented                                  |
| Profile                     | Name, email and avatar                                               | Equivalent server-authoritative profile                                                                                         | Equivalent native profile                                                                              | Implemented                                                  |
| Account security            | Providers, password, sessions, export/delete                         | Link/unlink, add/change password, sessions, complete export, reset/delete                                                       | Equivalent native account controls                                                                     | Implemented                                                  |
| Appearance                  | Light/dark/system, custom palette, fonts/radius, seasons, Mokattam   | Structured light/dark studio, fonts, radius, seasons and guarded custom CSS                                                     | Native presets and synced preferences                                                                  | Implemented; final theme QA pending                          |
| Chart preferences           | Auto Y, trend controls, descendants                                  | Persisted and consumed by charts                                                                                                | Synced native preferences                                                                              | Implemented                                                  |
| Announcements               | Active banner, dismiss and history                                   | Year-scoped SSR-prefetched banner/inbox plus global or multi-preset admin audiences                                             | Native banner/inbox and equivalent targeted admin editor                                               | Implemented                                                  |
| Feedback                    | Categorised report with optional image                               | Manual and deduplicated automatic reports stored in Avermate; searchable admin triage, labels, assignment, comments and replies | Native submission/history and role-guarded triage                                                      | Implemented; no Discord relay                                |
| Administration              | Metrics, users, roles/bans, Mokattam, announcements                  | SSR-guarded analytics, deep users, announcements, presets, feedback and social moderation/audit                                 | Equivalent role-guarded native workflows                                                               | Implemented; device QA remains a release gate                |
| Private profile and friends | None                                                                 | Opt-in friend profile, field grants, requests/invitations, circles, blocks and reports                                          | Equivalent native flows                                                                                | Rewrite enhancement implemented                              |
| Private groups/classes      | None                                                                 | Invite-only groups, immutable sharing policies, re-consent, suppressed aggregate stats and opt-in rankings                      | Equivalent native group, policy and comparison flows                                                   | Rewrite enhancement implemented                              |
| Social safety               | None                                                                 | Global feature flag, age-band/guardian consent, capability-safe links, notifications, export/reset and admin moderation/audit   | Equivalent user/admin controls                                                                         | Rewrite enhancement implemented; rollout disabled by default |
| PWA / native                | Installable responsive PWA                                           | Installable manifest and install guidance                                                                                       | Full Expo application                                                                                  | Implemented                                                  |
| Legacy compatibility        | Existing data and old bookmarks                                      | Migration covers all reconstructible relations and redirects old routes                                                         | Same migrated account data                                                                             | Implemented                                                  |
| AI integration              | None                                                                 | OAuth client/consent management and MCP 2026-07-28 protected resource                                                           | OAuth client/consent management and the same remote MCP server                                         | Implemented and protocol-tested                              |
| SSR/data loading            | Client-heavy route loading                                           | Request-scoped server prefetch, shared oRPC query options, hydration and focused streaming                                      | Native TanStack Query cache and typed oRPC transport                                                   | Rewrite architecture implemented                             |

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
- Social access fails closed. A missing field grant shares nothing; a new group
  policy version stops projections until each member reconsents to its exact
  digest; undersized aggregate/ranking cohorts are suppressed.
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
