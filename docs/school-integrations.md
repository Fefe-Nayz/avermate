# School-service integrations

This document is the current product and implementation contract for school
connections. Historical design reasoning remains in plan 021, but that plan is
not an execution checklist.

## Connected-year contract

### The local year belongs to the user

A school connection never owns or locks an Avermate academic year. The user can
create personal grades, rename and reorganize subjects, tune local subject
coefficients and bonuses, and continue using the year without a connection. A
year created from a provider is **bootstrapped**, not provider-owned: the first
preview seeds useful subjects and periods, then the resulting local structure
remains editable.

The immutable object is the link, not the year. Its remote scope is:

```text
(user, provider, canonical instance/baseUrl, remote student, remote academic year)
  -> one local Avermate year
```

`baseUrl` is part of the identity because two establishments can expose the
same provider and overlapping remote identifiers. The same student/year tuple
on two canonical provider instances is therefore two different remote scopes.
Conversely, reconnecting a stable student cannot silently move that link to a
different instance. A bound link is not rebound when the local year is renamed
or its dates are adjusted; correcting a genuinely wrong remote scope requires
removing that link and creating the right one explicitly.

When a provider supplies a stable academic-year identifier, Avermate stores it
verbatim. When it does not, the fallback is the canonical
`school-year:<YYYY>` identifier, derived from the start of the provider window
in the school's IANA time zone. Exact local date boundaries are deliberately
not encoded in that fallback, so a day-level edit cannot manufacture a second
remote year for the same pupil and establishment.

The first connection remains a one-time onboarding choice after preview:

- **Create the suggested year** bootstraps a new, user-owned local year.
- **Add to an existing year** maps provider subjects and periods into an
  explicitly selected local year.

Names are only initial matching hints. The stable remote subject/period IDs are
mapped to local IDs, and later renames on either side do not silently rebind the
mapping. Unmatched or ambiguous entries require an explicit choice.

### Ownership is field-by-field

Provider ownership is intentionally narrower than row ownership:

| Object  | Provider-owned, synchronized facts                                                                       | User-owned local state                                                                     |
| ------- | -------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| Grade   | remote identity, title, value, scale (`outOf`), coefficient, date, subject/period mapping and components | bonus, assessment type, personal note, attachments and the personal include/exclude choice |
| Subject | remote subject identity and the mapping that targets a local subject                                     | local name/short name, hierarchy, kind, coefficient, bonus and ordering                    |
| Period  | remote period identity and the mapping that targets a local period                                       | local name, dates, cumulative flag and ordering                                            |
| Year    | remote link described above                                                                              | local name, dates, organization and all personal data                                      |

The server rejects edits to provider-owned grade facts even if a stale client
sends them back. A refresh can update those facts, but it must preserve local
overlays. The system-owned `syncExcludedFromAverage` gate is separate from the
user-owned `excludedFromAverage` choice: authority changes, missing data,
disconnects and mapping repairs can change the former without erasing the
latter.

Detaching is not a fourth provider-record state. It atomically creates a new
personal grade (including its components and attachments), marks the original
provider snapshot as a durable `dismissed` tombstone, and removes the managed
local projection. The personal copy is then fully editable, while the
tombstone prevents the next synchronization from resurrecting the provider
version. A plain dismissal uses the same durable tombstone without creating the
personal copy.

### Grade authority and honest averages

A local year may have zero or one authoritative school connection for grades.
Zero leaves a fully personal year. One lets eligible results from that source
participate alongside personal grades. A second provider can still be linked
for other capabilities, but its grade projection cannot contribute at the same
time. Selecting an authority is allowed only for a grade-capable,
credential-bearing connection bound to that same year; switching authority
reconciles every provider grade atomically.

Even for the authority, only a `managed`, significant, numeric result with a
positive scale and still-valid subject/period mappings is eligible. Missing,
dismissed, unmapped, non-numeric, disconnected and non-authoritative results
stay outside the calculation through the system gate. Personal grades and the
user's own exclusion choices remain independent.

An **Avermate average** is calculated from Avermate's local graph: eligible
provider results, personal results, local overlays and local subject
configuration. It is not an “official” school-service average. Providers do
not expose a sufficiently complete common contract for hidden weighting,
rounding, optional results or administrative corrections, so numerical equality
must never be promised. If an adapter later imports an official aggregate, it
must be displayed separately as a read-only **service average**, with its
source and synchronization time, rather than replacing the Avermate result.

### Disconnect, reconnect and purge

Disconnecting destroys the credential envelope and marks the connection
inactive, but keeps its cached snapshots, mappings and local projection so the
year does not empty out. Those provider grades are immediately
system-excluded from averages and must be presented as non-active/stale until a
successful reconnect restores an eligible authoritative projection. Reconnect
keeps the same provider instance and stable pupil identity; it does not rebind
the connection to another tenant.

