# Avermate implementation plans

This registry covers the completed foundation wave (000–024), the implemented
agent-platform foundation (025–034), and the production/product-completion wave
(035–039). It was reconciled against the working tree on 2026-08-22 at
`dbd4fe8` on branch `rewrite`; replace that evidence SHA with the committed
025–034 implementation baseline before executing plan 035.

> [!IMPORTANT]
> The 025–034 implementation currently exists in a large reviewed working tree.
> Its root tests, types, lint, formatting and release security gates are green,
> but plan 025 remains blocked by the unratified historical migration rewrite,
> the global slop gate, clean-clone evidence and the maintainer's licence choice.
> Preserve and commit the migration block atomically; never turn those release
> blockers or unavailable live providers into skips.
>
> The 033/034 gates now distinguish repository/shadow evidence from live
> provider evidence. Real Chromium ingestion passes locally; disabled sandbox
> providers are reported unavailable and the live gates fail explicitly. The
> 034 shadow aggregate reaches the Garage conformance cell and is blocked by the
> unhealthy Docker Desktop host, while its non-Docker accounting, isolation,
> deletion, restore and load cells pass.

## Product thesis

Avermate targets a free, open-source school workspace that combines:

- an excellent grade, average, year and school-source tracker;
- course sources, search, transcription and cited study projects;
- an embedded branchable assistant and a public MCP surface over the same tools;
- generated study artifacts such as notes, quizzes, LaTeX/PDF, PPTX, podcasts
  and deterministic narrated videos;
- explicit execution placement: no inference, user BYOK, user-owned Avermate
  Node, optional managed capacity, or complete self-hosting.

The repository cannot yet be advertised as open source because it has no
published license; resolving and publishing that license is a mandatory plan
025 release gate, not optional wording. `avermate.fr` remains useful without
file hosting or paid inference. The hosted
core may own accounts and academic data while a paired node owns selected files,
conversations, indexes, models and sandboxes. Full self-hosting uses the same
contracts. No paid plan is allowed to become a prerequisite for the academic
core, export, external MCP, BYOK or self-hosting.

The old MCP-first architecture reached its documented revisit trigger. MCP stays
first-class; it is no longer a reason to exclude an embedded assistant.

## Execution order and status

