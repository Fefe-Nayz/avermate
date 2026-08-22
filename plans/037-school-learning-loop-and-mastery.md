# Plan 037: School learning loop, copy diagnosis and measurable mastery

> **Executor instruction**
>
> Read plans 004, 006, 009, 010, 024, 027–030, 035 and 036 plus
> `docs/school-integrations.md`. Audit the current grade attachments, provider
> ownership overlays, quiz attempts, projects, planning feed and assistant tool
> catalogue before editing. This is an evidence model, not an “AI score” feature:
> every diagnosis and mastery projection must resolve to user-owned evidence and
> expose uncertainty. Implement the complete Web experience. Do not include
> React Native.

## Status

- **Status**: TODO
- **Priority**: P0 — this is Avermate's primary differentiation from a generic
  NotebookLM clone
- **Effort**: XL (ship in independently guarded vertical slices)
- **Risk**: HIGH
- **Depends on**: 025, 027–030, 035 and 036; reuses planning from 004, files from
  001/006, OCR from 009 and artifacts/quizzes from 024/033
- **Blocks**: honest learning recommendations and longitudinal product claims
- **Category**: academic domain, pedagogy, analytics, agent tools, Web product
- **Planned at**: 2026-08-22, branch `rewrite`
- **Evidence baseline**: `15a8897ce1eb82c2807f5547d9f558a59ad9a2e1`

## Outcome

Deliver the complete, inspectable loop:

```text
course/devoir/copy/grade
        -> extracted evidence and confirmed errors
        -> concepts and learning objectives
        -> next-action study plan
        -> task, fiche, exercise or quiz
        -> per-question evidence
        -> updated mastery projection
        -> comparison with later school results
```

The user can start from a photographed or uploaded copy, review what OCR and the
assistant inferred, map it to the right subject/period/objectives, create a
concrete study plan, practice, and see why Avermate believes progress did or did
not occur. Imported school grades stay provider-owned. Learning records are
local overlays and never rewrite the provider's facts or reported averages.

## Current-state evidence and gaps

1. Grade-copy upload and ownership exist in `apps/server/src/routers/grades.ts`
   and the `grades-attachments` tests, including local/S3 storage and limits.
2. `apps/server/src/search/adapters.ts:638-698` can index grade metadata but does
   not consume the actual copy bytes, page evidence or teacher annotations.
3. `apps/server/src/db/schema/documents.ts:48-62` stores quiz questions without
   objective IDs, difficulty, source locators or grading rubric versions.
4. `apps/server/src/db/schema/documents.ts:272-310` stores only aggregate quiz
   attempt score/answers. There is no per-question evidence or mastery update.
5. Goals in `apps/server/src/db/schema/app.ts:548-579` are generic progress
   ratios rather than a learning-evidence model.
6. Planning already distinguishes personal tasks, calendar occurrences, agenda
   and kanban semantics. This plan links learning actions to that domain instead
   of creating a second todo system.
7. School sync already separates locked remote facts from editable local
   overlays and distinguishes provider averages from Avermate calculations.
8. The assistant ToolBroker and action ledger can safely preview/approve writes,
   but there is no reviewed learning-concept/evidence/plan tool family.
9. There is no Web copy-review workspace, concept mastery view, evidence timeline
   or closed-loop progress view.

## Mandatory drift check

```text
git rev-parse HEAD
git status --short
rg -n "grade.*attachment|copy" apps/server/src/routers/grades.ts apps/server/src/db/schema apps/web/src
rg -n "QuizQuestion|quizAttempts|score|answersJson" apps/server/src/db/schema apps/server/src/routers
rg -n "learning|mastery|objective|concept" apps packages docs
rg -n "provider-owned|overlay|detached|dismissed" docs/school-integrations.md apps/server/src
bun run --cwd apps/server test src/routers/grades-attachments.test.ts src/routers/documents.test.ts
```

STOP and revise the plan if a learning-evidence schema or per-question attempt
model already exists, or if planning/provider ownership semantics changed.

## Product truths and invariants

- A school grade, provider average and teacher comment are evidence, not a direct
  mathematical statement of mastery.
- A mastery value is a versioned projection with a range/confidence and
  explanation. It is never presented as an objective truth or used to overwrite
  a grade.
- Remote grade value, denominator, date and provider identity remain locked.
  Local copy attachments, notes, tags, exclusions and learning links remain
  independently user-owned.
- AI extraction/diagnosis is a proposal. The original copy/page/region is truth;
  user confirmation or correction is preserved without deleting the proposal.
- Every learning observation names its source, exact locator where possible,
  timestamp/period, subject, objective, assessor, algorithm/model revision and
  confidence.
- A user may create local concepts/objectives, rename/reorganize remote subject
  labels, detach recommendations and exclude misleading evidence.