Permanent purge is a separate, confirmed operation. It removes the connection
and its managed projection; it is never implied by disconnecting or by a
temporary provider failure.

## Provider boundary

School integrations use one sealed `sync_connections` credential envelope and
independent provider facets:

- `homework` publishes academic assignments;
- `timetable` publishes concrete timetable occurrences;
- `school-calendar` publishes school events, holidays, and work days;
- `grades` writes a durable provider snapshot, then materializes only mapped,
  numeric and significant results into the local grade graph;
- `attachments` normalizes and streams provider files but remains a preview
  facet until Materials can preserve provider ownership and dismissal state.

Every active Planning publication sets `sourceConnectionId`, a namespaced
`externalId`, and `syncState = managed`. A refresh updates only provider-owned
fields. It preserves `localNote`, `completedAt`, dismissed tombstones, and
detached local copies. A remote item absent from a fully refreshed window moves
to `missing`; it is never hard-deleted. Providers must explicitly declare a
facet as a complete-window response before this reconciliation is allowed.
ÉcoleDirecte does not currently advertise any facet as complete-window: the
upstream SDK does not document response completeness or range caps. Missing
rows are therefore never inferred as deletions from an ÉcoleDirecte refresh.

Grade synchronization has its own provenance model. Provider-owned facts
(title, value, scale, coefficient, date, subject, period and components) are
locked; bonus points, assessment type, personal notes and the user's
include/exclude choice remain local overlays. A separate synchronization gate
keeps stale, unmapped, non-numeric or non-authoritative results out of averages
without overwriting that personal choice. Non-numeric results remain in the
provider snapshot even though the canonical `grades` table is numeric.

Connecting a school account first creates a pending source and previews its
subjects, periods and grades. The user then either creates the suggested year
or maps the source into an existing year. Names are matching hints only;
ambiguous subjects and periods require an explicit mapping. Exactly one school
connection per local year is the authoritative grade source, while personal
grades always coexist with it. Disconnecting destroys credentials but keeps the
projection; permanent purge is a separate confirmed action.

Credentials are parsed only at the provider boundary, sealed with AES-256-GCM
before storage, and excluded from public DTOs. Provider errors must not include
challenge tokens, passwords, remote URLs containing credentials, or raw
credential envelopes.

User-selectable provider origins are resolved and connected through one pinned
DNS snapshot; private, local, IPv4-compatible, NAT64-to-private, site-local and
mixed public/private answers are rejected. Redirects are revalidated per hop.
Every request has a deadline that remains active through streaming body
consumption. Authentication and manual synchronization have atomic, durable DB
rate limits, and connection creation is capped per user/provider/year.

Provider subject IDs are persisted separately from names. An existing mapping
survives either side being renamed. A name matches automatically only when
there is exactly one local candidate; zero candidates are `unmatched` and
duplicates are `ambiguous`, never attached arbitrarily. Both states are exposed
by the sync API and the connection settings UI for explicit resolution. The UI
shows unresolved counts, lets the owner select one local subject, invalidates
the mapping snapshot after resolution, and asks for one final synchronization
to update the already-managed rows.

## ÉcoleDirecte

The server pins `@blockshub/blocksdirecte@0.0.8-alpha`, the latest version
published on npm when this adapter was reviewed. The upstream `main` manifest
already identifies itself as `0.0.9-alpha`, so the dependency stays exact
instead of silently consuming an alpha update.

The adapter uses BlocksDirecte's real `Client` for authentication, homework,
timetable, marks, public timeline, and attachment downloads. The active
end-to-end capabilities are homework, timetable, grades, and school calendar. The
calendar combines public-timeline events with workdays derived from non-cancelled
lessons; the upstream SDK exposes no verified school-holiday/vacation feed, so
those periods are not claimed. Attachment normalization remains preview-only
until Materials can preserve the same provider ownership and dismissal
guarantees.

The exact npm artifact is covered by a persistent Bun patch. It performs the
current GTK preflight, carries the GTK cookie and header, bounds requests with
an abortable 30-second timeout, caps bootstrap/API JSON bodies at 16 MiB, and
makes the SDK rate-limit timer disposable and non-retaining. Refreshed access
tokens are re-sealed with a ciphertext compare-and-swap before facets run. A
live, opt-in contract probe reaches the current login
endpoint with generated invalid credentials and verifies that the request gets
past GTK validation to the semantic invalid-credentials response. The probe was
last run successfully on 2026-08-21; run it again with
`ECOLEDIRECTE_LIVE_CONTRACT=1 bun test src/sync/blocksdirecte-patch.test.ts`
from `apps/server` whenever the upstream protocol changes.