| Plan | Title                                                            | Priority | Effort | Depends on              | Status                                                   |
| ---- | ---------------------------------------------------------------- | -------- | ------ | ----------------------- | -------------------------------------------------------- |
| 000  | Pre-merge hygiene                                                | P1       | S      | —                       | DONE                                                     |
| 001  | First-class files entity and shared storage                      | P1       | M      | —                       | DONE                                                     |
| 002  | Durable background-job substrate                                 | P1       | L      | —                       | DONE                                                     |
| 003  | Modular MCP surfaces and unified admin gate                      | P1       | M      | —                       | DONE                                                     |
| 004  | Agenda/todo domain, unified feed and kanban                      | P2       | L      | 003 for MCP             | DONE                                                     |
| 005  | Course-materials vertical slice                                  | P2       | L      | 001, 003                | DONE                                                     |
| 006  | Grade-copy attachments                                           | P2       | S–M    | 001                     | DONE                                                     |
| 007  | AI architecture v1: MCP-first and key policy                     | P1       | S–M    | —                       | DONE; superseded in part by 026                          |
| 008  | Provider-sync framework and Moodle                               | P2       | L      | 001, 002, 005           | DONE                                                     |
| 009  | OCR to Markdown artifacts                                        | P2       | M–L    | 002, 005                | DONE                                                     |
| 010  | Documents/fiches and rich Markdown                               | P2       | L      | 005                     | DONE                                                     |
| 011  | MCP authoring surface and workflows                              | P2       | M      | 003, 005, 010           | DONE                                                     |
| 012  | Lecture recording and transcription                              | P3       | XL     | 001, 002, 005, 007      | DONE for current Web/Core scope                          |
| 013  | Static Web source ingestion                                      | P2       | M      | 002, 005, 009           | DONE                                                     |
| 014  | Fluid type with `tailwind-clamp`                                 | P3       | S–M    | —                       | DONE                                                     |
| 015  | Card-template gallery                                            | P3       | M–L    | —                       | DONE                                                     |
| 016  | Cross-platform design tokens and Web density                     | P3       | L      | —                       | DONE for Web/Core; React Native excluded                 |
| 017  | Mind maps, slides and PPTX artifacts                             | P3       | L      | 002, 010                | DONE                                                     |
| 018  | Pronote/EcoleDirecte/Skolengo connector spike                    | P3       | M      | 008                     | DONE                                                     |
| 019  | Sustainability, BYOK and self-host ADR                           | P2       | M      | 007                     | DONE; satellite expanded by 032                          |
| 020  | Materials explorer roadmap                                       | P1–P3    | XL     | 001, 002, 005, 008, 010 | DONE                                                     |
| 021  | Connected school-year design rationale                           | —        | —      | 008, 018                | SUPERSEDED by `docs/school-integrations.md`              |
| 022  | Defensive Web ingestion and caption-first YouTube                | P2       | M      | 009, 012, 013           | DONE for static/caption path                             |
| 023  | Read-only Google Drive connector                                 | P3       | M–L    | 020                     | DONE                                                     |
| 024  | Document kinds, rich rendering, quiz, LaTeX, Pyodide and podcast | P1–P2    | XL     | 020, 022                | DONE                                                     |
| 025  | Reproducible release baseline and product contract               | P0       | L      | completed current work  | BLOCKED — migration/licence/slop/clean clone             |
| 026  | Agent architecture v2 and protocol spikes                        | P0       | M–L    | 025                     | DONE — implementation; release inherits 025              |
| 027  | Unified tool registry and policy broker                          | P0       | L–XL   | 025, 026                | DONE                                                     |
| 028  | Study projects, versioned corpus and hybrid retrieval            | P0       | XL     | 025–027                 | IN PROGRESS — core green; production/UI gap              |
| 029  | Embedded, durable, branchable read-only assistant                | P0       | XL     | 026–028                 | IN PROGRESS — implementation green; rollout eval pending |
| 030  | Agent approvals, action ledger and selective undo                | P1       | XL     | 026, 027, 029, 031      | DONE for reviewed brokered rollout                       |
| 031  | Sandbox provider and versioned workspaces                        | P1       | XL     | 026–029                 | BLOCKED — live attested provider required                |
| 032  | Avermate Node hybrid data plane and configurator                 | P1       | XL     | 025–031 as scoped       | IN PROGRESS — relay/product lifecycle gaps               |
| 033  | Dynamic ingestion and generated media studio                     | P2       | XL     | 025–032                 | IN PROGRESS — real browser green; live sandbox/UI gaps   |
| 034  | Optional managed AI/storage and production operations            | P2       | XL     | 025–032; consumes 033   | IN PROGRESS — shadow green except host Docker/live ops   |
| 035  | Production agent runtime and model placement                     | P0       | XL     | 025–034 as scoped       | TODO                                                     |
| 036  | Multimodal school RAG, embeddings and reranking                  | P0       | XL     | 028, 029, 033, 035, 038 | TODO                                                     |
| 037  | School learning loop and measurable mastery                      | P0       | XL     | 004, 006, 024, 027–036  | TODO                                                     |
| 038  | Complete Node, full self-host and specialist workers             | P0       | XL     | 025–037                 | TODO                                                     |
| 039  | Managed beta and commercial readiness                            | P1       | XL     | 025, 031–038            | TODO                                                     |

Status values are `TODO`, `IN PROGRESS`, `DONE`, `BLOCKED` with a reason, or
`SUPERSEDED` with a current source of truth. An executor reads the entire plan,
honors its STOP conditions and updates this row only after its definition of done
is met.

## What is actually implemented now

The foundation is much further ahead than the top-level README suggests:

- academic years, periods, subjects, grades, adjustments and honest average
  comparison are mature;
- Moodle and EcoleDirecte are production integrations; Pronote and Skolengo have
  adapters/tests but remain deployment-gated by the repository/dependency
  licensing decision;
- school-source identity, mappings, provider-owned fields, local overlays and
  detach/dismiss behavior are implemented and documented;
- local and S3-compatible storage, upload, PDF viewing/previews, OCR, media
  transcription, batch progress, cloud/Moodle sync and source ingestion exist;
- rich Markdown, documents, quizzes, LaTeX/PDF, PPTX, Anki, HTML and podcast
  artifacts exist;
- MCP already exposes a broad domain surface, and the durable job substrate is
  suitable for expansion.

The remaining product loop is now more precise:

- the production assistant still bypasses the proved `AgentRuntime` seam and
  advertises only one direct model provider;
- the cited corpus is lexical/text-dense today; visual pages, Gemini multimodal
  embeddings, cross-encoder reranking and branch-pinned project conversations
  are not implemented end to end;
- the assistant shell is substantial, but Node settings, full configurator,
  media studio, learning-evidence/mastery and managed customer/operator Web
  experiences are incomplete;
