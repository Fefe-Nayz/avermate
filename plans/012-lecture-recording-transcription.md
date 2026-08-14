# Plan 012: Record lectures and transcribe them — capture, segmented upload, transcription jobs

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat 46c966b..HEAD -- apps/server/src/db/schema apps/server/src/lib apps/server/src/jobs apps/mobile/app.json apps/mobile/app apps/web/src docs/materials-storage.md docs/ai-architecture.md`
> REQUIRES plans 001 (files), 002 (jobs), 005 (materials + storage decision)
> and 007 (key policy ADR) DONE — verify their Done criteria first. On
> excerpt mismatch, STOP.

## Status

- **Priority**: P3 (last of wave 2 — hardest, most dependencies)
- **Effort**: XL (two phases; each independently shippable)
- **Risk**: HIGH (native permissions + prebuild, large uploads, provider limits)
- **Depends on**: plans/001, 002, 005, 007 (hard); 003 for MCP; 009 (soft — artifact conventions)
- **Category**: direction
- **Planned at**: commit `46c966b`, 2026-08-14

## Why this matters

The named killer feature: record the lecture, get a searchable transcript,
and let agents use it as course content when a chapter was missed or a PDF
never existed. Everything hard about it is environmental: the mobile
microphone is explicitly disabled today, hour-long recordings exceed the
upload transport sized for documents, and transcription providers cap input
size — so this plan (a) does the permissions/prebuild wave, (b) sidesteps
both size ceilings with ONE design decision — segment at capture — and (c)
runs transcription as plan-002 jobs behind a provider seam per the plan-007
key policy (operator env key now, BYOK later).

**The load-bearing design decision — segment at capture.** Recorders emit
~10-minute segments (each ≈5–8 MB of AAC/Opus), uploaded as they complete.
Consequences: uploads stay inside the plan-005 transport limits (no presign
migration required to ship), transcription providers receive files under
their size caps (no server-side ffmpeg — the Bun image has none), a crash
loses at most one segment, and transcript timestamps are
`segment.startOffset + provider timestamps`. The recording entity stitches
segments logically; nothing ever concatenates audio bytes server-side.

## Current state

- **Mobile audio**: `expo-audio` is installed and configured as a plugin in
  `apps/mobile/app.json`, but used playback-only (`useAudioPlayer` in
  `components/review/year-review-story.tsx`). Microphone is OFF:
  `app.json:57` sets `"microphonePermission": false` in the
  `expo-image-picker` plugin block, and no `NSMicrophoneUsageDescription` /
  `RECORD_AUDIO` exists anywhere. Recording therefore needs config-plugin
  changes + `npx expo prebuild` + real-device testing — CI only runs
  `bunx expo export --platform all` (bundle check), which will NOT catch
  permission mistakes.
- **Web capture**: no recording code exists; `MediaRecorder` with
  `audio/webm;codecs=opus` is the baseline (feature-detect; Safari fallback
  `audio/mp4`).
- Plan 001: `files` + `FILE_CONSTRAINTS` per purpose; plan 005 decided the
  upload transport and recorded it in `docs/materials-storage.md` with the
  explicit revisit trigger "lecture audio forces presign" — this plan's
  segmentation KEEPS the decided transport; do not reopen it.
- Plan 002: job substrate (`registerJobHandler`, idempotent `enqueueJob`,
  retries/backoff, `jobs` router for polling). Plan 002's lease is 60s;
  transcribing one ~10-min segment must fit or renew — see Step 5.
- Plan 007 ADR: operator-configured provider keys with `DISABLE_*` hatches;
  no per-user BYOK in wave 2.
- Plan 009 (if DONE): `materialArtifacts` typed-JSON artifact convention —
  transcripts REUSE the pattern but live on their own tables (below), because
  segments and timestamps don't fit the 1-artifact-per-document shape.
- Conventions: schema spreads, `newId`, `requireX`, `goals.ts` router shape,
  feature-scoped read models, `nav`/forms/i18n patterns — as in plans 004/005.

## Commands you will need

| Purpose | Command | Expected |
|---------|---------|----------|
| Migration | `bun run db:generate` && `bun run db:migrate` | exit 0 |
| Tests | `bun run --cwd apps/server test` | exit 0 |
| Expo bundles | `bunx expo export --platform all` (from `apps/mobile`) | exit 0 |
| Full gate | `bun run format:check && bun run lint && bun run check-types && bun run test && bun run build` | exit 0 |

## Scope

**In scope**:
- `apps/server/src/db/schema/recordings.ts` (create: `lectureRecordings`, `recordingSegments`, `recordingTranscripts`) + export + migration
- `apps/server/src/lib/storage.ts` (add purpose `lecture-audio-segment`: 32 MiB, `["audio/mp4","audio/m4a","audio/webm","audio/ogg"]`)
- `apps/server/src/lib/transcription.ts` (create: provider seam + one implementation) + env (`TRANSCRIPTION_PROVIDER`, `TRANSCRIPTION_API_KEY`, `DISABLE_TRANSCRIPTION`)
- `apps/server/src/jobs/handlers.ts` (register `transcribe.segment`, `transcribe.finalize`)
- `apps/server/src/routers/recordings.ts` (create) + `routers/index.ts` + `requireRecording` in `lib/ownership.ts`
- Tests: `transcription.test.ts`, `recordings.test.ts`
- `apps/mobile/app.json` (mic permission strings + `UIBackgroundModes: ["audio"]`) and `apps/mobile/app/recordings/**` (recorder + list + player screens)
- `apps/web/src/**` recorder + recording views inside the materials space
- MCP (if 003): read tools `recordings.list`, `recordings.transcript`
- `docs/ai-architecture.md` — no edits; cited only

**Out of scope**:
- Server-side audio processing of ANY kind (no ffmpeg, no concatenation, no
  loudness work — the segment decision exists to avoid it).
- Speaker diarization, summaries, translation (post-transcript AI features —
  ADR triggers apply).
- Search over transcripts (the search roadmap item consumes
  `recordingTranscripts.text`).
- Webcam/video capture (explicitly future per the maintainer).
- Per-user BYOK keys (ADR wave-2 policy is operator keys).
- Android home-screen/lock-screen recording widgets.

## Git workflow

- Branch: `advisor/012-lecture-recording`; conventional commits per phase
  (`feat(mobile): lecture recorder`, `feat(server): transcription jobs`).
- Do NOT push or open a PR unless instructed.

## Steps — Phase A: capture & upload (shippable alone)

### Step 1: Schema

`apps/server/src/db/schema/recordings.ts`:

```ts
export const lectureRecordings = sqliteTable("lecture_recordings", {
  id: text().notNull().primaryKey().$defaultFn(() => newId("rec")),
  title: text().notNull(),
  status: text().$type<"recording" | "uploaded" | "transcribing" | "ready" | "failed">().notNull().default("recording"),
  recordedAt: integer({ mode: "timestamp" }).notNull(),
  durationMs: integer().notNull().default(0),          // sum of segment durations
  subjectId: text().references(() => subjects.id, { onDelete: "set null", onUpdate: "cascade" }),
  folderId: text().references(() => materialFolders.id, { onDelete: "set null", onUpdate: "cascade" }),
  yearId: text().notNull().references(() => years.id, { onDelete: "cascade", onUpdate: "cascade" }),
  userId: owner(),
  ...timestamps,
}, (t) => [index("lecture_recordings_year_idx").on(t.yearId)]);

export const recordingSegments = sqliteTable("recording_segments", {
  id: text().notNull().primaryKey().$defaultFn(() => newId("rseg")),
  recordingId: text().notNull().references(() => lectureRecordings.id, { onDelete: "cascade", onUpdate: "cascade" }),
  seq: integer().notNull(),                             // 0-based capture order
  fileId: text().notNull().references(() => files.id, { onDelete: "restrict", onUpdate: "cascade" }),
  startOffsetMs: integer().notNull(),                   // sum of prior durations
  durationMs: integer().notNull(),
  transcriptStatus: text().$type<"pending" | "ready" | "failed">().notNull().default("pending"),
  userId: owner(),
  ...timestamps,
}, (t) => [uniqueIndex("recording_segments_rec_seq_unique").on(t.recordingId, t.seq)]);

export const recordingTranscripts = sqliteTable("recording_transcripts", {
  recordingId: text().notNull().primaryKey().references(() => lectureRecordings.id, { onDelete: "cascade", onUpdate: "cascade" }),
  /** Plain text, paragraph per segment-window; the search corpus. */
  text: text().notNull(),
  /** [{ startMs, endMs, text }] — player deep-links. Typed-JSON + version per repo convention. */
  segmentsVersion: integer().notNull().default(1),
  segmentsJson: text({ mode: "json" }).$type<TranscriptSegmentV1[]>().notNull(),
  language: text(),
  provider: text().notNull(),
  userId: owner(),
  ...timestamps,
});
```

**Verify**: migration + `bun run check-types` exit 0.

### Step 2: Recordings router (capture protocol)

`routers/recordings.ts`: `start({ yearId, title, subjectId?, folderId? })` →
row `status:"recording"`; `appendSegment({ recordingId, seq, durationMs, file: z.instanceof(File) })`
→ `requireRecording`, `storeFile({ purpose: "lecture-audio-segment" })`,
insert segment with `startOffsetMs` = sum of prior durations, bump
`durationMs`; unique `(recordingId, seq)` makes client retries idempotent
(`onConflictDoNothing` + return existing); `finish({ recordingId })` →
`status:"uploaded"`; `list`/`get`/`delete` (delete also `deleteFile`s every
segment file, mirroring plan 006's grade-delete cleanup). Cap: 24 segments
per recording (4h) → `badRequest` beyond.

**Verify**: `recordings.test.ts` (in-memory bootstrap): protocol happy path,
retry idempotency on `(recordingId, seq)`, offset arithmetic, delete cleanup,
ownership isolation, segment cap.

### Step 3: Mobile recorder

`apps/mobile/app.json`: in the `expo-audio` plugin block set the mic
permission string ("Avermate enregistre le cours pour le transcrire.") — and
REMOVE nothing else; leave `expo-image-picker`'s `microphonePermission:false`
alone (it scopes the picker, not audio). Add `ios.infoPlist.UIBackgroundModes:
["audio"]` so recording survives the screen locking. Note in the PR that a
real prebuild + on-device test is REQUIRED and CI cannot prove it.

`apps/mobile/app/recordings/record.tsx`: `expo-audio`'s recorder
(`useAudioRecorder` + `AudioModule.requestRecordingPermissionsAsync()` —
verify exact SDK 57 API in `node_modules/expo-audio` typings and STOP on
mismatch), AAC ~64 kbps mono; auto-stop/restart every 10 minutes emitting a
segment, upload each via `recordings.appendSegment` with retry; big
elapsed-time display, segment counter, pause/finish. List + player screens
(`useAudioPlayer`) under `apps/mobile/app/recordings/`, entry from the
dashboard (no sixth tab). Strings in `lib/i18n.ts` (fr included).

**Verify**: `bun run check-types` exit 0; `bunx expo export --platform all`
exit 0; on-device smoke documented as a release gate in the PR text.

### Step 4: Web recorder

`MediaRecorder` behind feature detection (`audio/webm;codecs=opus`, Safari
`audio/mp4` fallback; `start(600_000)`-style timeslice for 10-min chunks —
each `dataavailable` blob becomes a segment upload), same protocol, in the
materials space ("Enregistrer un cours" action) plus list/player using
`<audio>` per segment with offset-aware seek. en/fr messages.

**Verify**: manual: record 2 short segments (dev override making segments
15s), reload, both listed, playback seeks across the boundary.

## Steps — Phase B: transcription

### Step 5: Provider seam + jobs

`lib/transcription.ts`:

```ts
export interface TranscriptionProvider {
  id: "mistral" | "openai";
  /** Segment audio in, timestamped text out. Throws on over-limit input. */
  transcribeSegment(input: { blob: Blob; mimeType: string; language?: string }):
    Promise<{ text: string; segments: { startMs: number; endMs: number; text: string }[]; language?: string }>;
}
```

Implement ONE provider first, selected by `env.TRANSCRIPTION_PROVIDER`
(default `"mistral"`), key from `env.TRANSCRIPTION_API_KEY`,
`DISABLE_TRANSCRIPTION` hatch, retry/backoff exactly like `lib/ocr.ts`.
**Verification-first**: before coding the client, read the provider's current
audio-transcription API contract (Mistral Voxtral / OpenAI
`audio/transcriptions`) from the operator-supplied docs or a live probe with
the operator's key, and record endpoint + limits in the module header; STOP
if neither contract can be confirmed — do not guess request shapes.

Jobs: `transcribe.segment` (payload `{ segmentId }`, idempotency
`segmentId`; fetch segment file bytes, call provider, store per-segment
result in the segment row's own transient columns? NO — keep results in the
job `result` and the `transcriptStatus` flag) then `transcribe.finalize`
(payload `{ recordingId }`, enqueued by `recordings.transcribe` AFTER all
segment jobs; re-enqueues itself +60s while segments are pending — bounded by
24 attempts): assembles `recordingTranscripts` by concatenating segment
results with `startOffsetMs` added to every timestamp, sets recording
`status:"ready"` (or `"failed"` listing failed seq numbers). One 10-min
segment must transcribe inside plan 002's 60s lease — verify with a real
segment; if typical latency exceeds it, implement the lease-renewal note from
plan 002's handler contract (heartbeat update of `lockedUntil`) and record it.

`recordings.transcribe({ recordingId })` procedure: guards
(`uploaded` status, transcription enabled), enqueues one `transcribe.segment`
per pending segment + the finalize job, sets `status:"transcribing"`.

**Verify**: `transcription.test.ts` with stubbed fetch: provider contract
happy path + over-limit error; job tests: 2-segment recording assembles
offsets correctly (segment 2's timestamps shifted by segment 1's duration),
partial failure marks `failed` with seq list, finalize re-enqueue loop
bounded.

### Step 6: Transcript UI + MCP

Web/mobile recording view gains a transcript pane: paragraphs with
`mm:ss` markers; clicking seeks the player (web) / scrolls (mobile v1). MCP
(if 003): `recordings.list` + `recordings.transcript` on the materials read
surface — transcripts join OCR artifacts as agent-readable course content
(harness + `docs/mcp.md` updated).

**Verify**: full server suite exit 0; manual end-to-end with a real key on a
short recording.

### Step 7: Full gate

**Verify**: all root gates exit 0; `bunx expo export --platform all` exit 0.

## Test plan

Steps 2/5 carry the substance (protocol idempotency, offset math, assembly,
bounded finalize; all in-memory, zero network). Native capture is a
documented on-device release gate, not a CI claim.

## Done criteria

- [ ] Three tables migrate; segment protocol test-proven (idempotent retries, offsets)
- [ ] Mic permission + background audio configured; `grep -n "NSMicrophoneUsageDescription\|UIBackgroundModes" apps/mobile/app.json` → matches (via plugin config)
- [ ] Mobile + web recorders emit ~10-min segments through `appendSegment`
- [ ] Provider seam behind env (`TRANSCRIPTION_PROVIDER/API_KEY`, `DISABLE_TRANSCRIPTION`); contract recorded in module header
- [ ] Transcript assembly shifts timestamps by segment offsets (test-proven); recording status machine reaches `ready`/`failed`
- [ ] MCP read tools registered (if 003); harness green
- [ ] All root gates + Expo export exit 0; `git status` clean outside scope; `plans/README.md` updated

## STOP conditions

- Plans 001/002/005/007 not actually DONE.
- The expo-audio SDK 57 recording API does not match the typings check in
  Step 3 (API drift — capture the real API and report).
- Provider contract unverifiable (no key, no docs) — Phase A still ships;
  mark Phase B BLOCKED in `plans/README.md`.
- A 10-min segment exceeds the provider's size cap at the chosen bitrate —
  shorten segments (config const) rather than adding server-side audio
  processing; if even 5-min segments exceed it, STOP.
- Transcription latency structurally exceeds the job lease and lease renewal
  is not in plan 002's shipped contract — report before hand-rolling one.

## Maintenance notes

- Search (roadmap) indexes `recordingTranscripts.text`; summaries/chaptering
  are post-ADR AI features that would first accept inference cost — that
  event is an ADR revisit trigger.
- BYOK lands by inserting a per-user key lookup in `lib/transcription.ts`
  (same seam as `lib/ocr.ts`).
- The camera/document-scan wave (plan 006 notes) should ride the SAME
  prebuild as this plan's mic permissions — coordinate the release.
- Reviewer attention: segment retry idempotency under flaky mobile networks,
  delete cleanup of all segment files, and that no code path ever
  concatenates audio server-side.