- No hidden ranking changes a general average. Bonus/coefficients remain the
  period-scoped adjustment overlay already defined by the academic model.
- Costly OCR/model/artifact actions require an available explicit placement and
  plan-034 reservation where managed. There is no silent paid work.
- Tool writes use plan 030's preview, approval, idempotency, revision fences and
  compensation. The model never writes academic tables directly.
- The Web explains why a recommendation exists and lets the user open the exact
  copy, course page, quiz response or grade behind it.

## In scope

- Concepts, objectives, evidence, error observations, mastery projections and
  learning-plan links.
- Copy ingestion/OCR/visual evidence review and teacher annotation capture.
- Quiz question v2, rubrics and per-question attempt evidence.
- Deterministic, inspectable initial mastery algorithm plus replay/versioning.
- Reviewed ToolBroker/MCP tools and assistant widgets.
- Integration with existing projects, tasks, agenda, calendar and artifacts.
- Complete Web workflows and a longitudinal evaluation.

## Out of scope

- Automatic modification of provider grades or school records.
- Diagnosing disability, health, intelligence or psychological traits.
- Punitive student ranking, teacher surveillance or cross-user model training.
- Claiming a causal improvement from correlation alone.
- A national curriculum ontology required for first release; imported/local
  objective sets can coexist behind a versioned namespace.
- Replacing agenda, calendar, todo or kanban with another task model.
- React Native.

## Domain model

Implement append-only migrations and Drizzle schemas with owner/year/subject
fences for the following concepts. Names may adapt to repository conventions,
but the information and constraints may not disappear.

### `learning_concept_sets`

- ID, owner, year, optional subject, namespace (`local`, `curriculum`,
  `provider`), source/version, title, locale and immutable import digest.
- A set is user-owned even when seeded from a curriculum. Updating an upstream
  set creates a new version and a reviewed mapping.

### `learning_concepts`

- Stable ID within a set, parent ID, canonical label, local label, description,
  ordering and archived state.
- Acyclic hierarchy, same-owner/year/subject checks and no remote identity
  mutation.

### `learning_objectives`

- Objective ID, concept ID, statement, expected level, optional curriculum code,
  prerequisites and active period range.
- Objective prerequisites form a checked DAG; cycles fail before publication.

### `learning_evidence`

- Immutable event ID and owner/year/period/subject/objective.
- Kind: school grade, copy region, teacher comment, quiz question, exercise,
  self-assessment, manual observation or imported provider snapshot.
- Source reference/version/locator, observed outcome, denominator/rubric,
  difficulty estimate, reliability, occurrence date and exclusion state.
- Producer: human, deterministic parser, provider or model descriptor; include
  prompt/algorithm revision and confidence when inferred.
- Correction links append a new event; do not rewrite the original observation.

### `learning_error_observations`

- Evidence ID, objective/concept, bounded taxonomy, quoted/located evidence,
  explanation, severity, confidence and status (`proposed`, `confirmed`,
  `corrected`, `dismissed`).
- Initial taxonomy: missing knowledge, misunderstood concept, method/strategy,
  calculation, notation, reading/instruction, justification, transfer,
  time-management and unclassified. UI wording must avoid moral judgments.

### `learning_mastery_projections`

- Immutable projection generation, objective, algorithm revision, computed-at
  evidence cursor, estimate interval, evidence count, freshness and explanation
  components.
- One atomic current pointer per objective. Recompute publishes by CAS; stale
  workers cannot roll it back.

### `learning_plan_items`

- Objective, rationale/evidence snapshot, recommended activity kind, difficulty,
  estimated duration, status and links to the authoritative planning task,
  project, document, quiz or artifact.
- Scheduling remains in planning tables; this row is the pedagogical link, not a
  second due-date authority.

### Quiz v2

- Question ID stable across one document revision, objective IDs, difficulty,
  source proof handles, rubric/accepted variants, generation provenance and
  validation state.
- Attempt item rows store presented revision, answer, normalized outcome,
  feedback, latency if user consents, hints and exact objective evidence.
- Answers remain hidden until completion under the existing quiz contract.

## Initial mastery algorithm

Start with an interpretable evidence-weighted projection, not an opaque LLM:

1. Normalize only observations with a defined rubric into `[0, 1]`.
2. Assign reviewed reliability weights by evidence kind; a teacher-marked copy or
   completed quiz item may outweigh a self-assessment, but values remain
   configurable and versioned.
3. Apply bounded recency decay by occurrence date and explicit difficulty
   adjustment. Missing difficulty is “unknown,” not average by invention.
4. Compute a weighted Beta-style posterior/credible interval per objective,
   retaining prior parameters and every contribution in the explanation.
5. Propagate no score automatically between prerequisite concepts. Prerequisites
   inform recommendations only until an evaluated rule is approved.