- sandbox and specialist-worker contracts exist, but no live attested provider,
  runtime checkpoint, OpenCode/OpenHands worker or production media placement has
  passed release conformance;
- Avermate Node has local contracts/providers but lacks production Core pairing,
  relay, durable capability transports and lifecycle tooling;
- managed accounting is a correct shadow foundation, not an isolated operated
  service or enabled billing product;
- the project still has no published open-source licence.

The current estimate is **65–75% of the complete technical vision** and roughly
**45–55% of production/operational readiness**. Academic Core is substantially
more mature than the new AI/Node/managed surfaces. These are judgement ranges,
not percentages derived from issue counts.

## Next-wave dependency graph

```text
025 release baseline + licence/product contract
 └─ 026–034 agent/tool/corpus/chat/action/sandbox/Node/media/managed foundations
     ├─ 035 production AgentRuntime + model placements
     │   └─ 036 multimodal corpus + embeddings + reranking
     │       └─ 037 evidence-driven school learning loop
     ├─ 038 production Node + full-self-host lifecycle + specialist workers
     │   └─ 036 Node-local embedding/rerank placement
     └─ 039 managed beta/operations/billing readiness
         └─ consumes the live isolation and runtime proofs from 031/038
```

Safe parallelism after 026:

- 028 starts only after the 026/027 event, identity and policy contracts are
  frozen; its schema and Core adapters can then proceed in parallel internally;
- 031's provider, image-builder and snapshot substrate can proceed alongside
  028/029 after 027, but the plan cannot be DONE before its atomic conversation
  checkpoint integration with 029 passes;
- 030 waits for real read-only conversations and the 031 snapshot substrate;
  conversation-only forks never copy a workspace implicitly;
- 032 may begin protocol/configurator work before every adapter exists, but
  cannot claim end-to-end capability placement until 028/029/031 adapters pass;
- 033 can prepare human/job static/dynamic/video/artifact slices after 031, but
  completion consumes 032's storage contract and embedded/MCP writes wait for
  029/030;
- 034 starts usage accounting in shadow mode before any checkout integration.

## Architecture decisions for the next wave

| Concern                 | Decision                                                                                                                                                                                        |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Web chat shell          | `assistant-ui` ExternalStoreRuntime; Avermate owns persistence, routing and thread list                                                                                                         |
| Rich answer rendering   | Preserve Avermate Markdown/LaTeX/Mermaid/code rendering; adopt selected AI Elements where useful                                                                                                |
| Stream/event vocabulary | AG-UI stable event semantics inside a versioned persisted Avermate envelope                                                                                                                     |
| Conversation authority  | The selected `ConversationStore` is canonical: Core persists Core threads; a paired node persists node threads and replays them, while the Core relay stores routing/sequence/ack metadata only |
| Harness                 | LangGraph JS behind an Avermate `AgentRuntime`; time-box a Mastra comparison, avoid framework types in domain tables                                                                            |
| Model/provider access   | First-party `ModelGateway`, AI SDK/OpenAI-compatible adapters; LiteLLM optional for managed operations; hosted custom endpoints are public-HTTPS/SSRF-filtered only                             |
| Tools                   | One registry/policy broker shared by MCP and embedded runs; existing oRPC/domain services stay authoritative                                                                                    |
| Retrieval               | `CorpusStore` + mandatory lexical backend first, exact version/chunk locators always, optional versioned embeddings second                                                                      |
| Agent execution         | `SandboxProvider`: OpenSandbox default self-host target, E2B managed adapter, Microsandbox experimental local adapter                                                                           |
| Hybrid hosting          | Outbound-connected Avermate Node with per-capability placement and explicit data movement/fallback                                                                                              |
| Coding agents           | OpenCode/OpenHands only as optional bounded specialist workers, not the Avermate harness                                                                                                        |
| Reasoning display       | Visible plan, todo, status, tool calls, sources and provider-approved summaries; never raw hidden chain of thought                                                                              |

Four histories stay distinct and are linked by unambiguous IDs rather than
conflated:

1. conversation message DAG and branches;
2. harness checkpoints/replay state (`conversationCheckpointRef`);
3. sandbox workspace snapshots (`workspaceSnapshotRef`) and optional runtime VM
   checkpoints (`sandboxRuntimeCheckpointRef`);
4. domain action ledger and compensating undo (`domainCursorRef`).

Editing an old message can fork the first three. Reverting academic data is a
separate previewed action; it is never an implicit database rollback.

