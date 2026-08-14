# Plan 003: Modularize the MCP server into per-surface registry modules and unify the admin check

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat 46c966b..HEAD -- apps/server/src/mcp apps/server/src/lib/admin.ts docs/mcp.md`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: MED (deterministic-catalog invariant must be preserved; the harness is the net)
- **Depends on**: none (do BEFORE plans 004/005 add ~40 tools)
- **Category**: tech-debt | security (admin-gate consistency)
- **Planned at**: commit `46c966b`, 2026-08-14

## Why this matters

`apps/server/src/mcp/server.ts` is 2160 lines — the composition root, 20+
shared zod fragments, 8 utilities, seven `registerXSurface` functions,
resources and prompts, all in one file, selected by a hardcoded if-chain.
The study-companion merge will add several new surfaces (course materials,
agenda, documents) of roughly 40 tools; landed on today's structure that means
a 3000+ line file edited in four unlinked places per domain. Worse, the
if-chain embeds an admin check that **disagrees with the authoritative one**:
`lib/admin.ts` honors `role === "admin"` OR the `ADMIN_USER_IDS` bootstrap
list, while the MCP chain uses `role?.split(",").includes("admin")` — so a
bootstrap admin (the only admin on a fresh deployment) sees no MCP admin
surface, and a `role="admin,x"` user sees tools that all 403 at
`adminProcedure`. This plan extracts each surface into its own module behind a
uniform registry array and routes both role checks through `isAdmin`.

## Current state

- `apps/server/src/mcp/server.ts` (2160 lines) — internal layout:
  - `:37-171` shared zod fragments; `:173-369` utilities, including
    `runDestructive` (`:257-353`, the MRTR primitive — do not change its
    behavior), `can(principal, ...scopes)` (`:355-357`), `meta(...scopes)`
    (`:359-361`).
  - `:371-426` `createAvermateMcpServer` — builds
    `const api = createRouterClient(appRouter, { context: principal.context })`
    (`:372`), the request-state codec (`:373-378`), the `McpServer` with
    instructions/cacheHints (`:379-395`), then the if-chain:

    ```ts
    if (can(principal, "avermate:read")) {
      registerReadSurface(server, api);
      registerResources(server, api);
      registerPrompts(server, principal);
    }
    if (can(principal, "avermate:write")) registerWriteSurface(server, api);
    if (can(principal, "avermate:social.read")) { registerSocialReadSurface(server, api); }
    if (can(principal, "avermate:social.manage")) { registerSocialManageSurface(server, api, principal, codec); }
    if (can(principal, "avermate:delete")) { registerDestructiveSurface(server, api, principal, codec); }
    if (
      can(principal, "avermate:read", "avermate:admin") &&
      principal.context.session?.user.role?.split(",").includes("admin")
    ) { registerAdminSurface(server, api, principal, codec); }
    if (
      can(principal, "avermate:social.moderate") &&
      principal.context.session?.user.role?.split(",").includes("admin")
    ) { registerSocialModerationSurface(server, api, principal, codec); }
    ```

  - Surfaces at `:432` (read), `:675` (social read), `:749` (social manage),
    `:1036` (write), `:1399` (destructive), `:1600` (admin), `:1843` (social
    moderation); resources `:1952-2068`; prompts `:2070-2159`.
- Authoritative admin check — `apps/server/src/lib/admin.ts:17-19`:

  ```ts
  export function isAdmin(user: { id: string; role?: string | null }): boolean {
    return user.role === "admin" || bootstrapIds.has(user.id);
  }
  ```

  with the rationale comment at `:3-10` ("Checking only the column would make
  that env var silently do nothing").
- Scopes — `apps/server/src/lib/auth.ts:24-32` (`MCP_SCOPES`, 7 entries);
  per-scope token expiries at `:211-216`.
- Conformance suite — `apps/server/src/mcp/protocol.harness.ts` (983 lines),
  launched by `apps/server/src/mcp/protocol.test.ts:10` via
  `Bun.spawn(["bun", "test", "./src/mcp/protocol.harness.ts"], ...)` because
  the libSQL client is process-wide. Two tests enumerate expectations that this
  refactor must keep true: the deterministic catalog test around `:371` and the
  scope-isolation test around `:637`.
- `docs/mcp.md` documents scopes (`:127-143`) and surfaces (`:147-170`).

## Commands you will need

| Purpose   | Command                          | Expected on success |
|-----------|----------------------------------|---------------------|
| Install   | `bun install --frozen-lockfile`  | exit 0              |
| Typecheck | `bun run check-types`            | exit 0              |
| MCP conformance + server tests | `bun run --cwd apps/server test` | exit 0 |
| All gates | `bun run format:check && bun run lint && bun run check-types && bun run test && bun run build` | exit 0 |

## Scope

**In scope** (the only files you should modify or create):
- `apps/server/src/mcp/server.ts` (shrinks to composition root + shared kit)
- `apps/server/src/mcp/shared.ts` (create — zod fragments + utilities)
- `apps/server/src/mcp/surfaces/read.ts`, `surfaces/write.ts`,
  `surfaces/destructive.ts`, `surfaces/social-read.ts`,
  `surfaces/social-manage.ts`, `surfaces/social-moderation.ts`,
  `surfaces/admin.ts`, `surfaces/resources.ts`, `surfaces/prompts.ts` (create)
- `docs/mcp.md` (only if wording references the single-file layout)

**Out of scope** (do NOT touch, even though they look related):
- Tool names, descriptions, input schemas, annotations, `_meta` payloads,
  handler bodies, registration ORDER — this is a **move-only** refactor; any
  behavioral diff is a bug.
- `apps/server/src/mcp/protocol.harness.ts` and `protocol.test.ts` — the
  harness is the referee; if it fails, fix the refactor, never the test.
  (Exception: none. If the harness seems wrong, STOP.)
- `apps/server/src/mcp/auth.ts`, `http.ts` — untouched.
- `apps/server/src/lib/auth.ts` scopes — no new scopes in this plan.
- `runDestructive` internals — move verbatim.

## Git workflow

- Branch: `advisor/003-mcp-modular-surfaces` from `rewrite`.
- Conventional commits, e.g. `refactor(server): split MCP surfaces into registry modules`
  and `fix(server): MCP admin gate uses isAdmin`.
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Extract the shared kit

Create `apps/server/src/mcp/shared.ts` and move, verbatim, the zod fragments
(`server.ts:37-171`) and the utilities (`:173-369`) including `runDestructive`,
`can`, `meta`, `mapDate` and the `DestructiveState` codec types. Export
everything the surfaces need. `server.ts` re-imports from `./shared`.

**Verify**: `bun run check-types` → exit 0;
`bun run --cwd apps/server test` → exit 0 (pure move, catalog unchanged).

### Step 2: Define the surface-module contract

In `shared.ts`, add:

```ts
export interface McpSurface {
  /** Scope(s) that must ALL be present for this surface to register. */
  scopes: readonly string[];
  /** Also require the backend admin role (lib/admin.ts isAdmin). */
  requiresAdminRole?: boolean;
  register(ctx: {
    server: McpServer;
    api: RouterClient<AppRouter>;
    principal: McpPrincipal;
    codec: RequestStateCodec<DestructiveState>;
  }): void;
}
```

### Step 3: Move each surface into its module

For each `registerXSurface` (and `registerResources`/`registerPrompts`), create
the file listed in Scope, move the function body **verbatim**, and export a
`const surface: McpSurface` (or a named export per file) wired to it:

- read → `{ scopes: ["avermate:read"] }` — its `register` also calls the
  resources and prompts registrations, OR resources/prompts become their own
  surfaces with `scopes: ["avermate:read"]` placed immediately after read in
  the ordered list (choose the latter; it keeps one registration per module).
- write → `["avermate:write"]`
- social read → `["avermate:social.read"]`
- social manage → `["avermate:social.manage"]`
- destructive → `["avermate:delete"]`
- admin → `{ scopes: ["avermate:read", "avermate:admin"], requiresAdminRole: true }`
- social moderation → `{ scopes: ["avermate:social.moderate"], requiresAdminRole: true }`

**Ordering is load-bearing**: the deterministic-catalog harness test asserts
the exact tool list. The ordered array in Step 4 must reproduce the current
if-chain order: read, resources, prompts, write, social-read, social-manage,
destructive, admin, social-moderation. Note the current chain registers
social surfaces BEFORE destructive — preserve exactly that.

**Verify** after each move: `bun run check-types` → exit 0. (Run the full MCP
suite once after all moves, next step.)

### Step 4: Replace the if-chain with the ordered registry and `isAdmin`

In `createAvermateMcpServer` (`server.ts:371-426`), replace the chain with:

```ts
import { isAdmin } from "../lib/admin";
import { SURFACES } from "./surfaces"; // ordered array re-exporting each module

