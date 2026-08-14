# Social sharing and privacy architecture

This document describes the social model implemented by Avermate. Social
features remain optional and separate from the private grade tracker.

## Product boundary

Avermate has two distinct social relationships:

- Friends let two people view the academic fields each person has enabled in
  their sharing settings.
- Classes are private groups whose members use one common academic template.
  They compare a small set of derived figures from explicitly connected years.

There is no public academic profile. Leaving a friendship or class does not
delete any year, subject, grade or goal.

Classes are user-created and are not represented as institution-verified.
There are no class challenges, leagues or teacher privileges.

## Friend sharing

A social profile chooses one year, or falls back to the current active year,
and independently controls:

- whether friends may see the general average;
- whether friends may see all, selected or no subject averages.

Friend APIs return derived ratios, labels and counts only. They never return a
grade row, note, component or assessment date.

Blocking takes precedence over friendship and invitation access.

## Class template

Creating a class uses either one active year owned by the creator or the class
template builder. The builder creates a complete new year for the owner in the
same atomic write and connects it to the class. The server then stores an
immutable snapshot containing:

- year dates and grading settings;
- ordered periods, chosen from a quick template or entered explicitly;
- subject hierarchy and stable subject keys;
- custom-average definitions;
- preset identity and version when the source year is still linked to one.

Later edits to the source year do not mutate the class contract. An older group
without a snapshot is preserved but marked `setupRequired`; its owner must
select a source year once before invitations or comparisons can be used.

Builder templates may start from a curated preset and may be edited before
creation. An unchanged current preset keeps its preset id and version;
customized builder data becomes a custom immutable template. Neither path
subscribes the class contract itself to later preset changes.

Custom periods are capped at 12, remain inside the academic year and are
stored in the order supplied. Empty periods represent a year with no split;
overlapping or reversed ranges are rejected before any class data is written.

## Joining and connected years

Every class membership may reference one year owned by that member. A member
can:

- connect an existing compatible year;
- create a new independent year copied from the class template.

Joining requires one of those two choices. A membership is never activated
without a compatible connected year.

Copying never overwrites an existing year and never copies grades. The copy has
its own ids and dashboard cards. A custom class accepts only its original source
year and copies produced from its snapshot. A preset-backed class additionally
accepts years with the same linked preset version, settings, periods and exact
configuration.

An archived year is not offered for a new connection. Deleting a connected year
sets the membership reference to null and immediately removes that member's
figures from the class.

## Class comparisons

New classes offer only:

- general average;
- one subject average selected from the class template.

Subject comparisons use stable template keys, not fuzzy name matching. Legacy
comparison rows remain readable so migrations do not destroy existing data.

The server computes figures only from the year connected to that membership.
It never falls back to the user's friend-sharing year. The response contains
derived ratios, optional trend and grade count, never raw grade data.

## Consent and authorization

Creating or joining a class sets `shareAverage` to false. Connecting or copying
another year also resets it to false. A member must explicitly enable sharing,
and cannot do so without a compatible connected year.

The owner may rename the class, choose comparisons, invite members and remove
members. The owner does not receive access to raw academic records or any
sharing bypass. Class invitations are owner-only, random, hashed at rest,
expiring and revocable.

Administrative moderation may freeze or delete a class and revoke unsafe
access, but it does not expose underlying grades.

## Data retention and account rights

Account export includes the account owner's sharing settings, friendships,
class memberships, blocks and reports. It does not include another member's
private academic data or invitation secrets.

Deleting a class removes its memberships, comparisons and invitations through
foreign-key cascades. It does not delete members' years. Deleting a year clears
the membership link through `ON DELETE SET NULL`.

## Required tests

- ownership checks for class creation, configuration and invitations;
- immutable templates and preservation of legacy groups;
- compatibility for source years, preset-linked years and generated copies;
- rejection of incompatible or foreign years;
- sharing off on create, join, select and copy;
- stable-key subject figures for both a custom source and its copy;
- no raw grades, notes or assessment dates in social DTOs;
- connected-year deletion immediately removing figures;
- invitation expiry, revocation, blocking and administrative freeze;
- fresh migration and atomic multi-table class/year writes.