6. Excluded/dismissed/corrected evidence is retained but omitted from the current
   projection with an explicit reason.
7. Replaying the same evidence cursor and algorithm revision must produce exactly
   the same bytes.

Treat the algorithm as a product hypothesis. Plan 037 may change it only through
versioned offline evaluation and migration-free recomputation, never by rewriting
historical evidence.

## Implementation sequence

### 1. Build evidence-safe copy ingestion

- Add a durable `grade-copy.analyze` job that resolves owned attachments through
  storage, creates page derivatives, runs native text/OCR/multimodal analysis
  through plan 036 placement, and stores a proposal tied to exact regions.
- Separate extraction (question, answer, teacher mark/comment, awarded points)
  from diagnosis. Preserve bounding boxes/page handles and confidence.
- Refuse to infer a numeric grade when the source is ambiguous. A proposed grade
  addition/update is a separate plan-030 action with preview.
- Support multi-page copies, duplicate upload detection, cancellation, retry and
  re-analysis under a new model revision without destroying the prior proposal.
- Never send unrelated grade/year/student identity to an OCR/model provider.

### 2. Add a human review transaction

- Create APIs for proposal get/review/correct/confirm/dismiss with owner and
  source-revision CAS.
- Confirmation atomically publishes selected evidence/error observations and
  queues affected mastery recomputation.
- Corrections preserve both model proposal and user-authored value for audit and
  future evaluation; no training export occurs by default.
- Add undo/compensation where honest: unconfirming creates exclusion/correction
  events and recomputes; it does not delete the source copy.

### 3. Import and edit concept/objective sets

- Provide a local set builder scoped to year/subject and a versioned import
  format for reviewed curriculum packs.
- Add mapping suggestions from source/quiz/copy text, but require confirmation
  before evidence affects an objective.
- Support merge/split/archive as versioned mapping operations with preview of
  affected evidence/projections.
- Keep provider subject identity separate from the local concept hierarchy.

### 4. Upgrade quizzes and exercises

- Add quiz-v2 parsing/validation and migrate v1 documents lazily or through an
  append-only converter; preserve old attempts exactly.
- Require generated questions to carry proof handles and objective mappings
  before they contribute mastery evidence.
- Score deterministic question kinds locally. Open answers use a versioned rubric
  and either human review or an explicitly configured model assessment whose
  uncertainty is visible.
- Persist one item-level evidence event per completed answer and recompute only
  affected objectives.
- Allow practice mode that does not affect mastery, chosen before starting.

### 5. Generate an actionable learning plan

- Rank candidate next actions from confirmed gaps, prerequisites, due tasks,
  available time and evidence freshness using a deterministic policy first.
- The assistant may explain/rewrite choices or propose artifacts, but may not
  fabricate evidence or schedule work without the selected approval mode.
- Create/attach authoritative planning tasks through ToolBroker. Show agenda text,
  calendar placement and kanban state through the existing planning views.
- Link generated fiche/quiz/exercise/podcast/video artifacts to objective IDs,
  source proofs and the action that requested them.
- After completion, ask for or derive appropriate evidence and update the plan;
  “task checked” alone is not mastery proof.

### 6. Add reviewed agent/MCP tools

Add bounded descriptors and parity tests for at least:

- `learning.concepts.list/get`;
- `learning.evidence.list/get` with proof handles;
- `learning.mastery.get/explain`;
- `learning.plan.list`;
- `learning.copy.requestAnalysis`;
- `learning.copy.confirmAnalysis`;
- `learning.plan.propose` and `learning.plan.apply`;
- `learning.quiz.generate` and `learning.quiz.start`;
- correction/exclusion operations with explicit approval and compensation.

Reads must be narrow and citation-capable. Writes require preview, exact evidence
cursor, policy/risk classification, idempotency and action-ledger recovery.

### 7. Complete the Web experience

Build coherent Web routes/components using the existing design system:

- **Grade detail / copy workspace**: original page viewer, OCR/native text,
  located question/answer/teacher marks, side-by-side proposal review, objective
  mapping, errors, confidence, confirm/correct/dismiss and job progress.
- **Subject learning view**: concept tree, current estimate interval, freshness,
  evidence count, last observations, “why this value,” excluded evidence and
  recommended next action.
- **Learning plan**: grouped by today/upcoming/objective, with links to the
  authoritative agenda/calendar/kanban task and artifact/project. Do not collapse
  those distinct planning concepts into one ambiguous calendar.
- **Quiz/exercise session**: objective and source context, accessible question
  navigation, answer review, item-level feedback and explicit “counts toward
  progress” mode.
- **Longitudinal progress**: time series of evidence/projection revisions next to
  later school grades, with prominent “association, not proof of causation” copy.
