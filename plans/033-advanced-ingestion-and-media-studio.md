# Plan 033: Advanced ingestion and media studio

> **Executor instructions**: Read plans 028–032 first. Ship the human/job slices
> independently, keep static/caption-first paths as defaults, and do not expose
> any write-capable embedded/MCP operation until plans 029 and 030 pass their
> conversation and action-ledger gates. Update the 033 row in `plans/README.md`
> only after every enabled capability passes its sandbox/security,
> artifact-lineage and compatibility gates. Do not enable managed execution,
> push or open a PR unless requested.
>
> **Drift check (run first)**: run `git diff --stat <plan-025-baseline>..HEAD --
apps/server/src/ingestion apps/server/src/lib/ingest.ts
apps/server/src/lib/youtube.ts apps/server/src/jobs apps/server/src/db/schema
apps/web/src/components/materials apps/web/src/components/documents infra`.
> Reconcile current ingestion/artifact contracts; stop if active rendering cannot
> be routed through plan 031 or source locators were flattened.

> [!IMPORTANT]
> Complete the NotebookLM-like source and artifact surface without turning the
> Avermate core into an unrestricted downloader or shell. Keep the current
> static/caption-first paths as the default; route browser rendering, media
> extraction, LaTeX/Manim and FFmpeg through plan 031's bounded execution
> profiles and plan 032's explicit placement router.

## Status

- **Status**: TODO
- **Priority**: P2
- **Effort**: XL (three independently shippable slices)
- **Risk**: HIGH
- **Depends on**: 025–032. Human/job implementation may be prepared after 031,
  but completion consumes 032's `ObjectStorageProvider`; embedded/MCP writes
  remain gated by 029–030 and node execution by 032 conformance
- **Blocks**: complete study-project authoring workflows and managed media
  entitlements in 034
- **Category**: ingestion, browser automation, media processing, artifacts
- **Planned at**: 2026-08-22
- **Planning baseline**: plan 025 baseline SHA

## Scope

**In scope**: sandboxed dynamic public-page rendering, private source assets,
caption-first video plus opt-in bounded audio extraction, immutable artifact
lineage/workflows, migration of current generators, narrated-slide timelines,
FFmpeg, thumbnails/visual checks and optional template/DSL Manim.

**Out of scope**: a general downloader/browser/shell, authenticated/private/DRM
content, arbitrary hosted Python, a complete studio UI redesign, public artifact
sharing and enabling managed execution before 034's launch gates.

## Outcome

A user can add a public course page or supported video, obtain a source with
exact provenance and private inline assets, and ask an agent to produce
revision-aware documents, presentations, narrated slides or Manim-backed
explanations. Every stage is represented by a durable job and artifact lineage;
it streams normalized progress, can be cancelled, observes quotas and runs in a
declared execution profile.

This plan deliberately does **not** promise that every URL is ingestible. Login,
DRM, bot challenges, paywalls, robots/publisher restrictions and unsupported
media produce a clear terminal reason. It also does not introduce a general
browser or command-execution tool into the hosted core.

## Existing foundation to preserve

- `apps/server/src/jobs/ingest-link.ts` owns the current link job, link-to-PDF
  transition and derived material artifact.
- `apps/server/src/lib/ingest.ts` enforces URL validation, bounded responses,
  redirect checks and static HTML extraction.
- `apps/server/src/lib/youtube.ts` validates supported YouTube URLs and ingests
  captions/chapters without downloading the video.
- `apps/server/src/jobs/transcribe-material-media.ts` and the OCR/transcription
  jobs already create machine-readable material artifacts.
- `apps/server/src/jobs/export-document-pptx.ts`,
  `build-document-latex.ts` and `export-document-artifact.ts` are existing
  document pipeline precedents.
- `apps/server/src/db/schema/artifacts.ts` stores material-derived content, and
  the document build/export tables store generated outputs.
- `apps/server/src/lib/jobs.ts` supplies durable attempts, leases,
  idempotency and cancellation. Do not create a second queue.
- `apps/server/src/lib/storage.ts` and `storage-backend.ts` are the current
  function-based byte-storage entry points. Plan 032 introduces the exact
  `ObjectStorageProvider` interface, adapts those functions and owns its
  conformance suite; this plan consumes that contract rather than inventing a
  second `FileStorage` abstraction.

