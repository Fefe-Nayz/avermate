# Plan 021: EcoleDirecte, Pronote, Skolengo — what a connected year _is_

> [!IMPORTANT]
> **SUPERSEDED AS AN EXECUTION PLAN (2026-08-21).** The implemented contract and
> its current operational limits are documented in
> [`docs/school-integrations.md`](../docs/school-integrations.md), which is the
> source of truth. This file remains as design rationale; its schema readings,
> proposed API names, missing-feature claims and implementation order are
> historical and must not be used as a current-state checklist.
>
> Three product decisions from this plan remain authoritative:
>
> 1. **Do not lock the local year.** School data is a source inside a year the
>    user owns, because late or incomplete provider data must not prevent local
>    grades and local modelling.
> 2. **Ask once on first launch.** After preview, offer “create a year from this
>    account” or “add to an existing year”; this is an onboarding decision, not
>    a permanent settings mode.
> 3. **Consolidate integrations as Sources.** Provider-specific authentication
>    can differ, but connections should be presented as one source collection.

> **The question, as asked**: "une connexion EcoleDirecte permet de créer une
> année avec des paramètres immuables (un peu comme lorsque l'on rejoint une
> classe)… jsp si le mieux c'est de lock complètement l'année, ou de proposer de
> sync à une année existante (mapping des matières), ou d'avoir le droit
> d'ajouter nos propres notes et d'ajuster d'autres choses après coup. Franchement
> je ne sais pas et je suis un peu perdu."
>
> **The short answer**: the schema in `db/schema/sync.ts` has already made this
> decision, and it made the right one. It is the third option, with one guard.
> The rest of this document is why, what is still missing, and what the UI owes.

## Status

- **Execution status**: SUPERSEDED — retained for product rationale only
- **Current specification**: `docs/school-integrations.md`
- **Former priority**: P1 — the connectors exist and the year model is what
  decides whether they are usable or merely present
- **Depends on**: plan 008 (provider sync framework), plan 018 (Pronote /
  EcoleDirecte spike)
- **Written at**: 2026-08-21, branch `rewrite`

---

## 1. The three options, taken seriously

### Option A — a locked year

A connection creates a year whose subjects, periods, coefficients and grades are
all read-only, exactly like joining a class.

**What it gets right**: it can never disagree with the school. Every average the
app shows is the average the school would show, and if it differs, that is a bug
with one cause.

**Why it fails anyway**, and this is decisive: _the school's numbers are not the
numbers a student wants to reason about_. The entire reason this app exists is
the arithmetic the school does not do for you — what a 14 in the next DS does to
the average, whether a coefficient you were told about is the one in the system,
what the average would be without the mark you are contesting. A locked year
turns Avermate into a nicer Pronote, which is a smaller product than the one it
already is.

There is also a plainer failure. School systems are late and incomplete. A mark
handed back on paper on Friday appears in Pronote on Tuesday, or in April, or
never. A year that refuses the Friday mark is a year that is wrong for four days
every week — and the student _knows_ it is wrong, which is worse than a number
they chose to enter themselves.

### Option B — sync into an existing year, with mapping

You keep your year. The connection maps provider subjects onto yours, provider
periods onto yours, and writes grades into the mapping.

**What it gets right**: it is the only model that survives the real cases —
a second connection (Moodle for files, EcoleDirecte for grades), a subject you
split in two because you track written and oral separately, an option the
provider files under a parent you do not have.

**What it costs**: the mapping is a screen, and an unmapped subject is a state
somebody has to resolve. `matchStatus: "mapped" | "unmatched" | "ambiguous"`
exists precisely because name matching is a hint and not an answer —
"Mathématiques" and "MATHS" and "Mathématiques spécialité" are three strings and
possibly one subject.

### Option C — connected, but yours

The provider is a _source_, not an owner. It creates what is missing, keeps what
it wrote up to date, and never touches what you wrote.

**This is what the schema implements.** The evidence, column by column:

