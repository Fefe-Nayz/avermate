# Plan 022: YouTube and the web, as readable sources

> **The ask**: "un transcripteur/downloader de vidéo YouTube. Récupérateur de
> contenu web (se renseigner comment les outils de LLM qui convertissent une URL
> en contenu markdown ingestable par un LLM font, et reproduire en gros)."
>
> **The finding that shapes this plan**: the web half is already built. This repo
> runs the same pipeline those tools run — `@mozilla/readability` over `linkedom`,
> then `turndown` with the GFM plugin — in `lib/ingest.ts`. What is missing is
> three specific things, and YouTube is the largest of them.

## Status

- **Execution**: DONE (2026-08-21), with the security adaptations recorded below
- **Priority**: P2. §1 and §2 are small; §3 is the real work.
- **Depends on**: plan 009 (OCR pipeline), plan 012 (lecture transcription),
  plan 013 (multi-type source ingestion)
- **Written at**: 2026-08-21, branch `rewrite`

---

## 1. How the URL→Markdown tools actually work

Reader-mode services (Jina Reader, Firecrawl, and the reader-mode in every
browser) are all the same seven steps. Naming them is the fastest way to see
what this repo has and has not got.

1. **Fetch, defensively.** A real user agent, redirects followed to a bounded
   depth, a wall-clock timeout, a body size cap, and — the one people forget —
   an SSRF guard that refuses private and link-local addresses _after_ resolving
   the final URL, not before the redirects.
2. **Decide whether JavaScript is needed.** Fetch statically first. If what
   comes back has almost no text relative to its markup, re-fetch through a
   headless browser. This single decision is the whole cost difference between
   tiers: Jina renders everything, Firecrawl decides per page.
3. **Extract the main content.** This is the algorithm everything else hangs
   off. Readability — the Firefox reader-mode scorer — walks the DOM giving
   each node a score from text length, comma count, and link density, adjusted
   by tag and by class and id names (`article`, `content`, `post` up;
   `comment`, `sidebar`, `nav`, `footer` down), then keeps the top-scoring
   subtree and its siblings above a threshold. `trafilatura` is the other
   serious implementation and scores better on news; Readability is better on
   documentation, which is what a student is reading.
4. **Clean.** Scripts, styles, tracking pixels and empty wrappers out.
   Relative URLs made absolute — a Markdown file full of `/img/fig1.png` is a
   Markdown file with no images. Tracking parameters stripped.
5. **Convert.** Turndown with the GFM plugin, so tables, strikethrough and
   task lists survive rather than collapsing into prose.
6. **Say what it is.** Front matter: title, canonical URL, byline, published
   date, site name, word count. This is the step that makes the output
   _LLM-ingestible_ rather than merely Markdown — a model handed a wall of text
   with no provenance will cite it as if it were yours.
7. **Cap.** A byte or token budget, and a truthful note when it was hit.

### What this repo already has

`lib/ingest.ts` does 1, 3, 4 (partly) and 5, and `jobs/ingest-link.ts` runs it
as a job that writes a `web-markdown` artifact, with a PDF branch that files the
bytes as a real file instead. The reader in `materials/renderers/text-renderer.tsx`
already renders the result.

### What is missing

- **§1 JavaScript rendering (step 2).** A course page behind a SPA currently
  returns a shell. Everything the app is likely to be pointed at — a university
  Moodle page, a documentation site, a Notion export — is a coin flip.
- **§2 Front matter (step 6).** The artifact stores the body. Provenance lives
  in `metaJson` and is not part of what the assistant reads.
- **§3 Site families.** A YouTube URL through Readability produces nothing,
  because a video page has no article. Same for a PDF behind a viewer, a Google
  Doc, a slide deck. YouTube is the one worth building.

---

## 2. §1 — Rendering, and when to pay for it

> **Adaptation de sécurité implémentée** — l'ingestion reste statique. Un
> Browserless distant résout lui-même les DNS, suit lui-même les redirections
> et charge les sous-ressources de la page : Avermate ne peut donc pas y
> garantir son épinglage DNS ni son contrôle SSRF face au rebinding. Les
> variables `RENDER_SERVICE_*` et le chemin d'exécution correspondant ont été
> retirés. Un rendu JavaScript ne pourra revenir qu'avec un renderer possédé et
> durci qui applique ces contrôles à chaque navigation et sous-requête.

### The decision

