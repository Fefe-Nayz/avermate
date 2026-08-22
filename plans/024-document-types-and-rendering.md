# Plan 024: What a document _is_, and how far the renderer goes

> **The ask**, across two conversations: support video and audio; add quizzes,
> Anki cards, generated videos, audio podcasts, presentations and infographics;
> render Mermaid and LaTeX; and get the Markdown renderer "roughly as powerful
> as Markdown Preview Enhanced".
>
> **The one structural claim in this document**: that list mixes two things that
> must not share a model — _document types_, which have an identity and are read
> and edited, and _derived artifacts_, which are generated from a document and go
> stale the moment it changes. Conflating them is how a study app ends up as a
> folder of exports nobody trusts. The codebase already has the right pattern for
> the second kind, in `study_document_builds`; it just needs generalising.

## Status

- **Execution**: DONE (2026-08-21), except generated video which §6 deliberately rejects
- **Priority**: §1 and §2 are P1 and unlock the rest. §3–§5 are P2. §6 is a cut.
- **Depends on**: plan 020 §6 (renderer registry, built), plan 022 (ingestion)
- **Written at**: 2026-08-21, branch `rewrite`

---

## 0. Where things stand

Verified in the code rather than remembered:

- **Uploads**: 18 extensions, 50 MiB, from `COURSE_MATERIAL_EXTENSION_MIME_TYPES`
  (`lib/storage.ts`) — PDF, PNG/JPEG/WebP, txt/md/csv, the six Microsoft formats,
  the three OpenDocument ones. **No audio, no video.**
- **Our own kinds**: `study_documents.kind` = `fiche | note | mindmap | slides |
latex`, plus `lecture_recordings`.
- **Markdown pipeline**: `remark-gfm`, `remark-math` + `rehype-katex`, and the
  house `remarkCallouts` (`DEF/THM/METH/PIEGE/CHECK`). **Maths already work.**
  No Mermaid, no syntax highlighting, no heading anchors.
- **Renderers**: ten, resolved by priority in `materials/renderers/`.
- **Derived output today**: `study_document_builds` (LaTeX → PDF, with
  `revision`, `status`, `log`, `pdfFileId`) and a PPTX export path.

---

## §1 — Documents and artifacts are different things

### The distinction

|                         | Document type                                           | Derived artifact                                                           |
| ----------------------- | ------------------------------------------------------- | -------------------------------------------------------------------------- |
| Examples                | fiche, note, mindmap, slides, latex, **quiz**, notebook | PDF, PPTX, **podcast audio**, **Anki deck**, poster image, standalone HTML |
| Has its own identity    | yes — it is a row in the tree                           | no — it belongs to a document                                              |
| Edited                  | yes                                                     | never; regenerated                                                         |
| When the source changes | it _is_ the change                                      | it becomes stale and must say so                                           |

A podcast generated from a fiche is not a document. It is a rendering of one, at
a revision, and the only honest thing it can do when the fiche moves on is admit
it is out of date.

### The table

`study_document_builds` is already this table for exactly one artifact kind.
Generalise it rather than adding four siblings:

```ts
export type DocumentArtifactKind =
  | "pdf" // from LaTeX today; from any document later
  | "pptx" // the existing slides export
  | "audio" // narration / podcast
  | "image" // a poster or a single rendered figure
  | "anki" // a deck file
  | "html"; // a self-contained export

export const documentArtifacts = sqliteTable(
  "document_artifacts",
  {
    id: text()
      .primaryKey()
      .$defaultFn(() => newId("dart")),
    documentId: text()
      .notNull()
      .references(() => studyDocuments.id, { onDelete: "cascade" }),
    kind: text().$type<DocumentArtifactKind>().notNull(),
    /** The revision this was built from. Stale is `document.revision > this`. */
    sourceRevision: integer().notNull(),
    status: text()
      .$type<"queued" | "running" | "succeeded" | "failed">()
      .notNull(),
    fileId: text().references(() => files.id, { onDelete: "set null" }),
    /** The generator's own words when it failed; never a rephrasing of them. */
    log: text(),
    userId: owner(),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("document_artifacts_unique").on(
      t.documentId,
      t.kind,
      t.sourceRevision,
    ),
    index("document_artifacts_document_idx").on(t.documentId),
  ],
);
```

`study_document_builds` migrates in as `kind: "pdf"`. The unique index is what
makes a rebuild idempotent — the LaTeX router already relies on that behaviour.

### What the UI owes

One control, everywhere, and never a file in the tree: an **Exports** strip on
the document pane listing each artifact with its state — _à jour_, _périmé
(révision 4 sur 7)_, _échec_ — and a regenerate button. A stale artifact is
shown and labelled, never hidden and never silently rebuilt.

**Done when**: no generated file appears as a row in the browser, and every one
of them can say whether it still matches its source.

---

## §2 — The Markdown renderer, MPE-class

### What does not transfer

