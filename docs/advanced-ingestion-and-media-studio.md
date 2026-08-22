# Advanced ingestion and media studio (Plan 033)

## Shipped boundary

Plan 033 defines the stable contracts, persistence, policies and dispatch
boundaries for advanced source ingestion and generated media. It does **not**
install or silently execute Playwright, yt-dlp, FFmpeg or Manim in the API
process.

The default deployment truth is:

- static public HTML ingestion works in Core through the existing bounded HTTP
  fetcher and Readability extraction;
- public YouTube platform captions work in Core and preserve timestamp ranges;
- dynamic browser rendering is unavailable until an attested `browser` sandbox
  placement is injected;
- video audio extraction is unavailable until a Node/self-host `media` sandbox,
  YouTube-only revalidating egress, explicit user consent and quotas are all
  present;
- FFmpeg/Manim rendering is unavailable until conforming `media`/`manim`
  sandbox profiles are provisioned;
- legacy PDF preview, LaTeX compilation and uploaded-media segmentation jobs
  fail closed until their `latex`/`media` broker workers are provisioned; they
  do not execute native binaries inside the API process;
- hosted audio extraction remains disabled by Plan 033 even if a caller attempts
  to set a local feature flag.

Capability discovery and the Web UI report those states as unavailable; they do
not simulate success with a mock runtime.

## Source ingestion contract

Every attempt has a `source_ingestion_revisions` row with an explicit strategy:
`static-html`, `browser-render`, `pdf` or `youtube`. The revision records its
policy reference, bounded settings, job/action reference, final URL, result
digest, safe diagnostics and a stable reason code. Existing material transcript
rows remain the presentation/read model; the revision ledger is the execution
and provenance record.

Stable failure reasons include:

- `dynamic_required` / `static_empty` — a user may explicitly request the
  browser strategy;
- `blocked_destination` — URL, DNS or runtime egress policy rejected the target;
- `authentication_required` / `publisher_denied` — private or denied content is
  not bypassed;
- `captions_unavailable` — platform captions were absent;
- `permission_required` — audio fallback was requested without the current
  authorized-use notice;
- `placement_unavailable` / `capability_disabled` — the required conforming
  runtime is not available;
- `content_too_large`, `duration_limit`, `request_limit` — a hard resource bound
  was reached.

Raw provider errors and URLs are not used as public status codes.

## URL and asset threat model

`PublicIngestionUrlPolicy` accepts HTTP(S) only, rejects credentials and
non-public destinations, and re-resolves DNS on every authorization. Browser
workers must additionally attest that egress is enforced at connection time;
API-side DNS validation is not treated as a bearer capability.

Browser sessions bound navigation, requests, origins, response bytes and wall
time. Redirects and the final URL are validated again when adopting a worker
result. Page JavaScript never directly authors stored Markdown: the trusted API
normalizes the worker's readable HTML.

Only images referenced inside Readability's selected article subtree are
eligible for capture. The asset transport must declare
`revalidating-egress`; there is no native-fetch fallback. Captured bytes are
bounded, checked by magic bytes, decoded with pixel/edge limits, metadata-stripped
to WebP, content-addressed, then written through the injected
`ObjectStorageProvider`. Stored Markdown uses private `asset://<asset-id>`
references rather than remote hotlinks or signed URLs.

## Captions-first video policy

`VideoSourceAdapter` selects an exact requested caption language, then its base
language, then an explicitly reported fallback. The selected language and
mismatch are persisted in diagnostics. Timestamp segments remain exact source
locators.

Audio extraction is a separate opt-in branch. It requires the current
`video-audio-extraction.v1` notice, a Node/self-host placement, an enabled
Plan-031 `media` profile and runtime-enforced YouTube-only egress. Playlists,
live streams, cookies, authenticated/private videos, DRM bypass and arbitrary
extractor flags are outside the contract. A reviewed worker receives structured
JSON and constructs fixed yt-dlp/FFmpeg argument vectors; the API never launches
them.

The reviewed `video-audio-extract.v1` worker and its exact dispatch tuple now
exist, but no checked-in provider/image activation makes the feature available.
The runtime must bind the manifest's egress-policy digest to connection-time
YouTube-only DNS/redirect enforcement; a container with generic network access
is deliberately insufficient. The same activation boundary applies to
`browser-capture.v1` for dynamic pages.

## Immutable artifact graph

`generated_artifacts` is a mutable identity/current pointer. Reproducible edges
always use `generated_artifact_revisions` IDs. Each revision carries a canonical
manifest and digest with:

- exact parent artifact revision IDs and corpus source version IDs;
- workflow ID/version and referenced model runs;
- renderer profile, optional verified image digest and tool versions;
- exact output file reference, SHA-256, byte size and MIME type.

Historical `document_artifacts` kinds (`pdf`, `pptx`, `audio`, `image`, `anki`,
`html`) are read through a compatibility manifest. It preserves the verified
historical output digest but reports `best-effort` reproducibility and a null
image digest instead of inventing provenance.

Migration `0059_old_tigra` enforces immutable revision/edge/timeline updates,
same-owner parent/source edges, an acyclic parent graph, exact current-pointer
ownership/kind/readiness and video-timeline ownership. Publication and pointer
promotion are separate; promotion uses an optimistic identity revision fence.

## Workflow and timeline

Artifact workflows persist runs, ordered stages and attempts. Stage input
digests make reuse exact. Cancellation is cooperative: queued/planned work is
cancelled immediately, running durable jobs receive a cancellation request, and
already published immutable revisions remain available. Retry is bounded and
does not turn an unavailable placement into a fake queued job.

`video.timeline.v1` is a gap-free 1920×1080 timeline. Visual and narration
inputs reference exact artifact revisions and output digests. Citation entries
must resolve to exact Plan-028 `content_version_references` owned by the timeline
revision. SRT/VTT output and FFmpeg arguments are deterministic structured
worker inputs. The optional Manim path accepts a small reviewed data DSL; it
never accepts Python or arbitrary code from an API caller.

## Agent, MCP and undo truth

Reads (`source.ingestion_status`, `artifact.list`, `artifact.get_manifest`,
`artifact.workflow`) share the first-party registry across assistant and MCP
surfaces. Artifact plan, cancel, retry, promotion and lifecycle writes all pass
through the Plan-030 broker and durable action ledger. High-impact job
cancel/retry requests always require approval. These writes declare no automatic
compensation: immutable revisions and external work cannot honestly promise a
general undo. The ledger remains the inspection/audit source.

## Operations and verification

Run the stable gate:

```sh
bun run verify:033
```

Sub-gates are `verify:033:contracts`, `verify:033:ingestion`,
`verify:033:artifacts` and `verify:033:sandbox`. The sandbox gate statically
rejects active process execution/imports across the complete non-test server
runtime and checks the reviewed 0059 invariants. Mock/disabled tests prove
fail-closed behavior; they are not evidence that a real
Playwright/yt-dlp/FFmpeg/Manim/LaTeX runtime passed.

Before enabling a real placement, operators must separately record:

1. the Plan-031 sandbox conformance result and pinned image digest;
2. runtime DNS/redirect egress enforcement evidence;
3. storage-provider conformance and output adoption fences;
4. resource quotas, cancellation and crash-recovery tests;
5. provider-specific authorized-use/legal review;
6. real fixture results labelled with the exact worker/image/tool versions.