Static only. A sparse SPA shell fails honestly instead of being sent to a
renderer whose network policy Avermate cannot verify. Detection and per-host
caching are deferred until the renderer can enforce the same public-IP,
redirect, response-size and timeout boundaries as the static fetcher.

### The renderer

No Browserless setting is exposed. A future renderer must be owned by the
deployment and provide request interception that rejects credentials, private
or special-use IPs, DNS changes, unsafe redirects and external sub-resources on
every request—not only on the initial page URL.

**Done when**: static pages import defensively, and sparse pages never cross an
uncontrolled browser/network boundary.

---

## 3. §2 — Front matter

One change, in `lib/ingest.ts`, at the end of the conversion:

```md
---
title: Suites numériques — chapitre 4
source: https://cours.example/suites
site: cours.example
author: M. Durand
published: 2026-03-11
fetched: 2026-08-21
words: 2431
---
```

Kept in the artifact body rather than only in `metaJson`, because the body is
what gets handed to the assistant and to the reader. `metaJson` keeps its
structured copy for the UI.

**Done when**: an imported page cites itself, and a model asked about it can say
where the claim came from.

---

## 4. §3 — YouTube

### Why it needs its own path

A YouTube page has no article. Readability on one returns the description at
best. What is actually wanted from a lecture recorded on YouTube is: the title,
the channel, the duration, the chapter list, and **the transcript** — none of
which are in the HTML in a form an extractor can find.

### The transcript, in order of preference

**a. The caption tracks YouTube already serves.** The watch page carries a
player response listing `captionTracks`, each with a URL serving timed text.
This includes auto-generated captions, which exist for essentially every
lecture. It is exact, already timed, free, and needs no media download at all.
This is what every `youtube-transcript` library does, and it should be the
default and the overwhelmingly common path.

**b. Audio, transcribed by us.** When captions are disabled. This repo already
has the machinery — `jobs/transcription.ts` transcribes lecture recordings — so
this is a matter of handing that pipeline a different audio source rather than
building anything new.

### On downloading

Worth stating plainly rather than discovering later: **downloading YouTube video
is against YouTube's terms of service.** The captions path is not a download of
the work; the audio path is, and should therefore be:

- opt-in per deployment (`YOUTUBE_AUDIO_FALLBACK=true`, default off),
- audio-only, never video,
- transcribed and then **discarded** — the transcript is kept, the media is not,
- never offered as a "download this video" button in the interface.

That last point is the one that matters for the product: the feature the ask
describes is _"transcripteur/downloader"_, and the transcriber is the part with
a defensible reason to exist. A video downloader in a study app is a liability
with no study value — the student wants the words, and the words are the thing
we can legitimately keep. This repo already has
`sync/provider-license-boundary.test.ts`, so the line is one the project already
draws elsewhere.

### Shape

```ts
// A YouTube link is still a link: same document, same row, different extractor.
// material_documents.sourceType stays "link"; metaJson (v2) gains:
{ kind: "youtube", videoId, channel, durationSec, chapters?: { at: number, title: string }[] }
```

```ts
// jobs
"ingest.youtube": { documentId }
  -> writes a `web-markdown` artifact whose body is front matter + chapters +
     the timed transcript, and metaJson as above
```

The transcript is written as Markdown with timestamps as headings, so the
existing reader renders it with no change and the assistant can cite a minute:

```md
## 12:03 — Le théorème de convergence monotone

Si une suite est croissante et majorée…
```

### UI

Almost none, and that is the point. A YouTube URL pasted into "Add a link" is a
link like any other: it becomes a row, it gets a chip, and its transcript is on
the Transcription tab the pane already has. The only additions:

- The remote thumbnail is deliberately not rendered or persisted as a browser
  URL: that would be a tracking hotlink outside the guarded fetch boundary. A
  preview may be added later only by downloading, validating and storing it in
  the private `files` preview path.
- The reader offers **Open on YouTube** rather than pretending to embed it.
- A chapter list, when there is one, is emitted through `[TOC]` as jump links
  into the timestamped transcript.

**Done when**: pasting a lecture URL produces a searchable, quotable transcript
in Supports, and nothing in the interface offers to download a video.

---

## 5. Order

`§2 front matter` (an afternoon, immediately useful) → `§3 YouTube captions`
(the ask, and the largest gain) → `§1 rendering` (the most infrastructure per
unit of benefit) → `§3b audio fallback` (only if captions turn out to be missing
often enough to matter).

§3b is deliberately last: it is the only part that needs a media download, and
it should not be built until the caption path has shown how rarely it is needed.
