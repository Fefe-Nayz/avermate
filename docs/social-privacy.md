# Social sharing and privacy architecture

This document defines the security and product invariants for Avermate's
optional social features. It is an engineering contract, not legal advice.
The production rollout, age-assurance method, retention schedule and DPIA must
be reviewed for the jurisdictions where the service is offered.

## Product boundary

Social sharing is separate from the grade tracker. A user can decline or leave
social features without losing access to years, subjects, grades, goals or
analytics.

There is no Internet-public academic profile. A profile is visible only through
an accepted friendship or a private group, and only through explicit field
grants or the current group policy. Classes are self-declared private groups;
Avermate does not present them as institution-verified classes.

The social feature flag defaults to off. An account with unknown eligibility
cannot activate social sharing. The initial policy is designed for France:

- users aged 15 or over need their own current consent;
- users under 15 need both their own consent and verified guardian evidence;
- the service stores an age band and opaque assurance reference, not a birth
  date, identity document or guardian document;
- expired or withdrawn evidence immediately disables social access.

## Data boundary

The social API never returns grade, component, note, date, free-form subject,
goal or full yearly snapshot rows. It derives a closed set of projections on
the server:

- display name, avatar, biography and broad education band;
- normalized average and median;
- trend, pass-rate and grade-count bands;
- generic goal progress.

Every DTO is explicitly allow-listed. Database row types and object spreads
from academic models must not cross the social boundary.

Authorization is evaluated in this order:

```text
block
  > feature and age eligibility
  > friendship or active group membership
  > current immutable policy version
  > current consent for that exact version
  > profile field grant or policy field
  > allow-listed projection
```

Missing state always means denied. Owners, moderators and platform admins do
not receive an academic-data bypass. Responses for an absent, blocked or
unauthorized target are intentionally indistinguishable.

## Friends, circles and blocks

A friend request uses one canonical unordered account pair, expires and must be
accepted by the recipient. Friend circles are private audience lists owned by
one user; members are not told which private circle contains them.

Profile grants are explicit per field and audience (`friends`, one circle or
one account). Revoking a grant stops future reads. Blocking takes precedence
over all relationships: it removes direct friendship access, cancels pending
requests and grants, hides both profiles from one another and invalidates
affected query data.

## Groups and consent

Each group has one authoritative owner and an immutable sequence of policy
versions. A policy states its purpose, audience description, fixed time window,
requested metrics, whether each field is required, and whether it is available
only as an aggregate, as a member-visible projection or for an opt-in ranking.

An invitation contains a random token; only its keyed hash and a short display
prefix are stored. It is bound to a policy version, expires, is revocable and
can be consumed once. Acceptance uses a transaction and compare-and-swap so a
concurrent request or policy change cannot create an active membership under a
policy the user did not see.

Before joining, the user sees the owner, purpose, audience, required and
optional fields, comparison modes, time window and withdrawal behavior. A
material policy edit always creates a new immutable version and moves all
members to `consent_required`. Until they accept that exact version, they can
read the policy or leave but cannot contribute to or read social statistics.

Ownership transfer is atomic. Deleting an owner account requires transferring
or explicitly deleting each group first. A moderator can manage allowed group
operations but cannot inspect underlying academic rows.

## Aggregates and rankings

Group analytics use fixed windows, rounded values and a closed filter grammar.
The initial privacy thresholds are:

- at least 5 eligible, currently consenting contributors for an aggregate;
- buckets below 3 are suppressed, with complementary suppression to prevent
  subtraction attacks;
- at least 7 eligible contributors for a named ranking;
- group-level ranking enablement and member-level opt-in for every metric.

Non-participants never appear in a ranking. Equal scores share a rank. For
younger users, the preferred presentation is a band or cohort percentile,
not a named leaderboard. Changing a grade, membership, block, consent or policy
increments the group revision so stale projections cannot be reused.

These thresholds reduce inference risk but do not make the results anonymous.
They are configuration and DPIA inputs, not a legal guarantee.

## Server rendering and caches

Social pages follow the same SSR-first architecture as the rest of the web app:

- personalized reads use the request-scoped server QueryClient;
- the server calls oRPC directly over the private transport;
- initial interactive data can be dehydrated into a narrow client island;
- the browser reuses the exact shared query options and does not immediately
  repeat the request;
- personalized social reads and invitation previews use `no-store`;
- no cross-request cache stores personalized projections in the first release.

Query keys include the viewer identity, entity, policy version and group
revision. Relationship, policy, consent, academic and moderation mutations use
targeted invalidation. Logout, account rotation and 401 handling destroy the
identity's cache before another account can render.

Invitation pages use `Referrer-Policy: no-referrer` and must not send the raw
token to analytics, logs, notifications or query keys.

## Expo and widgets

Expo consumes the same oRPC contracts and authorization decisions. Local
social state and queries are account-scoped. Invitation deep links never grant
access by themselves; the authenticated server acceptance remains
authoritative.

Configurable dashboard cards are available on iOS and Android. The optional
iOS system widget is a separate device-level opt-in requiring a development or
EAS build. Its App Group payload is a final allow-list containing at most two
aggregates and labels; it contains no account id, friend, group, subject or
grade row. Academic values are marked privacy-sensitive, no lock-screen widget
family is registered, and sign-out writes a neutral disabled payload. Expo 57
has no official Android AppWidget equivalent, so Android keeps the equivalent
configurable in-app cards rather than adding an unverified native dependency.

## MCP

Social operations require separate OAuth scopes:

- `avermate:social.read` for authorized social projections;
- `avermate:social.manage` for relationships, groups and consent;
- `avermate:social.moderate` plus the backend admin role for moderation.

Existing clients never receive these scopes implicitly. MCP tools call the
same oRPC procedures as web and Expo. Sending or accepting a friend request,
joining a group, accepting a policy, changing roles, blocking, leaving or
deleting requires an explicit multi-round-trip confirmation bound to the user,
OAuth client, arguments, policy version and expiry. OAuth consent never
substitutes for the user's social or guardian consent.

## Moderation and account rights

Reports and automatic bug reports are stored and triaged in Avermate. The admin
console groups automatic failures by a sanitized fingerprint and supports
status, priority, assignment, labels, internal comments and an append-only
event timeline. Discord is not a data sink.

Social reports can target a profile, group or behavior. Administrative actions
require a reason and create value-free audit events. Moderators can freeze a
group, revoke invitations or remove unsafe presentation content without gaining
access to members' academic rows.

Export includes the account owner's social profile, grants, relationships,
memberships and consent history without other users' private data or raw
tokens. Social reset and account deletion revoke access immediately, invalidate
group revisions and remove or pseudonymize records according to the reviewed
retention policy.

## Required tests

- authorization matrix across two accounts, two groups, roles and blocks;
- concurrent invitation acceptance and concurrent policy change;
- withdrawal disappearing immediately from profile, aggregate, ranking, SSR,
  hydrated cache and MCP;
- aggregate thresholds at `k-1`, `k` and `k+1`, complementary suppression and
  ties;
- no academic row, email, assurance proof, token or internal id in social DTOs,
  logs, exports or widget payloads;
- account rotation on web and Expo without cache leakage;
- SSR initial navigation without a duplicate browser read;
- English/French, keyboard and screen-reader coverage;
- MCP scopes, backend role, confirmation and revocation;
- fresh database migration and rollback-safe multi-write operations.
