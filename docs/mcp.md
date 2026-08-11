# Avermate MCP

Avermate exposes a production-oriented Model Context Protocol server at
`POST /mcp`. It implements the final
[MCP 2026-07-28 specification](https://modelcontextprotocol.io/specification/2026-07-28.md)
with the official TypeScript server SDK v2.

The server lets an AI assistant work with the same academic data and rules as
the web and mobile applications. Every operation is executed through the
authenticated oRPC router; the MCP layer does not duplicate validation,
ownership checks, calculations, or administrator policy.

## Transport and discovery

- Transport: stateless Streamable HTTP, `POST /mcp` only.
- Protocol revision: `2026-07-28`.
- No `initialize` request, legacy MCP session, or `Mcp-Session-Id` is used.
- Every request carries the modern `_meta` envelope and the matching
  `MCP-Protocol-Version`, `Mcp-Method`, and—where applicable—`Mcp-Name`
  headers.
- `server/discover`, catalogs, resource templates, and private cache hints are
  supported.
- Tool, prompt, resource, and template lists are deterministic for the same
  principal and scope set.

Discovery endpoints:

| Purpose                             | URL                                                |
| ----------------------------------- | -------------------------------------------------- |
| MCP protected-resource metadata     | `/.well-known/oauth-protected-resource/mcp`        |
| OAuth authorization-server metadata | `/.well-known/oauth-authorization-server/api/auth` |
| OpenID configuration                | `/.well-known/openid-configuration/api/auth`       |
| OAuth JWKS                          | `/api/auth/jwks`                                   |

The authorization-server and OpenID documents also have root discovery
aliases for clients that probe the resource origin first.

## OAuth 2.1

MCP access uses Better Auth OAuth Provider 1.6.26 and asymmetric, short-lived
JWT access tokens. The resource server verifies the signature against the
authorization server's local public-key set, as well as `iss`, `aud`, expiry,
subject, authorized party, scopes, verified-email status, and current account
suspension state.

This intentionally uses Better Auth's stable OAuth Provider rather than its
legacy `mcp()` convenience plugin. Better Auth 1.6 documents that plugin as
being replaced by OAuth Provider, while protocol revision `2026-07-28` still
requires an explicit modern MCP SDK handler. The split is therefore deliberate:
Better Auth owns authorization, PKCE, tokens, consent, discovery and resource
metadata; the official MCP SDK owns the stateless wire protocol, MRTR, routing
headers and cache hints.

Public clients use:

- authorization-code grant;
- PKCE with `S256`;
- `token_endpoint_auth_method=none`;
- an exact pre-registered redirect URI;
- the canonical resource indicator (`MCP_RESOURCE_URL`);
- no client secret.

The web settings page at `/settings/integrations` can register a public client,
copy its `client_id`, list/revoke owned clients, and list/revoke consent grants.
The consent screen at `/auth/consent` validates Better Auth's signed OAuth
transaction before showing client metadata or requested scopes. Only the
provider follows the registered redirect URI; the UI never redirects to an
untrusted query-string value.

Better Auth 1.6.26 does not expose a stable per-user token-list API. Tokens are
therefore never serialized into settings. Revoking a consent or client blocks
refresh and future authorization; an already-issued short-lived JWT expires
normally.

### Client pre-registration API

Authenticated web and Expo clients can use the Better Auth OAuth client
plugin, or these equivalent endpoints:

| Action              | Method and endpoint                    |
| ------------------- | -------------------------------------- |
| List owned clients  | `GET /api/auth/oauth2/get-clients`     |
| Create a client     | `POST /api/auth/oauth2/create-client`  |
| Revoke a client     | `POST /api/auth/oauth2/delete-client`  |
| List consent grants | `GET /api/auth/oauth2/get-consents`    |
| Revoke a consent    | `POST /api/auth/oauth2/delete-consent` |

A public-client creation body is shaped like this:

```json
{
  "client_name": "My assistant",
  "redirect_uris": ["http://127.0.0.1:8765/callback"],
  "token_endpoint_auth_method": "none",
  "grant_types": ["authorization_code", "refresh_token"],
  "response_types": ["code"],
  "type": "native",
  "scope": "openid profile offline_access avermate:read avermate:write"
}
```

The protected resource always requires `avermate:read`. A client that needs
private social data adds one or more of `avermate:social.read`,
`avermate:social.manage`, and `avermate:social.moderate` to that base scope.
Request only the surfaces the assistant actually needs; the three social scopes
are independent and do not imply one another.

Loopback redirects are appropriate for installed clients. Browser clients
should register an HTTPS callback. Redirect URIs must be exact; public clients
must not persist or display a client secret.

### CIMD and deprecated DCR

MCP 2026-07-28 deprecates Dynamic Client Registration in favor of Client ID
Metadata Documents (CIMD). The stable Better Auth release used here supports
DCR but does not yet provide stable CIMD support. Avermate therefore uses
explicit user-owned pre-registration as the safe default.

`MCP_ENABLE_DCR=false` is the default. Setting it to `true` temporarily exposes
Better Auth's transitional RFC 7591 registration endpoint. Do this only for a
known legacy client and turn it off again. Do not enable a beta authentication
dependency solely to gain CIMD; adopt the stable provider implementation when
it becomes available.

## Scopes

| Scope                      | Capability                                                                                                                                                                                         |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `avermate:read`            | Read account, academic structures, grades, averages, goals, preferences, announcements, analytics, feedback, and recaps. Required for MCP access.                                                  |
| `avermate:write`           | Create and update academic data, goals, dashboard cards, preferences, feedback, and read-state.                                                                                                    |
| `avermate:delete`          | Make destructive tools discoverable. Each call still requires a separate multi-round confirmation.                                                                                                 |
| `avermate:admin`           | Discover the administrator surface with `avermate:read` only when the account also has the backend `admin` role. Admin writes/deletes additionally require their ordinary write/delete scope.      |
| `avermate:social.read`     | Read the connected user's eligibility, private profile/grants, capability-safe relationships, groups and policies, threshold-protected comparisons, notifications, own reports, and social export. |
| `avermate:social.manage`   | Update the connected user's profile/grants/ranking choices and perform confirmed eligibility, friendship, block, group, policy, report, and social-reset workflows.                                |
| `avermate:social.moderate` | Read social moderation counts/reports/audit and perform confirmed profile/group freezes, only when the account also has the backend `admin` role.                                                  |

OIDC scopes (`openid`, `profile`, `email`, `offline_access`) have their usual
authorization-server meaning. A scope never bypasses an oRPC ownership or role
check. `avermate:delete` expires after 15 minutes,
`avermate:social.manage` after 30 minutes, and both `avermate:admin` and
`avermate:social.moderate` after 10 minutes. The protected-resource metadata
advertises all seven Avermate scopes from the live authorization-server
configuration.

## Server surface

The catalog covers:

- account profile and complete safe data export;
- academic years, periods, and ordering;
- subject/category hierarchies and deletion impact;
- grades, composite components, recent results, and reassignment;
- custom averages;
- goals and achieved state;
- dashboard cards and layouts;
- preferences, chart settings, and celebrations;
- announcements and dismissal history;
- analytics snapshots and annual recap eligibility/status;
- feedback submission and history;
- opt-in social eligibility and profile grants;
- capability-safe friends, requests, circles and blocks;
- private groups/classes, immutable sharing policies, re-consent,
  threshold-protected aggregate statistics and opt-in rankings;
- privacy-safe social notifications, reports and account export/reset;
- administrator overview, users, announcements, feedback, roles, and
  suspensions, gated by both scope and role;
- social moderation overview, reports, value-free audit history and confirmed
  profile/group freezes, gated independently by `avermate:social.moderate` and
  the backend `admin` role.

The social read, manage, and moderation catalogues are deliberately isolated.
An academic `avermate:read` token does not discover social tools; a social-read
token does not discover mutations; and a non-admin token with
`avermate:social.moderate` does not discover moderation tools. Social operations
still pass through the same feature flag, eligibility/guardian consent,
field-grant, group-policy, cohort-threshold, ownership, and moderation checks as
the web and Expo applications. MCP never exposes raw grades, notes, subject
names, email addresses, or internal account identifiers through social DTOs.

Resources include account, years, preferences, announcements, and eligible
recaps. Resource templates provide:

- `avermate://years/{yearId}/snapshot`;
- `avermate://subjects/{subjectId}`;
- `avermate://grades/{gradeId}`.

Prompts include `academic-check-in`, `grade-impact-analysis`, `goal-plan`, and
`year-recap`. They direct the assistant to read real Avermate data first and
never invent identifiers or silently modify data.

## Destructive operations and MRTR

Deletion is never inferred from ordinary text and never runs on the first tool
call. A destructive tool returns `resultType: "input_required"` with an
elicitation form and a signed `requestState`. The client must repeat the same
tool and arguments on a fresh JSON-RPC request, echo the byte-exact state, and
provide an accepted confirmation response.

The signed state binds:

- user and OAuth client;
- tool name and argument hash;
- method and expiry;
- caller-supplied UUID idempotency key.

A database replay fence records each destructive operation. Repeating a
completed call returns its stored result. Reusing the idempotency key for
different arguments fails. If a process stops while an operation is pending,
Avermate fails closed and asks the caller to inspect the resource before using
a new key.

## Request example

```http
POST /mcp HTTP/1.1
Authorization: Bearer eyJ...
Accept: application/json, text/event-stream
Content-Type: application/json
MCP-Protocol-Version: 2026-07-28
Mcp-Method: tools/call
Mcp-Name: years.list

{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "tools/call",
  "params": {
    "name": "years.list",
    "arguments": {},
    "_meta": {
      "io.modelcontextprotocol/protocolVersion": "2026-07-28",
      "io.modelcontextprotocol/clientInfo": {
        "name": "example-assistant",
        "version": "1.0.0"
      },
      "io.modelcontextprotocol/clientCapabilities": {
        "elicitation": { "form": {} }
      }
    }
  }
}
```

Non-ASCII `Mcp-Name` and `Mcp-Param-*` values must use the base64 sentinel
encoding defined by the specification. The SDK validates standard headers,
the request envelope, version, capabilities, and schema before dispatch.

## Configuration and deployment

Add these values to the server environment:

```dotenv
BETTER_AUTH_URL=https://api.example.com
CLIENT_URL=https://app.example.com
BETTER_AUTH_SECRET=<at-least-32-random-characters>

MCP_RESOURCE_URL=https://api.example.com/mcp
MCP_REQUEST_STATE_SECRET=<independent-at-least-32-character-secret>
MCP_ALLOWED_HOSTS=
MCP_ALLOWED_ORIGINS=
MCP_ENABLE_DCR=false
```

`MCP_RESOURCE_URL` defaults to `${BETTER_AUTH_URL}/mcp`. Use an independent
request-state secret in production. `MCP_ALLOWED_HOSTS` and
`MCP_ALLOWED_ORIGINS` are comma-separated additions for an intentional proxy
topology; the public resource host and web application host are already
allowed. Never use them as wildcards.

Apply database migrations before starting a new server build:

```bash
bun install --frozen-lockfile
bun run db:migrate
bun run --cwd apps/server build
bun run --cwd apps/server start
```

The migration adds OAuth clients, refresh/access-token records, consents,
signing keys, and the MCP destructive-operation replay fence. Query clients,
sessions, and caches remain request/user scoped; OAuth tokens and authentication
tables are excluded from MCP account export.

## Verification

Run the focused conformance suite with:

```bash
bun test apps/server/src/mcp/protocol.test.ts
```

It executes the handler through `handler.fetch` in an isolated process and
covers modern envelopes, version/header rejection, deterministic catalogs and
cache hints, resource templates/prompts, scopes and role gates, ownership,
read-only mutation denial, isolated social read/manage/moderation catalogues,
signed MRTR confirmation, idempotent replay, protected-resource discovery,
DCR-off behavior, unauthenticated challenges, and a real authorization-code +
PKCE exchange whose JWT calls `/mcp`.

The implementation is based on:

- [MCP 2026-07-28](https://modelcontextprotocol.io/specification/2026-07-28.md);
- [MCP TypeScript SDK v2 support guide](https://ts.sdk.modelcontextprotocol.io/v2/migration/support-2026-07-28.md);
- [Better Auth OAuth Provider](https://www.better-auth.com/docs/plugins/oauth-provider).