The new code should extract reusable services from these paths rather than
growing `runIngestLinkJob` into another provider-specific monolith.

## Non-negotiable safety and product rules

1. Static extraction and first-party captions remain the cheapest/default path.
2. Dynamic rendering and downloader fallback require a sandbox execution
   profile; they never run inside the Web or API process.
3. URL policy is applied to every redirect, browser navigation, subresource and
   media URL. DNS rebinding and private/reserved IP destinations fail closed.
4. The runtime-level network policy is authoritative. Playwright request
   interception is defense in depth, not the isolation boundary.
5. No arbitrary command string, `shell: true`, browser cookie import, logged-in
   browser profile, password entry, DRM bypass or private-video scraping.
6. Media fallback is opt-in, restricted to content the user is authorized to
   process, and visibly records its extractor/provider.
7. Inputs and outputs are byte-, duration-, page-, CPU-, memory- and wall-time
   bounded before dispatch. Archive bombs and decompression expansion are
   bounded separately.
8. Temporary media is deleted after a verified artifact commit, including on
   cancellation/failure. A retention job reconciles leaks.
9. Every generated artifact records source versions, prompt/workflow version,
   model/provider, renderer image digest, tool versions and output digest.
10. Agent-facing tools accept structured schemas only. The LLM cannot provide
    executable shell, FFmpeg filters, LaTeX flags or arbitrary renderer code.

## Slice A — dynamic Web ingestion

### A1. Separate fetch policy from extraction strategy

Create bounded interfaces under `apps/server/src/ingestion/`:

```ts
type IngestionStrategy = "static-html" | "browser-render" | "pdf" | "youtube";

interface IngestionRequest {
  sourceId: string;
  canonicalUrl: string;
  strategy: IngestionStrategy;
  limits: IngestionLimits;
  policyRef: string;
}

interface IngestionResult {
  finalUrl: string;
  title: string;
  markdown: string;
  assets: CapturedAsset[];
  citations: SourceLocator[];
  diagnostics: IngestionDiagnostics;
}
```

- Move shared canonicalization, content limits and error taxonomy out of the job
  while preserving behavior and tests.
- Make strategy selection deterministic and persisted. Do not retry a static
  failure as a browser job silently.
- Add a user-visible `render dynamically` retry where the static result is
  empty/low quality or the extractor identifies a JavaScript shell.
- Permit an operator/user setting to auto-fallback only after presenting the
  extra privacy/resource implications. Store that choice with the ingestion
  revision.
- Do not use status-message string matching. Introduce stable reason codes such
  as `static_empty`, `dynamic_required`, `blocked_destination`,
  `authentication_required`, `content_too_large`, `publisher_denied` and
  `unsupported_content`.

### A2. Browser renderer worker

Add a `web-render.v1` execution profile to plan 031 and a structured worker
entrypoint in the sandbox image:

```json
{
  "url": "https://example.edu/course",
  "wait": { "kind": "dom-settled", "maxMs": 8000 },
  "maxNavigations": 8,
  "maxRequests": 250,
  "maxResponseBytes": 5242880,
  "capture": ["readable-html", "metadata", "selected-images"]
}
```

Implementation rules:

- Playwright/Chromium runs as an unprivileged process in a disposable sandbox.
- The profile has read-only image/root filesystem, tmpfs scratch, no host
  mounts, no cloud metadata, no node/core administrative credentials and a
  short deadline.
- Resolve/validate the main destination before dispatch and force the sandbox
  through an egress proxy that revalidates DNS for every connection.
- Deny loopback, link-local, private, multicast, reserved and cloud-metadata
  ranges for IPv4 and IPv6; cap redirects, requests, total bytes and origins.
- Block downloads, popups, file/data/blob navigation, WebRTC, WebSocket unless
  explicitly required and separately reviewed, and service workers. Route
  interception must reject subresources that violate the same allow policy.
- Never expose a general remote browser session to the model in this slice.
- Extract a sanitized DOM/readable HTML response and run the same Markdown
  normalization used by static ingestion outside of page script context.
