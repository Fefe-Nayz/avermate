# Plan 026 agent dependency review

This review records the dependency state used by the plan 026 proof on
2026-08-22. Versions come from the manifests and `bun.lock`; licences and
lifecycle scripts come from the installed package manifests. This is not an
approval to enable a production chat route.

## Direct dependencies

| Package                              | Exact version | Licence    | Runtime and reason                                                    | Pin policy                                                       |
| ------------------------------------ | ------------: | ---------- | --------------------------------------------------------------------- | ---------------------------------------------------------------- |
| `@assistant-ui/react`                |       0.15.16 | MIT        | Web-only external-store projection for the development assistant page | Exact because the public API is pre-1.0                          |
| `@ag-ui/core`                        |        0.0.58 | MIT        | Server-only validation/projection of stable AG-UI semantics           | Exact because the protocol package is pre-1.0                    |
| `@langchain/core`                    |         1.2.9 | MIT        | Server runtime types used by the LangGraph adapter                    | Exact for a reproducible checkpoint proof                        |
| `@langchain/langgraph`               |        1.4.12 | MIT        | Server-only graph, interrupt and checkpoint runtime                   | Exact; upgrade requires persisted-checkpoint compatibility tests |
| `ai`                                 |        7.0.76 | Apache-2.0 | Server-only direct AI SDK streaming with explicit provider objects    | Exact for normalized-stream fixtures                             |
| `@ai-sdk/openai-compatible`          |        3.0.34 | Apache-2.0 | Server-only OpenAI-compatible adapter                                 | Exact for normalized-stream fixtures                             |
| `zod` in `@avermate/agent-contracts` |         4.4.3 | MIT        | Provider-free shared wire/runtime validation                          | Exact in the contracts package                                   |

`@avermate/agent-contracts@0.0.0` is a private workspace package. Its public
licence is intentionally reported as unresolved while the repository-level
licence decision from plan 025 remains unresolved; it must not be published on
the assumption that `private: true` is a licence.

At the plan-026 baseline LiteLLM and Mastra were not installed. Plan 038 has
since added LiteLLM as an optional, explicitly selected `ModelGateway` profile;
it still is not the assistant's source of truth. Mastra remains unselected. The
comparison is recorded in [`ai-architecture-v2.md`](../ai-architecture-v2.md).

## Transitive review

The resolved dependency closure of the six external direct packages contains
119 unique installed packages. Installed manifests report:

| Licence expression          | Package count | Notes                                                                            |
| --------------------------- | ------------: | -------------------------------------------------------------------------------- |
| MIT                         |           109 | Includes assistant-ui, AG-UI, LangGraph, `langsmith`, Radix and Zod dependencies |
| Apache-2.0                  |             7 | AI SDK packages, `@vercel/oidc` and `@workflow/serde`                            |
| BSD-3-Clause                |             1 | `secure-json-parse`                                                              |
| 0BSD                        |             1 | `tslib`                                                                          |
| `(AFL-2.1 OR BSD-3-Clause)` |             1 | `json-schema@0.4.0`; the BSD-3-Clause option is available                        |

No selected package or package in these resolved closures declares a
`preinstall`, `install` or `postinstall` script, a `gypfile`, or an optional
native dependency in its installed manifest. The proof therefore adds no
downloaded browser binary, native addon build or external service at install
time.

Notable transitives require explicit architectural treatment:

- `@langchain/core@1.2.9` installs `langsmith@0.9.0`. The spike does not
  configure a LangSmith client or callbacks. Self-host/private profiles must
  keep external tracing disabled unless an administrator explicitly opts in.
- `ai@7.0.76` installs `@ai-sdk/gateway@4.0.61` and `@vercel/oidc@3.2.0`.
  Avermate passes explicit provider instances and does not use model-name
  strings that would silently select Vercel AI Gateway.
- `@assistant-ui/react@0.15.16` resolves 91 packages because it brings
  assistant-ui core/store/tap, Radix, Zustand and related presentation
  dependencies. It cannot be treated as a zero-cost wrapper.

## Footprint and bundle impact

Installed directory size is useful for supply-chain and deployment review but
is not a browser bundle measurement. Unique recursive closures in this lockfile
measure:

| Root dependency set                        | Unique packages | Installed bytes |
| ------------------------------------------ | --------------: | --------------: |
| `@assistant-ui/react`                      |              91 |      20,930,918 |
| `@ag-ui/core`                              |               2 |       9,314,994 |
| `@langchain/core` + `@langchain/langgraph` |              19 |      48,189,955 |
| `ai` + `@ai-sdk/openai-compatible`         |              11 |      11,315,330 |

The numbers overlap through shared dependencies and must not be added. They
include source maps, declarations and package sources that a bundler does not
ship.

A reproducible Bun minified-entry smoke, with no externalization or source
maps, produced these raw upper-bound artifacts:

| Entry                                                                |                     Raw bytes | Interpretation                                                                                                                    |
| -------------------------------------------------------------------- | ----------------------------: | --------------------------------------------------------------------------------------------------------------------------------- |
| `apps/server/src/agent/agui-adapter.ts`                              |                       418,831 | Server artifact only                                                                                                              |
| `apps/server/src/agent/langgraph-runtime.ts`                         |                     1,225,101 | Server artifact only; includes the graph runtime selected by the entry bundler                                                    |
| `apps/server/src/agent/model-gateways.ts`                            |                       645,944 | Server artifact only; includes AI SDK adapters                                                                                    |
| `apps/web/src/components/assistant-spike/assistant-spike-client.tsx` | 14,119,956 JS + 1,463,391 CSS | Synthetic browser entry, not a Next route chunk; it also pulls the existing full Markdown/diagram/code renderer and global styles |

The Web result is deliberately not described as assistant-ui's incremental
cost. It proves that a naive single client entry is unacceptable for
production. The current page is development-only, but Next may still emit an
unreachable route chunk during a production build. Before plan 029 enables a
real route it must capture the actual Next route chunks, compare against the
pre-assistant build, lazy-load heavy Markdown/diagram renderers and set a
reviewed compressed transfer budget.

Server packages do not enter browser imports. `packages/agent-contracts`
contains only TypeScript/Zod contracts, and the Web depends on that package
rather than server adapters.

## Upgrade and release rules

- Upgrade `@assistant-ui/react` or `@ag-ui/core` only with reconnect, refresh,
  unknown-event, branch-projection and adapter round-trip tests.
- Upgrade LangGraph only after opening a persisted old-schema checkpoint,
  proving resume and fork after process restart, and either declaring
  compatibility or failing closed with a migration path.
- Upgrade AI SDK adapters only when direct and OpenAI-compatible mocked streams
  still normalize to identical content, fragmented tool calls, finish, usage,
  error, cancellation and reasoning events.
- Repeat the licence/lifecycle scan and production bundle delta on every
  dependency upgrade.
- Package presence never enables telemetry, a hosted control plane or an
  operator-paid gateway by default.