Node placement means “no durable conversation plaintext in the hosted Core,”
not end-to-end encryption: the initial relay may process plaintext transiently,
and a model provider sees the content it is sent. Reconnect/replay for a node
thread depends on that node being reachable; an unavailable node produces an
explicit unavailable state rather than a silent Core mirror.

## Vision coverage

| Vision element                                                            | Plans/source of truth                                                       |
| ------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| Grades, periods, averages and adjustments                                 | Existing implementation; `docs/school-integrations.md` for synced authority |
| EcoleDirecte/Moodle/Pronote/Skolengo                                      | 008, 018, 021 rationale and current school-integration docs                 |
| Agenda, calendar, todo and kanban                                         | 004                                                                         |
| Own files, PDF view, OCR and transcription-all progress                   | 001, 002, 005, 009, 012, 020, 024                                           |
| OneDrive/Google Drive/Moodle sources                                      | 008, 020, 023                                                               |
| Projects/notebooks, corpus search and inline citations                    | 028; advanced multimodal/rerank completion in 036                           |
| Embedded streaming chat, models, dictation, attachments, branches, export | 026, 029; production provider/placement completion in 035                   |
| Custom MCP/skills and any external AI client                              | 027, 029; existing MCP remains supported                                    |
| Agent mutations, approval modes, logs and undo                            | 030                                                                         |
| Versioned virtual execution environment                                   | 031; runtime checkpoints and specialist workers complete in 038             |
| Hybrid avermate.fr plus user backend                                      | 032; production relay and Web completion in 038                             |
| Full self-host and visual Compose/config builder                          | 032; distribution/lifecycle completion in 038                               |
| Dynamic pages, video transcription fallback and private inline images     | 033, including its required Web studio completion                           |
| LaTeX/PPTX/podcast/video/Manim and visual review loops                    | 024, 031, 033, 035, 038                                                     |
| Copy diagnosis, concepts, plans, practice and measured progress           | 037                                                                         |
| Gemini multimodal embeddings, local/cloud reranking and advanced RAG      | 036                                                                         |
| BYOK, managed quotas and optional paid convenience tier                   | 019, 026, 032, 034, 038, 039                                                |

## Audit-closure matrix for plans 025–039

The wave is not complete merely because backend contracts exist. Each row below
requires its server/domain path, durable lifecycle, security/placement proof and
functional Web experience unless explicitly described as external-client only.

| Audited requirement                                                                                                                                    | Owning completion plan(s)                                                              |
| ------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------- |
| Production branchable chat runtime, replay, edit/retry, status/tool/usage parts, dictation, attachments, export and project save                       | 029 foundation; 035 production runtime and Web acceptance                              |
| Model catalogue, BYOK/OpenRouter/direct/local/managed placements, optional LiteLLM actually usable                                                     | 026 foundation; 035 and 038 implementation; 039 managed operations                     |
| One ToolBroker for embedded/MCP, scoped custom MCP/skills, approvals, audit and undo                                                                   | 027 and 030; production projection in 035                                              |
| No raw chain of thought; visible plan/todo/status/sources/provider-approved summaries                                                                  | 026, 029 and 035                                                                       |
| Projects/notebooks, exact source versions, branch-aware conversations and private inline images                                                        | 028, 033 and 036                                                                       |
| Advanced RAG: FTS, multimodal Gemini adapter, provider-neutral vectors, RRF, cloud/local cross-encoder reranking and measured French-school evaluation | 028 foundation; 036 completion                                                         |
| Original PDF/page/image/audio/video evidence, OCR/transcript on demand and exact page/region/timecode citations                                        | 020, 024, 028, 033 and 036                                                             |
| YouTube captions plus authorized audio fallback, dynamic public Web ingestion, thumbnails and source assets                                            | 022 and 033, including the required Web studio                                         |
| LaTeX/PDF/PPTX/quiz/Anki/podcast/narrated video/Manim creation, preview, visual review, revision, export and durable progress                          | 024 and 033; runtime/worker activation in 035/038                                      |
| Versioned logical workspaces, provider-native runtime checkpoints and bounded OpenCode/OpenHands specialists                                           | 031 foundation; 038 completion                                                         |
| Hosted Core + custom Node pairing/relay and per-capability file/chat/search/model/sandbox placement                                                    | 032 foundation; 038 production and Web completion                                      |
| Visual self-host configurator, Garage/S3/filesystem, Compose profiles, offline bundle, backup/restore and N−1 upgrade                                  | 032 foundation; 038 completion                                                         |
| Copy/photo analysis, concepts/objectives/errors, learning plan, quiz evidence and measurable longitudinal progress                                     | 037, including all critical Web workflows                                              |
| Managed storage/inference/sandbox, isolation, quotas, usage, privacy, customer/operator UI and eventual billing                                        | 034 shadow foundation; 039 staged activation                                           |
| School provider-owned grades/subjects/years with local overlays and honest provider-vs-Avermate averages                                               | Existing 008/018/021 implementation and `docs/school-integrations.md`; consumed by 037 |
| Distinct agenda, calendar, todo and kanban with learning-task integration                                                                              | 004 foundation; 037 integration                                                        |
| Settings search inside pages, service-key/provider setup and capability readiness                                                                      | Existing settings search; 035, 036, 038 and 039 provider/placement pages               |
| Responsive, accessible, localized Web loading/empty/error/offline/cancelled states for every new flow                                                  | Explicit release criterion in 033 and 035–039                                          |