- Record final URL, redirect chain, fetch/render timestamps, strategy, content
  language, page title, site/published metadata and a renderer build digest.
- Do not retain raw HTML by default. A self-host operator may enable bounded
  diagnostic retention with an explicit TTL and warning.

### A3. Inline images and private assets

Plan 028 defines corpus source assets. Implement the ingestion side here:

- Select only images materially referenced by extracted content; do not mirror
  every tracker, icon or responsive variant.
- Revalidate each asset URL, fetch with the same policy, verify magic bytes,
  dimensions and decompression bounds, strip unsafe metadata where appropriate,
  and store through plan 032's `ObjectStorageProvider`.
- Replace remote Markdown URLs with authenticated `asset://<sourceAssetId>`
  references. The Web renderer resolves these to short-lived owned URLs.
- Persist original URL, normalized source locator, MIME, dimensions, byte count,
  digest, storage placement, attribution text and capture state.
- Deduplicate by digest within the user's permitted scope. Never leak whether
  another user already stored the same asset.
- Missing/blocked assets render an explicit placeholder and do not fail an
  otherwise useful text source.
- Generate thumbnails/previews as derived files through a bounded image worker;
  do not proxy arbitrary remote URLs at display time.

### A4. Quality and citation evaluation

Build a fixture suite with:

- static article, JavaScript shell, client-side rendered article, redirect,
  relative image, large image, redirect-to-private-IP, DNS-rebinding simulation,
  infinite network activity, service worker, login wall and unsupported file;
- deterministic snapshots for normalized Markdown and exact locators;
- recall/precision checks for headings, paragraphs, lists, tables and captions;
- a regression showing that browser fallback cannot expand network authority.

Add operator metrics for strategy use, terminal reason, latency, input/output
bytes and renderer saturation. URLs and page text are sensitive: use hashes or
low-cardinality categories, not raw values.

## Slice B — caption-first video and bounded audio fallback

### B1. Keep caption-first selection

Refactor `apps/server/src/lib/youtube.ts` behind a `VideoSourceAdapter` while
keeping its current URL parser, caption fetch policy, chapters and tests.

Selection order:

1. platform captions selected by requested/preferred language;
2. another available caption track with a recorded language mismatch;
3. explicit user request for audio extraction + speech transcription;
4. terminal `captions_unavailable` when no authorized execution placement is
   available.

Never download audio simply to improve a successful caption result unless the
user explicitly requests retranscription.

### B2. Isolated `yt-dlp` worker

Implement a self-host/node opt-in `video-audio-extract.v1` profile:

- Pin the `yt-dlp` binary/package and FFmpeg image by immutable digest. Add
  Dependabot/Renovate or an equivalent monitored update process and a kill
  switch for security advisories.
- The worker receives a validated canonical URL plus structured options only.
  Construct a fixed argument vector in trusted code; never accept model/user
  flags, output templates, postprocessor arguments or configuration files.
- Permit a reviewed provider allowlist at first (YouTube public content).
  `yt-dlp` supporting thousands of sites is not the product's trust boundary.
- Reject playlists/batches in v1, live streams, private/authenticated content,
  age/cookie challenges, DRM, browser-cookie extraction and external downloaders.
- Download the smallest suitable audio stream to bounded scratch, cap advertised
  and observed duration/bytes, transcode to the transcription input contract,
  hash it, dispatch the existing transcription pipeline and purge the temporary
  source after verified commit.
- Treat extractor metadata as untrusted text. Normalize title/channel/chapters
  and cap every field.
- Surface `permission_required`, `extractor_blocked`, `duration_limit`,
  `transcription_unavailable` and `upstream_changed` distinctly.
- Require acceptance of a concise authorized-use notice before enabling the
  fallback. Store acceptance revision/time, not a claim of copyright ownership.
- Hosted Avermate must not enable this capability until plan 034 has abuse,
  network, isolation and quota controls. MCP-only/core-free users retain the
  caption path.

### B3. Provenance and transcript alignment

- Store adapter/extractor and transcript provider/model versions, canonical URL,
  video ID, selected language, chapters, duration and whether content came from
  captions or extracted audio.