```ts
// sync_connections
gradesAuthority: integer({ mode: "boolean" }).notNull().default(false);
uniqueIndex("sync_connections_grades_authority_unique")
  .on(t.yearId)
  .where(sql`gradesAuthority = true and yearId is not null`);
```

At most one connection may publish grades into a year. Not zero — a year with no
authority is a year you fill in yourself, which stays legal. Not many — two
providers writing marks into one year is the one situation with no correct
resolution, so it is made unrepresentable rather than handled.

```ts
// sync_grade_records
syncState: "managed" | "missing" | "dismissed";
localGradeId: text().references(() => grades.id, { onDelete: "set null" });
value: real(); // nullable: "Abs", "N.Not", "Dispensé" are results too
```

A provider grade is _mirrored_ into a local `grades` row and keeps its own
durable snapshot beside it. Three consequences, all of them the point:

- **`dismissed`** is you saying "I do not want this one in my average". The
  record stays — so the next sync does not helpfully resurrect it — and the
  local grade goes. This is the "ajuster après coup" the question asks about,
  and it already has a name.
- **`missing`** is the provider having stopped showing a mark it used to show.
  Not a delete: a mark that vanishes from Pronote in March is far more often a
  Pronote problem than a real correction, and silently dropping it from an
  average the student has been watching for a month is the worst thing this
  feature could do.
- **`value` nullable** is the detail that proves the model. A locked-year design
  would have had nowhere to put "Absent", because it is not a number and cannot
  be averaged. Here the provider's own result survives even when no canonical
  grade row can exist.

```ts
// sync_connections
disconnectedAt: integer({ mode: "timestamp" });
// "Credentials are destroyed on disconnect while the cached projection remains."
```

Disconnecting destroys the credentials and keeps the data. Your year does not
empty out because you changed your password in June.

**Verdict**: B and C are not alternatives — C _is_ B plus the right to write.
Option A is a different product.

---

## 2. So what is "creating a year from EcoleDirecte"?

The question's instinct is right and worth keeping: connecting for the first
time should not drop you into an empty year with a mapping screen. It should
produce a year that already looks like your year.

That is **bootstrapping**, not locking. The distinction, precisely:

|                              | Bootstrapped                      | Locked                   |
| ---------------------------- | --------------------------------- | ------------------------ |
| Subjects                     | created from the provider         | created _and_ frozen     |
| Coefficients                 | seeded from the provider          | not editable             |
| Periods                      | created from the provider's terms | not editable             |
| A grade you add by hand      | allowed, marked as yours          | refused                  |
| A provider grade you dismiss | allowed, remembered               | refused                  |
| Provider renames a subject   | your name wins after you edit it  | your name is overwritten |

`syncSubjectMappings` carries `providerSubjectName` _and_ `subjectId` separately,
with the comment that names are a matching hint only. That is bootstrapping: the
provider's name is what the mapping was built from, and your name is what the
screen shows once you have changed it.

**What bootstrapping needs that does not exist yet**: nothing in the schema. It
needs one procedure — "create a year from this connection" — that runs the
mapping resolution eagerly with `matchStatus: "mapped"` for everything it
creates, instead of leaving a screen full of `unmatched`.

```ts
sync.connections.bootstrapYear({ connectionId, name?, remoteAcademicYearId? })
  -> { yearId, subjects: number, periods: number, unmatched: number }
```

`remoteAcademicYearId` is already on `sync_connections` — "Stable provider-owned
academic-year identity discovered before linking" — so the provider's own notion
of which year this is exists before any local row does. That is what stops a
September connection from pouring last year's marks into this year.

---

## 3. Where each provider actually differs

This matters because the UI must not promise what a provider cannot do.