for (const surface of SURFACES) {
  if (!can(principal, ...surface.scopes)) continue;
  if (surface.requiresAdminRole) {
    const user = principal.context.session?.user;
    if (!user || !isAdmin(user)) continue;
  }
  surface.register({ server, api, principal, codec });
}
```

Create `apps/server/src/mcp/surfaces/index.ts` exporting the ordered `SURFACES`
array. This step also **replaces both**
`principal.context.session?.user.role?.split(",").includes("admin")`
expressions (`server.ts:414`, `:420`) with the `isAdmin` call — that is the
intended behavior change: bootstrap admins (in `ADMIN_USER_IDS`) gain the MCP
admin surface they already have over `/rpc`; comma-joined roles (e.g.
`"admin,moderator"`) lose tool *visibility* they could never successfully call
(every handler delegates to `adminProcedure`, which uses `isAdmin`).

**Verify**: `bun run --cwd apps/server test` → exit 0. The harness's
scope-isolation and catalog-gating tests must pass unchanged. Then
`grep -n 'split(",")' apps/server/src/mcp` → no matches.

### Step 5: Shrink check and doc touch-up

`server.ts` should now contain only: imports, `createAvermateMcpServer`, and
whatever tiny glue remains. If `docs/mcp.md` describes the file layout
anywhere, update the sentence; the scope table (`:127-143`) and surface list
(`:147-170`) are unchanged by this refactor.

**Verify**: `wc -l apps/server/src/mcp/server.ts` → under 150 lines.

### Step 6: Full gate

**Verify**: `bun run format:check && bun run lint && bun run check-types && bun run test && bun run build` → all exit 0.

## Test plan

No new tests: the 983-line protocol harness is the specification, and passing
it after a move-only refactor is the point. Two properties it already enforces
that this plan must keep: byte-deterministic catalogs (test near
`protocol.harness.ts:371`) and scope isolation (near `:637`). Add exactly one
new test ONLY if the harness lacks it: a unit test in
`apps/server/src/mcp/admin-gate.test.ts` asserting that a principal whose user
is in `ADMIN_USER_IDS` (role `"user"`) gets the admin surface registered, and a
`role="admin,moderator"` user does not — this pins the intended behavior
change. Use the in-memory bootstrap pattern from
`integrity.integration.test.ts:8-40`.

## Done criteria

Machine-checkable. ALL must hold:

- [ ] `bun run --cwd apps/server test` exits 0 (protocol harness included)
- [ ] `grep -rn 'split(",")' apps/server/src/mcp` → no matches
- [ ] `grep -n "isAdmin" apps/server/src/mcp/server.ts apps/server/src/mcp/surfaces/index.ts` → at least one match in the registry path
- [ ] `wc -l apps/server/src/mcp/server.ts` < 150
- [ ] Every `surfaces/*.ts` module exports an `McpSurface`; `surfaces/index.ts` is the only place that orders them
- [ ] Admin-gate test exists and passes (bootstrap admin sees admin surface; comma-role user does not)
- [ ] All root gates exit 0
- [ ] No files outside the in-scope list are modified (`git status`)
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back (do not improvise) if:

- The deterministic-catalog harness test fails after the registry swap and the
  cause is registration ORDER — re-check Step 3's ordering note; if order
  matches the old chain and it still fails, STOP (the harness may encode
  something subtler; do not weaken it).
- Moving a surface requires changing any tool's name, schema or `_meta`.
- `runDestructive` cannot move without signature changes.
- The admin-gate behavior change surfaces a harness expectation that
  comma-joined roles DO get tools (would mean the divergence was intentional —
  report with the failing test name).

## Maintenance notes

- Plans 004/005 (and any future domain) add one file under `mcp/surfaces/` and
  one ordered entry in `surfaces/index.ts` — never edit `server.ts` again for a
  new domain. New tools still need: scope in `lib/auth.ts:24-32` (+ expiry at
  `:211-216` if short-lived), harness enumeration updates, and `docs/mcp.md`
  scope/surface tables.
- Reviewer attention: `git diff` on the moved bodies should be
  whitespace/import-only; the catalog order in `surfaces/index.ts`; the two
  admin-gate semantics in the pinning test.
- Deferred: none — this plan is intentionally pure restructuring plus the one
  authz unification.