- Produce timestamp locators for every transcript chunk so plan 028 citations
  can deep-link to the source time.
- Preserve raw caption timing data in a typed bounded artifact, not embedded
  ad-hoc in Markdown metadata.
- Make retries create source/content revisions. Existing conversations keep the
  exact revision they cited.
- Cache only by `(canonical media ID, source revision/freshness signal,
language, strategy, extractor version, transcription config)` within the
  user's allowed scope.

## Slice C — artifact graph and generated media

### C1. Unify generation around an artifact manifest

Do not create separate top-level product models for every output. Extend the
study-project/artifact model from plan 028 with a typed manifest:

```ts
interface GeneratedArtifactManifestV1 {
  kind:
    | "markdown"
    | "latex-source"
    | "pdf"
    | "slides-source"
    | "pptx"
    | "quiz"
    | "audio"
    | "image"
    | "anki"
    | "html"
    | "video-timeline"
    | "video"
    | "thumbnail";
  artifactId: string;
  artifactRevisionId: string;
  revision: number;
  parentArtifactRevisionIds: string[];
  sourceVersionIds: string[];
  workflow: { id: string; version: number };
  modelRuns: ModelRunReference[];
  renderer: { profile: string; imageDigest: string; toolVersions: object };
  output: { fileId?: string; digest: string; bytes?: number; mime: string };
}
```

- Every new build creates an immutable revision; the project points to a current
  revision but old chats/branches retain `artifactRevisionId` references.
- Every edge in lineage, a timeline, a conversation, a job result or a cache
  points to an immutable `artifactRevisionId` and its verified digest. A mutable
  `artifactId` is allowed only as an identity/current-pointer lookup and never
  as the input of a reproducible render.
- A regeneration may reuse verified stages whose full input/config digests
  match. Never cache solely by a user-visible title or prompt.
- Store source citations at the smallest supported script/slide/quiz segment.
- Model-produced source is untrusted input to deterministic renderers.
- Add compare/promote/archive operations and a provenance view. Destructive
  project operations use plan 030's ledger.

### C2. Pipeline/job graph

Extend the existing durable job substrate with explicit parent/child or workflow
stage metadata instead of one giant job. Minimum states:

`planned → queued → running → awaiting_approval → completed | failed |
cancelled | superseded`.

Each stage emits plan 026 events with:

- stable stage ID/name and attempt;
- processed/total units where knowable;
- bounded human-readable status;
- input/output artifact references;
- usage and placement updates;
- retryable reason and terminal result.

Cancellation propagates to children and sandbox process groups. A cancelled
workflow never publishes partial output as current, but useful completed stages
remain inspectable and reusable. Retry resumes from the first invalid/missing
stage, not automatically from the beginning.

### C3. Deterministic narrated-slide video

Define `video.timeline.v1` before implementing UI or a provider:

```ts
interface ArtifactCitationReferenceV1 {
  contentVersionReferenceId: string;
  sourceVersionId: string;
  chunkId?: string;
  referenceKey: string;
}

interface VideoTimelineV1 {
  width: number;
  height: number;
  fps: number;
  scenes: Array<{
    id: string;
    startMs: number;
    durationMs: number;
    visual: {
      artifactRevisionId: string;
      digest: string;
      pageOrSlide: number;
    };
    narration?: {
      artifactRevisionId: string;
      digest: string;
      clipId: string;
    };
    captions: CaptionCue[];
    transition: "cut" | "crossfade";
    citations: ArtifactCitationReferenceV1[];
  }>;
}
```

Each citation ID must resolve to plan 028's normalized
`contentVersionReferences` row with `ownerKind = "artifact-revision"` and
`ownerId` equal to this timeline's immutable `artifactRevisionId`. Validate the
redundant `sourceVersionId`, optional `chunkId` and `referenceKey` against that
row on write and read; resolve the locator from the normalized row rather than
storing an identity-free `SourceLocator` in the timeline. These durable edges
participate in source-version GC and preserve multi-source historical renders.

Start with a deliberately small renderer contract: 16:9, fixed supported FPS,
cut/crossfade, slide/page visuals, one narration track, normalized loudness and
WebVTT/SRT plus optional burned-in captions. The model generates a schema-
validated script/timeline; trusted code derives FFmpeg arguments and muxes the
assets.