|           | EcoleDirecte                          | Pronote                       | Skolengo    | Moodle                |
| --------- | ------------------------------------- | ----------------------------- | ----------- | --------------------- |
| Auth      | login + password, 2FA question/answer | login + password (or ENT/CAS) | OAuth (ENT) | mobile-token hand-off |
| Grades    | yes, with coefficients and periods    | yes                           | yes         | yes, per course       |
| Homework  | yes                                   | yes                           | yes         | assignments           |
| Timetable | yes                                   | yes                           | yes         | no                    |
| Files     | attachments on homework               | attachments                   | attachments | course files          |
| Stability | scraping-adjacent; breaks             | scraping-adjacent; breaks     | real API    | real API              |

Two consequences the interface owes:

1. **`capabilities` is per connection, not per provider.** The schema already
   stores it that way. A Pronote account that a school has locked down may have
   grades and no timetable, and the screen has to read the connection rather
   than a table of what Pronote can do in principle.
2. **Breakage is normal, not exceptional.** EcoleDirecte and Pronote change
   under you. `status: "error"` and `lastError` are not edge cases; they are
   Tuesday. The connection card has to make a broken sync legible and
   recoverable without the student concluding their marks are gone — which is
   exactly why `disconnectedAt` keeps the projection.

---

## 4. What the UI owes

### 4.1 Connecting

A screen per provider, because the credentials genuinely differ, but one list of
connections. Today `SchoolServicesSection` and `MoodleSyncSection` and
`OneDriveSyncSection` sit as three siblings in Réglages ▸ Intégrations, which
reads as three features rather than one idea. **Recommendation**: one _Sources_
section listing every connection with its provider chip, and the provider-specific
form behind "Add a source". Plan 020 §7 said the same thing and it is still right.

### 4.2 The first sync

After the first successful sync, offer the choice _once_, in words, not in
settings:

- **Create a year from this account** — bootstrapping, the default, one click.
- **Add to an existing year** — opens the mapping screen.

Nothing else. The question's third possibility ("le droit d'ajouter nos propres
notes") is not a choice to be offered: it is simply true afterwards, in both
branches.

### 4.3 The mapping screen

Rows are provider subjects; each has a picker of your subjects, defaulted by the
name match, with `unmatched` and `ambiguous` sorted to the top. `matchStatus`
gives the ordering for free. The same for periods, which are fewer and easier.

The one rule worth enforcing in the interface: **a mapping is never inferred
twice**. Once you resolve a subject, a provider rename must not silently re-open
it — the schema's own comment says so, and the screen should show a provider
rename as a note on the row, not as a reset.

### 4.4 A grade that came from school

In the grades list, a synced grade needs to say so and to offer exactly two
things a local grade does not:

- **Dismiss** (`syncState: "dismissed"`) — take it out of my average, remember
  that I said so.
- **Detach** — keep the number, stop tracking it. Useful when the provider is
  wrong and you want to correct it by hand.

And the inverse must be visible: a grade _you_ added into a connected year is
not at risk from any sync, and the screen should say that once rather than leave
it to be discovered.

### 4.5 `missing`

A provider grade that disappeared upstream stays in the list, greyed, with one
sentence: it is no longer in Pronote, and here is what it was. Two buttons —
keep it, or remove it. Never automatic.

---

## 5. Recommendation, stated once

Build **Option C with bootstrapping**:

1. Connecting never modifies an existing year without an explicit mapping step.
2. Connecting _can_ create a year, fully populated, in one click.
3. Everything the provider writes is marked as the provider's and stays
   updatable by it; everything you write is yours and no sync may touch it.
4. One connection per year may publish grades. The schema already enforces it.
5. Disconnecting destroys credentials and keeps every number you have looked at.

The instinct in the question — "des paramètres immuables, un peu comme rejoindre
une classe" — is worth keeping for _coefficients and structure_, and worth
refusing for _marks_. A class you join defines the shape of the year; it does not
get to tell you that the mark you were handed on Friday does not exist.

## 6. Order

`bootstrapYear` → the Sources consolidation → the mapping screen → the synced
grade affordances (`dismissed` / detach) → `missing`.

The first two are the ones that make a connection feel like it did something.