Markdown Preview Enhanced is a preview for a local editor. Two of its pillars
assume that:

- **Code execution** — your machine, your code, your risk. Here it would be
  remote code execution offered as a feature. Reinterpreted in §3.
- **`@import` of filesystem paths** — meaningless in a hosted tree, and
  reinterpreted below as transclusion by document id.

Everything else transfers, and most of it is a plugin.

### The target pipeline

```
remark-gfm ✓        remark-math ✓        remarkCallouts ✓
rehype-katex ✓
+ rehype-slug + rehype-autolink-headings + remark-toc     ← anchors and [TOC]
+ @shikijs/rehype                                         ← highlighting
+ remarkDirectiveBlocks                                   ← the fences below
```

One custom transform turns fenced blocks into components:

| Fence             | Renders with         | Weight  |
| ----------------- | -------------------- | ------- |
| ` ```mermaid `    | `mermaid`            | ~500 KB |
| ` ```vega-lite `  | `vega-embed`         | ~800 KB |
| ` ```dot `        | `@viz-js/viz` (WASM) | ~1.5 MB |
| ` ```python run ` | Pyodide worker (§3)  | ~10 MB  |

**The rule that makes this affordable**: every one of them is imported only when
a document actually contains that fence. A fiche with no diagram must not pay a
byte. This is not an optimisation — a renderer that loads 13 MB to show a
paragraph is a renderer nobody waits for.

**PlantUML is deliberately excluded.** It is the only one needing a JVM on the
server, and Mermaid covers the same ground.

### Transclusion

MPE's `@import "chapter.md"` becomes, here, a reference into the tree:

```md
@import "fiche:doc_7fk2..." <!-- the whole document -->
@import "fiche:doc_7fk2#Récurrence" <!-- one section -->
```

Resolved server-side during render, with three rules: ownership checked per
import, a depth cap of 3, and cycle detection — a fiche importing itself must
produce a message, not a hang.

This is more useful than the original: composing a revision sheet from three
existing ones is a real study gesture, and importing a file path is not.

### Front matter

Adopted for **metadata**, not configuration: `title`, `tags`, `subject`. Tags
wire straight into the tag system built in plan 020 §2. MPE's per-document
engine and theme settings are refused — they exist because MPE serves a thousand
projects; this app has one identity.

**Done when**: a fiche can carry a diagram, a chart, highlighted code and a
table of contents, and a fiche with none of those loads exactly as fast as today.

---

## §3 — Running code, without running it on the server

The headline MPE feature, and the one with a genuinely different answer here.

**Pyodide, in a web worker, in the reader's own browser.** Python compiled to
WASM, no network, no filesystem, no server involvement whatsoever.

````md
```python run
import numpy as np
xs = np.linspace(0, 2 * np.pi, 200)
print(np.trapz(np.sin(xs), xs))
```
````

````

- Runs on an explicit click, never on render. A document that executes on open
  is a document you cannot safely be shown by someone else.
- Wall-clock cap, terminated by killing the worker.
- Output — text, and matplotlib figures as images — stored in the document, so a
  reader who never runs anything still sees the result.

**Implementation adaptation (2026-08-21).** Reader executions remain ephemeral
in local component state. Persisting automatically from the reader would make a
read action mutate the source document, introduce revision conflicts, and send
the result of untrusted code to the server — contradicting both the ownership
model and the “no server involvement” boundary above. Persistence should only
arrive as an explicit author/editor action with a source-revision precondition;
there is deliberately no background endpoint or implicit upload in this phase.

Two things this is **not**: it is not the LaTeX sandbox extended to arbitrary
Python — the blast radius is not comparable — and it is not a notebook. Reading
`.ipynb` (§4) is a separate, read-only concern.

**Done when**: a student can plot a function inside a fiche, and nothing they
write can reach the server.

---

## §4 — The file types we cannot open

Ranked by value over cost.

| | Format | Why | Cost |
|---|---|---|---|
| 1 | **Audio and video** | Asked for, and absent from the upload list entirely | Upload constraints + a player + the transcript pairing |
| 2 | **`.ipynb`** | *The* practical-work format in maths, physics and CS; JSON with cells and outputs already embedded | A renderer; no service |
| 3 | **Code** — `.py .c .java .sql .r` | Course material for a CS student. Shiki and CodeMirror are already installed | Near zero |
| 4 | **`.srt` / `.vtt` against media** | Turns a lecture video into something searchable | Small, once media lands |
| 5 | **`.epub`** | How textbooks circulate | Moderate |

### Audio and video, specifically