TOTP and question/answer verification are completed through dedicated server
endpoints. The upstream challenge token and original credentials are kept in a
short-lived AES-GCM-sealed server-side envelope bound to the authenticated user
and school year. The browser receives only an opaque random challenge id plus
the public prompt; the envelope expires after five minutes and is consumed once.
The live BlocksDirecte client/cookie state for that five-minute exchange is
currently process-local. Until challenge state is externalized, deployments
must use one server replica or sticky sessions for ÉcoleDirecte begin/confirm;
a process restart invalidates an outstanding challenge and requires starting
the sign-in again.

## PRONOTE / Blocksnote

The requested Blocksnote README says to install `@blockshub/blocksnote`, but
neither that scoped name nor the unscoped name is published in npm. The Git
repository has no release or tag, names the package `blocksnote` rather than the
documented scope, points its entry points at an unversioned generated `dist`,
and exposes low-level authenticators/routes rather than Pawnote's login/session
and interval APIs used by the adapter. Its source also has conflicting license
metadata: the README and `LICENSE` say MIT while the package manifest says
`GPL-3.0`. It is therefore neither a lockable drop-in replacement nor a clear
redistribution choice today. Avermate does not install it from Git. A future
activation needs a published release or an exact reviewed commit with built
artifacts, a resolved license declaration, and a separately tested adapter.

A replaceable technical adapter is implemented and contract-tested against the
published `pawnote@1.6.2` API. It performs a real password/PIN/device login,
exchanges the password for a device-bound token, then seals only the refresh
material. Token rotation is persisted with a ciphertext compare-and-swap.
Homework, timetable, holidays/workdays and grades are normalized from
the real library contracts. Timetable and holiday identities remain stable when
their dates change. Because Pawnote represents PRONOTE dates in the server
process timezone, request boundaries and every returned wall-clock value are
explicitly bridged through the school's IANA timezone before comparison or
publication. Provider attachments are not advertised because there is no honest
managed-download contract yet.

`pawnote@1.6.2` declares `GPL-3.0-or-later`, while Avermate currently declares no
project license. PRONOTE therefore remains `blocked: license-unresolved` in the
production catalogue and release registry. Pawnote is a development-only
dependency: the hot local server and tests lazy-load it and expose the complete
connection UI (portal URL, account kind, optional device PIN and school time
zone), while a plain `start` and the production image do not. The release image
performs a production-only install and does not contain it. Do not move it into
the release graph until the maintainers make an explicit compatible-license
decision and complete the corresponding source/notices obligations. This is a
release gate, not a legal conclusion.

## Skolengo

A technical adapter is implemented and contract-tested against
`scolengo-api@3.0.5`. It imports the genuine `scolengo-token` OIDC JSON bundle,
checks the claimed school against Skolengo's official `/schools` directory,
discovers metadata only from the official school's IdP, and refuses the import
unless user-info proves that the selected student belongs to that exact school.
Refresh tokens are rotated, re-sealed with compare-and-swap, and never sent to a
client-supplied endpoint.

Homework, timetable and grades use the real SDK pagination contracts.
The current `school-calendar` facet derives workdays from agenda lessons only;
it does **not** claim to provide school holidays or vacation periods. Remote
attachment URLs are deliberately not advertised because the upstream contract
would forward bearer material outside the verified API boundary.

`scolengo-api@3.0.5` declares `GPL-3.0-or-later`. It too is development-only and
excluded by the production-only release install. The hot local server and tests
lazy-load the adapter and accept a `scolengo-token` JSON bundle through the
connection UI. For the same unresolved project-license reason as PRONOTE,
Skolengo remains `blocked: license-unresolved` in production and must not be
presented as ready for distribution.

The runtime gate fails closed. `NODE_ENV=production` always disables both GPL
adapters, and a plain server start with no environment mode does not enable
them. Local activation is implicit only for Bun's `--hot` development runtime
and `NODE_ENV=test`. The static catalogue remains blocked; the public catalogue
creates a detached development-only overlay when that gate is active.

## Upstream references

- <https://github.com/BlocksHub>
- <https://github.com/BlocksHub/BlocksDirecte>
- <https://github.com/BlocksHub/Blocksnote>
- <https://www.npmjs.com/package/pawnote/v/1.6.2>
- <https://www.npmjs.com/package/scolengo-api/v/3.0.5>
- <https://raw.githubusercontent.com/BlocksHub/BlocksDirecte/main/package.json>
- <https://raw.githubusercontent.com/BlocksHub/Blocksnote/main/package.json>
- <https://raw.githubusercontent.com/BlocksHub/Blocksnote/main/LICENSE>
- <https://github.com/EduWireApps/ecoledirecte-api-docs/tree/39e3a156e35ded43ebc8d8016f14b98d6d086bda>
- <https://github.com/jeromeboivin/EcoleDirecteMCP/tree/a27a91095672dd25ad258b91deaaabb396fc8586>