Pipeline:

1. retrieve selected source revisions and freeze the context manifest;
2. generate a cited outline/script;
3. user/agent approval gate when configured;
4. generate or reuse slide/PDF visual revisions;
5. generate narration clips through a `SpeechProvider` adapter or accept a
   user-supplied track;
6. align durations/captions and compile `video.timeline.v1`;
7. render per-scene intermediates in a bounded FFmpeg profile;
8. mux final MP4/WebM, captions and poster frame;
9. inspect technical properties and sample frames;
10. publish only after digest, duration and lineage validation.

Do not “record a browser slideshow” as the canonical implementation; it is
timing-fragile and hard to reproduce. A Web preview may render the same timeline
schema.

### C4. Optional Manim scenes

Manim is a renderer adapter, not a general Python execution feature:

- use a pinned `manim.v1` sandbox image with no network and low privilege;
- v1 accepts a reviewed scene DSL or template parameters, not arbitrary model-
  authored Python;
- if arbitrary Python is later allowed for an advanced self-host profile, mark
  it `untrusted-code`, require the strongest available isolation, show it as
  such and never offer it in the hosted default without separate review;
- output is a normal video clip artifact consumed by the timeline;
- enforce resolution/frame/duration limits and scan output metadata;
- cache by scene schema + asset digests + renderer image digest.

This preserves the ability to create mathematical animations without confusing
the language model with the security boundary.

### C5. Thumbnails and visual review

- Generate a deterministic default poster from a validated timeline frame.
- Optional AI image generation is a `MediaGenerationProvider` adapter and must
  preserve provider/model/prompt revision, policy result and cost. It is not a
  prerequisite for video.
- Never fetch a remote image at render time. All visuals must be owned artifact
  references with verified MIME/dimensions/digests.
- Add a visual-review stage that renders representative frames/pages and checks
  clipping, blank output, text overflow, missing assets and contrast. Automatic
  checks report evidence; an agent may propose a new source revision but cannot
  mutate the published revision in place.
- Human preview/approval remains available before expensive narration/video
  rendering.

### C6. Existing document/podcast migration

- Adapt PPTX, LaTeX/PDF, podcast and generic document exports to the same
  manifest, workflow events, placement and usage contracts without breaking
  current routes.
- Migrate in place with compatibility readers for existing export rows. Do not
  rewrite or discard valid generated files.
- The discriminated union is deliberately a superset of the currently persisted
  `pdf | pptx | audio | image | anki | html` kinds. Add a read/write round-trip
  fixture for every existing and new kind before switching any reader.
- Prove with a regression fixture that promoting/regenerating an artifact does
  not change the bytes, parents, citations or timeline resolved by an older
  `artifactRevisionId`.
- LaTeX package detection/install remains owned by plan 031's resolver and
  immutable image policy.
- Podcast production becomes a simpler audio timeline using the same script,
  speech-provider and citation stages as video.
- Expose read/status operations through plan 027's registry when their owning
  slice is ready. Expose creation, retry, approval, cancellation or publication
  to embedded chat/MCP only after plan 029 is integrated and plan 030 can
  persist/approve/compensate the action. Long-running tools return a run/job
  reference and stream events; they do not hold an MCP request open until
  rendering completes.

## Optional specialist coding workers

OpenCode/OpenHands may later be exposed behind a narrow `SpecialistWorker`
adapter for advanced self-host project transformations. They are not the
artifact orchestrator and cannot receive core/node credentials. Any experiment:

- runs only in plan 031's strongest available code profile;
- receives an exported, scoped project workspace and capability grants;
- returns a patch/artifact manifest for review;
- has no direct database, MCP admin or unrestricted network access;
- is feature-flagged and cannot block the deterministic pipelines above.

## API, tool and UI boundary

This plan implements server/domain/tool contracts and minimal existing-screen
controls needed to exercise them; a dedicated studio redesign is separate.

Add registry operations along these lines:

- `source.ingest({ sourceId, strategy?, language? })`
- `source.retryWithDynamicRenderer({ sourceVersionId })`
- `source.transcribeVideoAudio({ sourceVersionId, consentRevision })`
- `artifact.plan({ projectId, kind, sourceVersionIds, instructions })`
- `artifact.approveStage({ runId, stageId })`
- `artifact.cancel({ runId })`
- `artifact.retry({ runId, fromStage? })`
- `artifact.getManifest({ artifactRevisionId })`

All object IDs resolve through ownership checks. Agent invocations additionally
carry a tool-policy decision and context manifest. MCP scopes distinguish source
read, ingestion dispatch, artifact draft, expensive render and publish.

## Schema and migration outline

Exact names may be adapted after inspecting plans 028–032 implementation, but
the concepts must remain explicit:

- source ingestion revisions/attempts with strategy and terminal reason;
- captured source assets with storage/digest/locator metadata;
- generated artifact identity + immutable revisions + parent edges;
- source-version/citation edges;
- workflow runs/stages/attempts with job IDs and placement;
- typed media timeline/script/caption manifests;
- provider/model/renderer usage references;
- consent/policy revision references for downloader and expensive generation.

Use additive Drizzle migrations and export schemas from
`apps/server/src/db/schema/index.ts`. JSON columns require version discriminants,
Zod read/write validation and compatibility readers. Do not put large Markdown,
HTML, images, media or logs in SQLite when a file/object reference suffices.

## Delivery sequence

1. Extract ingestion strategy/error contracts without behavior change.
2. Add source assets and exact-locator persistence from plan 028.
3. Implement and security-test the sandboxed browser renderer.
4. Ship manual dynamic retry, then consider opt-in automatic fallback.
5. Introduce `VideoSourceAdapter` while preserving current captions.
6. Implement self-host/node-only audio extraction and transcript alignment.
7. Add immutable generated-artifact manifests and workflow stages.
8. Migrate current PDF/PPTX/audio/image/Anki/HTML and LaTeX/podcast outputs to
   the shared contracts, with compatibility round-trips.
9. Ship narrated-slide timeline generation and deterministic FFmpeg renderer.
10. Add thumbnails/visual review, then optional Manim and image generation.
11. Enable embedded/MCP write tools only after 029/030; enable managed
    placements only after plan 034's isolation/quota gates.

Each numbered delivery is independently deployable and has a kill switch. Do
not hold the safer static/caption ingestion release for generated video.

## Verification

### Required repository entrypoints

As part of this plan, add the following stable scripts to the root
`package.json`; each script calls a checked-in TypeScript runner under
`scripts/verification/` so glob/shell behavior is identical on Windows and CI:

```text
bun run verify:033:contracts
bun run verify:033:ingestion
bun run verify:033:artifacts
bun run verify:033:sandbox
bun run verify:033
```

- `verify:033:contracts` runs schema, compatibility-reader, immutable-edge and
  registry-policy tests.
- `verify:033:ingestion` starts the checked-in malicious/static/dynamic fixture
  server on an ephemeral port and runs static, Playwright and video-adapter
  integration tests.
- `verify:033:artifacts` builds the tiny deterministic PDF/PPTX/audio/image/
  Anki/HTML/video fixtures and verifies their manifests and historical digests.
- `verify:033:sandbox` invokes the exact command below against a disposable
  runtime:

  ```text
  bun run --cwd apps/server sandbox:conformance -- --profile web-render.v1 --profile video-audio-extract.v1 --profile ffmpeg-render.v1
  ```

  When `manimRendering` is enabled in the tested build, append `--profile
manim.v1` and make its conformance mandatory before activation; disabled
  optional Manim is not a failed or silently skipped required profile.

- `verify:033` runs the four commands above and fails if a required or enabled
  sandbox job is skipped. Add `.github/workflows/plan-033-media.yml` to execute
  it on the pinned container/runtime runner and upload only non-sensitive test
  evidence.

The TypeScript runner must terminate child processes, delete fixtures/scratch
in `finally`, use no developer credentials and return non-zero on a missing
binary, skipped required profile or incompatible historical fixture.

### Automated

- Unit tests for strategy selection, reason codes, URL/IP policy, redirect and
  subresource validation, limits and structured worker arguments.
