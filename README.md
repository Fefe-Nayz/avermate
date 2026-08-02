# Avermate

Track your grades, understand what moves your average, and get a plan for the
result you are aiming at.

## What is in the repository

```
apps/server     Hono + oRPC API, Drizzle over libSQL, better-auth
apps/web        Next.js app — the whole product, desktop and mobile
packages/core   The domain engine: averages, analytics, goals, year in review
```

`packages/core` is consumed as TypeScript source by both apps. It knows nothing
about the database or the network, which is what lets the same code compute an
average on the server, in the browser while a coefficient slider is being
dragged, and in a unit test.

## How averages work

A grade is `value / outOf`, normalised to a ratio in 0..1. A subject averages
its grades by coefficient, then averages in whatever sits underneath it.

The one idea worth learning is the difference between a **subject** and a
**category**:

- a *subject* is counted once, with its own coefficient, using its own average;
- a *category* is transparent — the subjects inside it are weighed one by one
  at the level above, and the category is only a heading.

That distinction is what lets the same model fit a lycée (a handful of subjects
with flat coefficients) and a prépa (written/oral/practical splits with global
coefficients) without either of them feeling bolted on.

Everything downstream — impacts, trends, goal plans, the year in review — is
derived from that one calculation, so nothing can disagree with anything else.

## Goals

Set a target and the app inverts the arithmetic: with the coefficients fixed,
an average is affine in any single input it depends on, so pinning a subject to
0 and to 1 gives its whole response curve. That is what produces the mark your
next assessment has to be, the subject where a point is worth the most, and an
honest answer when a target has stopped being reachable.

## Running it

```bash
bun install
cp apps/server/.env.example apps/server/.env   # fill in BETTER_AUTH_SECRET
cp apps/web/.env.example apps/web/.env.local
bun run db:push
bun run dev
```

The API listens on `:5000`, the web app on `:3000`.

`bun run db:seed` creates a demo account (`demo@avermate.fr`) with a plausible
year of results — an empty dashboard tells you nothing about whether the
dashboard works.

## Migrating from v1

```bash
LEGACY_DATABASE_URL=file:/path/to/old.db bun run db:migrate-legacy -- --dry-run
```

Drop `--dry-run` to write. Ids are preserved, coefficients are unscaled from
their old ×100 integers, display subjects become categories, and custom
averages move from a JSON blob into rows. The script is idempotent.

## Checks

```bash
bun run check-types
bun run test
```

The tests cover the averaging engine, the preset data, and the message
catalogues — a missing French translation fails rather than silently rendering
English.