```ts
// COURSE_MATERIAL_EXTENSION_MIME_TYPES gains
".mp3": "audio/mpeg",  ".m4a": "audio/mp4",   ".wav": "audio/wav",
".ogg": "audio/ogg",   ".mp4": "video/mp4",   ".webm": "video/webm",
".mov": "video/quicktime"
````

The size cap has to rise for video, and that is the real decision — 50 MiB is
about ten minutes. Suggested: a separate `course-media` purpose at 500 MiB, so
the limit is a deliberate choice rather than a side effect of raising it for
PDFs too.

The player is small. **The transcript is the point**: `jobs/transcription.ts`
already transcribes lecture recordings, and a video's audio track is the same
input. An uploaded lecture should arrive with the same searchable, timestamped
transcript a recorded one gets — which is also what makes it usable by the
assistant.

**Done when**: a lecture video uploads, plays in the pane, and its transcript is
searchable beside it.

---

## §5 — The new built-in types

### Quiz — build this one first

The strongest item on the list, for a reason worth stating: retrieval practice
is the best-evidenced revision technique there is, and a quiz is the natural
_consumer_ of everything else in the app — generated from a fiche, a transcript,
a PDF.

It is a study document kind, not a new table. `metaJson` already carries
structured content for `mindmap`; a quiz follows the same route.

```ts
// study_documents.kind gains "quiz"; metaJson (v1):
{ version: 1, questions: Array<
    | { kind: "mcq"; prompt: string; choices: string[]; answers: number[]; why?: string }
    | { kind: "open"; prompt: string; expected: string }
    | { kind: "cloze"; text: string; blanks: string[] }
  > }
```

```ts
export const quizAttempts = sqliteTable("quiz_attempts", {
  id: text()
    .primaryKey()
    .$defaultFn(() => newId("qatt")),
  documentId: text()
    .notNull()
    .references(() => studyDocuments.id, { onDelete: "cascade" }),
  startedAt: integer({ mode: "timestamp" }).notNull(),
  completedAt: integer({ mode: "timestamp" }),
  score: real(),
  outOf: real(),
  answersJson: text({ mode: "json" }),
  /** Denormalised so a result is a signal about a subject, not about a file. */
  subjectId: text().references(() => subjects.id, { onDelete: "set null" }),
  yearId: text()
    .notNull()
    .references(() => years.id, { onDelete: "cascade" }),
  userId: owner(),
  ...timestamps,
});
```

**`subjectId` is the interesting column.** A quiz result is evidence about a
subject, and this app already models goals per subject. Nothing else on the
request list closes that loop: a poor score in Physique is exactly the input the
goal and planning screens have never had. That connection is the argument for
building quizzes before anything else here.

### Anki — export, never reimplement

Right instinct, and the reason is sharper than "reuse": Anki's scheduler (FSRS)
is a hard, well-solved problem, and competing with it would be the least
rewarding work in this plan.

Two tiers, and **start with the first**:

1. **Tab-separated text**, which Anki imports natively. A day's work, and it
   covers the whole use case.
2. `.apkg` — a SQLite bundle in Anki's own schema. Only if (1) proves too
   awkward in practice.

An Anki deck is a `documentArtifacts` row of kind `"anki"`, generated from a
quiz or a fiche.

### Data blocks, not infographics

The half of this idea worth keeping is "use the datacard system for anything";
the half to drop is the poster. An infographic is looked at once; a chart built
from your own marks, inside a fiche, is read repeatedly.

So: `vega-lite` fences (§2) and a `datacard:` fence that renders an existing
dashboard card inline. The CSV renderer's natural next step is the same
mechanism — a column becomes a chart. Poster export stays available as a
`documentArtifacts` row of kind `"image"`, which is where a one-off belongs.

### Presentations and podcasts

Slides already exist as a kind with a PPTX export. Code-generated decks are a
_generator_ for that kind, not a new one.

A podcast is a `documentArtifacts` row of kind `"audio"`, derived from a fiche.
The commute is a genuine revision slot, so this earns its place — but as a
rendering, not a document, because generated narration cannot be corrected, only
regenerated.

---

## §6 — What I would cut: generated video

The `manim` + text-to-speech pipeline is the most expensive item proposed and
the least defensible, and it should not be built.

- It needs Python, LaTeX and ffmpeg in a sandbox, and minutes of CPU per video.
- The output is linear: not searchable, not quotable, not correctable.
- For revision, a video you watch is worth less than a sheet you re-read and
  quiz yourself on — which is the same reason §5 puts quizzes first.

**The cheap substitute that keeps the value**: slides plus narration, played in
sync. The deck exists, the audio is a §5 artifact, and the "video" is a player
that advances slides against timestamps. No rendering pipeline at all — a few
per cent of the cost, and most of what anyone actually wanted.

If a real video file is ever needed, it is one ffmpeg call over the same two
inputs, and it can be added later without any of this being wasted.

---

## Order

`§1 artifacts table` → `§4 audio/video` → `§2 Mermaid + Shiki + anchors` →
`§5 quiz` → `§4 .ipynb + code` → `§2 vega-lite + transclusion` →
`§5 Anki export` → `§3 Pyodide` → `§5 podcast`.

§1 comes first because every generated thing after it needs somewhere to live,
and adding them one table at a time is the mistake this plan exists to prevent.
§2's first three are what people see the same afternoon.