- Integration tests against disposable static/dynamic/malicious fixture sites.
- Sandbox conformance tests from plan 031, including no credential/filesystem
  escape, termination and egress denial.
- Golden transcript/locator tests for captions and extracted-audio fallback.
- Job tests for cancellation, duplicate delivery, retry, stage reuse, stale-run
  fencing and publish-after-commit only.
- Artifact graph tests for immutable revision references and source lineage;
  reject mutable `artifactId` edges in parents, visuals and narration.
- Timeline citation round-trips reject raw identity-free locators and mismatched
  source/chunk/reference keys; historical resolution and GC retain every cited
  content version until the owning artifact revision is purged.
- Compatibility round-trips for every existing
  `pdf | pptx | audio | image | anki | html` row plus every new kind, and a
  golden historical timeline that stays byte-identical after a later promotion.
- Deterministic tiny fixtures for PPTX/PDF/audio/video; assert MIME, digest,
  resolution, duration, stream layout, captions and representative frames.
- Quota/usage events are asserted even on cancelled and failed stages.
- MCP/embedded registry contract tests prove the same schemas and policy gates;
  write-capable cases must prove plan 030 action IDs and approval decisions are
  present before dispatch.

Run the repository's baseline gates from plan 025 plus image-specific tests in
CI where Docker/runtime support exists. Mark isolation tests skipped only with a
machine-readable reason and run them in a required dedicated job before release.

### Manual

1. Ingest a static article and confirm no browser worker is used.
2. Ingest a JavaScript-only public course page, choose dynamic retry, inspect its
   captured image and exact citation, then disconnect the node and confirm an
   explicit unavailable state rather than 404.
3. Add a captioned YouTube video and confirm no audio download occurs.
4. On a self-host node, explicitly authorize a public captionless test video,
   observe extraction/transcription progress, cancel once, retry, and verify
   scratch cleanup.
5. Generate a cited PPTX and podcast, then a narrated-slide video; inspect the
   lineage graph and source deep links.
6. Edit the script in a branch and confirm the original output and conversation
   references remain unchanged.
7. Kill/restart the worker during FFmpeg and prove the durable workflow resumes
   or fails safely without publishing a corrupt artifact.

## Rollout and kill switches

Independent flags/capabilities:

- `dynamicWebRendering`
- `videoAudioExtraction`
- `mediaTimelineRendering`
- `manimRendering`
- `generatedThumbnails`

Routing checks capability + placement + policy at dispatch time; hiding a Web
button is not a security control. Disabling a flag prevents new runs while
leaving existing sources/artifacts readable/exportable. Publish per-capability
health and queue saturation without exposing private source names.

## STOP conditions

- Stop dynamic rendering if subrequests cannot be forced through a network
  policy that revalidates destinations independently of Playwright.
- Stop downloader work if it requires cookies, credentials, DRM bypass,
  unrestricted providers or user/model-supplied arguments.
- Stop hosted execution if the selected isolation profile is `runc`/development
  only or if quotas/cancellation cannot terminate descendants reliably.
- Stop video publication if artifact lineage, exact source revisions, output
  validation or partial-output fencing is missing.
- Stop enabling an expensive provider if plan 034 cannot meter it atomically or
  the configured fallback could charge the operator without user consent.

## Definition of done

- Static/caption-first behavior and existing data remain compatible.
- Dynamic pages can be ingested through an isolated, bounded, auditable worker
  with owned inline assets and exact locators.
- A self-host/node user can opt into bounded audio extraction when captions are
  absent; hosted availability is independently gated.
- Existing and new generated outputs share immutable, cited lineage and durable
  stage progress.
- Every old artifact kind has a lossless compatibility round-trip, and every
  parent/timeline/narration edge resolves an immutable revision plus digest.
- Narrated-slide video is reproducible from a versioned timeline and rendered by
  trusted FFmpeg code; Manim is an optional isolated adapter.
- Every pipeline supports cancel/retry, explicit placement, usage accounting,
  capability kill switches and cleanup.
- No general shell, downloader, browser or code-execution surface is exposed to
  the core, Web client, MCP client or model.
- `bun run verify:033` passes on the required isolated CI runner; no mandatory
  sandbox/security test is silently skipped.