- **Assistant widgets**: copy-analysis approval, evidence card, mastery
  explanation, learning-plan preview, quiz/artifact progress and undo status.
- **Settings/privacy**: provider disclosure, learning analysis enable/disable,
  per-evidence exclusion, derivative deletion, export and full learning-data
  deletion.

Every view requires loading/empty/error/offline/stale/job-cancelled states,
keyboard navigation, focus restoration, screen-reader labels, responsive Web
layout and French copy. No critical action may exist only inside chat.

### 8. Evaluate the learning loop

- Create synthetic/redacted fixtures with copies, teacher annotations, course
  sources, objectives, quiz responses and later results.
- Human-label extraction fields, region accuracy, objective mappings, error
  taxonomy, recommendation usefulness and unsupported inferences.
- Measure extraction precision/recall, calibration, dismissal/correction rate,
  objective mapping top-k, evidence/projection determinism and plan completion.
- For longitudinal product claims, run opt-in studies with adequate sample and
  methodology; until then report descriptive associations only.
- Add regression slices for French notation, decimal commas, grading out of 10/
  20/100, bonus grades, absent/non-numeric results, multiple periods and remote
  provider ownership.

## Migration and lifecycle requirements

- Use append-only migrations with foreign keys/check constraints and indexes for
  owner/year/subject/objective/evidence cursor.
- Test fresh DB, pre-learning populated DB and rollback-by-old-binary behavior.
  If old code cannot safely ignore new rows, STOP instead of improvising.
- Export JSON and Markdown include concept sets, evidence, corrections,
  projections with algorithm version, plans and source references.
- Account/year/subject/grade/file deletion cascades or tombstones according to
  existing ownership policy; remote Node objects use plan 032/038 receipts.
- Retention never deletes the only original proof while a visible learning record
  cites it. Deleting the source makes the derived record explicitly unavailable
  or removes it according to the user's chosen deletion scope.

## Verification matrix

Add `verify:037:schema`, `:copy`, `:mastery`, `:tools`, `:web`, `:evaluation` and
an aggregate gate. Required cases include:

- same-owner/year/period/subject/objective integrity and cross-tenant attacks;
- provider grade fields unchanged through every learning flow;
- copy job idempotency, multi-page locators, cancellation, model re-analysis and
  correction audit;
- mastery determinism, interval math, evidence exclusion, stale worker CAS,
  algorithm-version replay and unknown difficulty/reliability;
- quiz-v1 preservation, quiz-v2 item scoring, hidden answers and practice mode;
- plan item ↔ planning task linkage without duplicate due-date authority;
- ToolBroker/MCP/embedded parity, approvals, restart recovery and compensation;
- export/delete/retention for Core and offline Node placements;
- Web E2E from copy upload through confirmed diagnosis, plan, quiz and updated
  evidence, including accessibility and responsive screenshots;
- labelled evaluation thresholds with no unsupported-diagnosis regression.

Then run root gates, migration history/prefix/legacy fixtures and the relevant
036 retrieval/provider gates.

## STOP conditions

STOP and ask for a decision if:

- a proposed model would infer health, disability, intelligence or another
  sensitive trait;
- a provider-owned grade must be edited to implement the learning record;
- evidence cannot be tied to an owned source/version/locator;
- an AI proposal would affect mastery without review under the ratified policy;
- the algorithm cannot explain its contributing evidence and version;
- generated practice would spend managed resources without explicit placement/
  quota/approval;
- copy data would be used for provider or Avermate training without a separate,
  informed opt-in;
- the UI hides uncertainty, excluded evidence or the distinction between
  correlation and causation;
- migration work rewrites ratified history or deletion leaves uncited orphaned
  personal data.

## Definition of done

- A user can upload/open a copy, run analysis, inspect exact regions, correct and
  confirm evidence without changing the imported grade facts.
- Concepts/objectives, immutable evidence, error observations and versioned
  mastery projections are durable, owner-scoped, exportable and explainable.
- Quiz v2 creates item-level objective evidence while preserving every v1
  document/attempt.
- Confirmed gaps produce a previewed plan linked to existing tasks/projects and
  can launch cited study artifacts or practice.
- Completing practice adds evidence and recomputes only the affected projections
  deterministically; later school outcomes can be compared honestly.
- All critical flows exist in Web outside chat and all assistant/MCP writes use
  the same reviewed ToolBroker/action-ledger path.
- Security, migration, accessibility, real-provider, labelled evaluation, root
  test and build gates pass with no required live gate converted to mock/skip.

## Maintenance trigger

Re-run extraction, calibration, mastery replay and longitudinal evaluations when
an OCR/model/rubric/taxonomy/algorithm revision, objective import, quiz format,
provider grade mapping or planning contract changes.