React Native remains excluded by maintainer instruction. External provider/live
host/licence prerequisites may block release evidence, but they may not be
relabelled as optional implementation or omitted from these plans.

## Decisions that remain explicit

- **License**: plan 025 must choose and publish one before “open source” and
  license-gated school adapters can be claimed publicly. The choice must be
  compatible with included dependencies and the desired hosted-service model;
  plan 025 remains BLOCKED rather than DONE if this decision is unresolved.
- **School connections**: the local year stays user-owned. The immutable object
  is the remote-account/student/year binding. Provider-owned field values are
  locked while local labels, hierarchy, overlays and locally created grades stay
  available. Provider and Avermate averages are distinct.
- **AppScho is not Skolengo**: a future Blockscho-based AppScho connector is a
  separate provider and dependency/licence decision; it must not replace or be
  labelled as the existing Skolengo connector.
- **No React Native wave**: the current roadmap targets server/Core/Web and
  deployment. It does not reopen the previously excluded mobile adapter work.
- **No unrestricted shell**: tools are typed domain operations; execution is a
  bounded sandbox capability. The unsafe `shell=True` prototype is UX research,
  not backend code to port.
- **No raw chain of thought**: operational visibility means status, plan, tool
  calls, sources, usage and approved reasoning summaries.
- **No silent paid fallback**: node, BYOK, managed and disabled placements are
  explicit and persisted per capability/object.
- **Generated video is allowed**: it is a deterministic artifact pipeline with
  a versioned timeline, trusted FFmpeg construction and optional isolated Manim,
  not arbitrary shell or blind browser recording.
- **`yt-dlp` is conditional**: captions first; public/authorized audio fallback
  only in an isolated opt-in execution profile, never cookie/DRM bypass.

## Known later decisions, not reasons to stall 025–034

1. Spaced-repetition scheduling beyond existing quiz/Anki outputs.
2. Community marketplace/moderation for cards, skills and artifact templates.
3. Server-side PDF print export if browser print and current LaTeX/PDF builds do
   not cover the final use cases.
4. Whether school-service credentials execute centrally or on a user node by
   default; 032 provides the capability seam without forcing a premature answer.
5. Exact managed billing provider, prices and allowances; 034 intentionally
   builds provider-neutral entitlement/usage correctness first.
6. Whether arbitrary Manim/Python is ever offered on managed infrastructure;
   the safe template/DSL adapter does not require that decision.

## Historical findings preserved

- Plan 025 creates `docs/references/fichr-chat-poc.md`, a sanitized and
  repository-local design note derived from the historical `Fichr` POC. It may
  preserve UX lessons such as search, model selection, edit/retry branches,
  navigation, copy and streaming tool events, but must not import its database,
  private chats, credentials or unsafe generic-shell implementation.
- Never port or expose secrets from reference projects. Test credentials are
  created/rotated through supported settings and secret stores.
- Do not store school passwords. Use the provider's supported sealed session or
  token strategy and stable remote student identity.
- `preferences` does not need a global JSON-column retrofit. New typed JSON
  columns require a version discriminator and validation.

## Verification baseline

Plan 025 records the exact supported commands and environment from a clean
clone. Until then, the intended root gates are:

```text
bun install --frozen-lockfile
bun run format:check
bun run lint
bun run check-types
bun run test
bun run build
bun run db:migrate
```

Server/Core subsets and Docker-backed sandbox/storage conformance suites are
added by their owning plans. A plan may not redefine a skipped or unavailable
integration test as success; it records the environment reason and requires the
appropriate release job.
