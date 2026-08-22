import type {
  CustomAverage,
  Goal,
  Grade,
  GradeType,
  Period,
  Subject,
  Year,
} from "@avermate/core"

/**
 * A year built to make every card say something.
 *
 * The test page used to draw against the signed-in account, which meant the
 * cards it drew depended on whose account it was: no unreachable goal, no
 * subject long enough to test a name, no empty subject, and nothing at all
 * without a session. A fixture answers all of that, and answers it the same way
 * twice — a layout regression on this page is a real regression, not a change in
 * somebody's marks.
 *
 * Every date is a real `Date` and every number a real number: the snapshot is
 * seeded through the same serializer the network uses, which round-trips those
 * and would silently hand a card a string otherwise.
 *
 * Deliberate in the data, because each of these is a card:
 *
 * - a **long subject name**, for every body that prints one
 * - a subject with **one grade** (no trend to draw) and one with **none**
 * - grades **clustered and sparse** through the year, so a weekly series has
 *   both a busy stretch and a flat one, and a heatmap has empty cells
 * - a **reachable** goal and an **impossible** one, which are two different cards
 * - **notes** on some grades, and a spread of coefficients, for the filters
 */

const YEAR_ID = "fixture-year"

/**
 * A year that contains today, and the same shape of year every time.
 *
 * It used to be pinned to fixed calendar dates so the page would be identical on every
 * open, and that made every forward-looking card read "not enough data": the year had
 * *ended*, so nothing was left to sit, and a required mark, a safety margin and a
 * projection band are all readings about what is still to come. A page that cannot show
 * them is not a page you can check them on.
 *
 * So the year is anchored to the real clock and only its *shape* is fixed: seven months
 * behind, two ahead, terms cut at the same fractions. Two consequences worth knowing —
 * the marks fall on different calendar days each time it is opened, and a chart's x axis
 * therefore reads differently; nothing about a card's layout depends on which Tuesday a
 * mark was sat.
 */
const TODAY = new Date()
const YEAR_START = new Date(
  TODAY.getFullYear(),
  TODAY.getMonth() - 7,
  1,
  0,
  0,
  0
)
const YEAR_END = new Date(
  TODAY.getFullYear(),
  TODAY.getMonth() + 2,
  28,
  23,
  59,
  59
)

/** Mid-afternoon today: late enough in the year to have history, early enough to have a
 * future, which is what the goal and projection cards are about. */
export const FIXTURE_NOW = new Date(
  TODAY.getFullYear(),
  TODAY.getMonth(),
  TODAY.getDate(),
  10,
  0,
  0
)

/** A date at a fraction of the way through the fixture's year. */
function through(fraction: number): Date {
  const span = YEAR_END.getTime() - YEAR_START.getTime()
  return new Date(YEAR_START.getTime() + span * fraction)
}

export const fixtureYear: Year = {
  id: YEAR_ID,
  name: "2025 – 2026 (fixture)",
  startsAt: YEAR_START,
  endsAt: YEAR_END,
  scale: 20,
  defaultOutOf: 20,
  passingRatio: 0.5,
  decimals: 2,
  sortOrder: 0,
  archivedAt: null,
}

export const fixturePeriods: Period[] = [
  {
    id: "fixture-t1",
    name: "Trimester 1",
    startAt: YEAR_START,
    endAt: through(0.33),
    isCumulative: false,
    sortOrder: 0,
  },
  {
    id: "fixture-t2",
    name: "Trimester 2",
    startAt: through(0.34),
    endAt: through(0.66),
    isCumulative: false,
    sortOrder: 1,
  },
  {
    id: "fixture-t3",
    name: "Trimester 3",
    startAt: through(0.67),
    endAt: YEAR_END,
    isCumulative: false,
    sortOrder: 2,
  },
]

function periodOf(at: Date): string {
  return (fixturePeriods.find(
    (period) => at >= period.startAt && at <= period.endAt
  )?.id ?? null) as string
}

/**
 * A deterministic spread, so a curve has shape without a random number
 * generator — which this file cannot use anyway if the page is to be stable.
 */
function wobble(index: number, amplitude: number): number {
  return Math.sin(index * 1.7) * amplitude + Math.cos(index * 0.6) * amplitude
}

interface GradeSeed {
  day: number
  base: number
  name: string
  note?: string
  outOf?: number
  coefficient?: number
}

/**
 * The kinds of assessment this year holds.
 *
 * Three, with different coefficients and different weights in the year, because the whole
 * point of grouping by them is that a DS and a colle are not the same event — a fixture
 * where every kind behaved alike would draw three identical bars and prove nothing.
 */
export const fixtureGradeTypes: GradeType[] = [
  {
    id: "fixture-type-ds",
    name: "DS",
    titlePrefix: "DS ",
    coefficient: 3,
    outOf: 20,
    accent: null,
    sortOrder: 0,
  },
  {
    id: "fixture-type-colle",
    name: "Colle",
    titlePrefix: "Colle ",
    coefficient: 1,
    outOf: 20,
    accent: null,
    sortOrder: 1,
  },
  {
    id: "fixture-type-tp",
    name: "TP noté",
    titlePrefix: "TP ",
    coefficient: 1,
    outOf: 20,
    accent: null,
    sortOrder: 2,
  },
]

function gradesFor(
  subjectId: string,
  seeds: readonly GradeSeed[],
  drift: number
): Grade[] {
  return seeds.map((seed, index) => {
    const at = new Date(YEAR_START)
    at.setDate(at.getDate() + seed.day)
    const outOf = seed.outOf ?? 20
    const raw = seed.base + wobble(index, 0.9) + index * drift
    return {
      id: `${subjectId}-g${index}`,
      name: seed.name,
      value: Math.min(outOf, Math.max(0, Number(raw.toFixed(2)))),
      outOf,
      coefficient: seed.coefficient ?? 1,
      passedAt: at,
      createdAt: at,
      subjectId,
      periodId: periodOf(at),
      /**
       * A kind of assessment, cycled — and every fourth one left without.
       *
       * Deliberately not every result: a year always holds marks written before its types
       * existed, and a fixture where all of them had one would never draw the bucket the
       * dimension is careful to keep.
       */
      typeId:
        index % 4 === 3
          ? null
          : (fixtureGradeTypes[index % fixtureGradeTypes.length]?.id ?? null),
      note: seed.note ?? null,
      components: [],
    }
  })
}

/** Days chosen to leave the winter sparse and the spring busy. */
const DENSE_DAYS = [8, 15, 22, 30, 44, 58, 66, 80, 120, 168, 190, 197, 204, 211]
const SPARSE_DAYS = [26, 96, 158, 205]

export const fixtureSubjects: Subject[] = [
  {
    id: "sci",
    name: "Sciences",
    shortName: "Sci",
    parentId: null,
    coefficient: 1,
    kind: "category",
    isMain: true,
    sortOrder: 0,
    grades: [],
  },
  {
    id: "maths",
    name: "Mathematics",
    shortName: "Maths",
    parentId: "sci",
    coefficient: 4,
    kind: "subject",
    isMain: true,
    sortOrder: 1,
    grades: gradesFor(
      "maths",
      DENSE_DAYS.map((day, index) => ({
        day,
        base: 12.5,
        name: `Test ${index + 1}`,
        note: index % 4 === 0 ? "Chapter review" : undefined,
        coefficient: index % 3 === 0 ? 2 : 1,
      })),
      0.16
    ),
  },
  {
    id: "physics",
    name: "Physics and Chemistry",
    shortName: "Phys",
    parentId: "sci",
    coefficient: 3,
    kind: "subject",
    isMain: true,
    sortOrder: 2,
    grades: gradesFor(
      "physics",
      DENSE_DAYS.slice(0, 10).map((day, index) => ({
        day: day + 2,
        base: 10.5,
        name: `Lab ${index + 1}`,
        outOf: index === 3 ? 40 : 20,
        note: index === 1 ? "Missed the last question" : undefined,
      })),
      -0.1
    ),
  },
  {
    id: "cs",
    name: "Computer Science",
    shortName: "CS",
    parentId: "sci",
    coefficient: 2,
    kind: "subject",
    isMain: true,
    sortOrder: 3,
    grades: gradesFor(
      "cs",
      DENSE_DAYS.slice(2).map((day, index) => ({
        day: day + 4,
        base: 17,
        name: `Project ${index + 1}`,
      })),
      0.08
    ),
  },
  {
    id: "long-name",
    name: "Travaux d'Initiative Personnelle Encadrés — Compétences Transversales",
    shortName: null,
    parentId: null,
    coefficient: 2,
    kind: "subject",
    isMain: true,
    sortOrder: 4,
    grades: gradesFor(
      "long-name",
      SPARSE_DAYS.map((day, index) => ({
        day,
        base: 14,
        name: `Oral ${index + 1}`,
      })),
      0.4
    ),
  },
  {
    id: "history",
    name: "History and Geography",
    shortName: "Hist",
    parentId: null,
    coefficient: 3,
    kind: "subject",
    isMain: false,
    sortOrder: 5,
    grades: gradesFor(
      "history",
      SPARSE_DAYS.map((day, index) => ({
        day: day + 5,
        base: 9.5,
        name: `Essay ${index + 1}`,
        coefficient: 2,
      })),
      -0.35
    ),
  },
  {
    id: "english",
    name: "English",
    shortName: "Eng",
    parentId: null,
    coefficient: 2,
    kind: "subject",
    isMain: false,
    sortOrder: 6,
    grades: gradesFor(
      "english",
      DENSE_DAYS.slice(4, 9).map((day, index) => ({
        day: day + 1,
        base: 15.5,
        name: `Written ${index + 1}`,
      })),
      0.05
    ),
  },
  {
    id: "sport",
    name: "Physical Education",
    shortName: "PE",
    parentId: null,
    coefficient: 1,
    kind: "subject",
    isMain: false,
    sortOrder: 7,
    // One grade: nothing to draw a trend from, which is its own card.
    grades: gradesFor(
      "sport",
      [{ day: 40, base: 18 }].map((seed) => ({ ...seed, name: "Endurance" })),
      0
    ),
  },
  {
    id: "music",
    name: "Music",
    shortName: null,
    parentId: null,
    coefficient: 1,
    kind: "subject",
    isMain: false,
    sortOrder: 8,
    // No grades at all: every body's empty state, inside a year that is not empty.
    grades: [],
  },
]

export const fixtureCustomAverages: CustomAverage[] = [
  {
    id: "fixture-stem",
    name: "STEM only",
    entries: [
      { subjectId: "maths", coefficient: null, includeChildren: false },
      { subjectId: "physics", coefficient: 2, includeChildren: false },
      { subjectId: "cs", coefficient: null, includeChildren: false },
    ],
    isMain: false,
    sortOrder: 0,
  },
]

export const fixtureGoals: Goal[] = [
  {
    id: "fixture-goal-reachable",
    name: "Keep the general average above 13",
    kind: "general",
    referenceId: null,
    targetRatio: 0.65,
    periodId: null,
    dueAt: YEAR_END,
    createdAt: YEAR_START,
    achievedAt: null,
    isPinned: true,
    sortOrder: 0,
  },
  {
    // Out of reach on purpose: the plan reddens, which is a different card.
    id: "fixture-goal-impossible",
    name: "Finish History at 19",
    kind: "subject",
    referenceId: "history",
    targetRatio: 0.95,
    periodId: null,
    dueAt: through(0.9),
    createdAt: YEAR_START,
    achievedAt: null,
    isPinned: true,
    sortOrder: 1,
  },
]

/** The payload `snapshot.get` returns, as the year provider consumes it. */
export function fixtureSnapshot() {
  return {
    year: fixtureYear,
    subjects: fixtureSubjects,
    periods: fixturePeriods,
    gradeTypes: fixtureGradeTypes,
    customAverages: fixtureCustomAverages,
    goals: fixtureGoals,
    cards: [],
  }
}

export const FIXTURE_YEAR_ID = YEAR_ID

/**
 * A class to be compared against, and one of its members.
 *
 * The bench's own cohort. Everything else on this page is the reader's own year, and this
 * is the one fixture that stands in for other people — so it is deliberately small and
 * plainly synthetic: six members, names that are obviously not real, and a spread wide
 * enough that a rank is not a tie.
 *
 * Six because five is the floor `cohortStanding` refuses below — a bench that sat exactly
 * on the boundary would pass whichever way the rule went.
 */
/** The group, and the comparison inside it a card actually names. */
export const FIXTURE_GROUP_ID = "fixture-class"
export const FIXTURE_COMPARISON_ID = "fixture-cohort-general"
export const FIXTURE_MEMBER_ID = "fixture-member-2"

/**
 * A friend, with all three locks open.
 *
 * The bench needs one because the friend cards are about somebody else's figures, and
 * "somebody else" is the one thing a fixture of the reader's own year cannot supply. Their
 * subjects deliberately do *not* all match the reader's — two people's trees never do, and
 * a fixture where they matched would hide whether the table handles a row only one side
 * has.
 */
export const fixtureFriend = {
  userId: FIXTURE_MEMBER_ID,
  name: "Amélie",
  scale: 20,
  generalAverage: 0.774,
  subjects: [
    { name: "Mathematics", average: 0.81, gradeCount: 9 },
    { name: "Physics and Chemistry", average: 0.7, gradeCount: 7 },
    { name: "English", average: 0.86, gradeCount: 5 },
    // Not one of the reader's: the table must show it with a dash on their side.
    { name: "Philosophie", average: 0.64, gradeCount: 4 },
  ],
  history: Array.from({ length: 24 }, (_, index) => ({
    at: through(0.05 + (index * 0.9) / 23),
    // A steadier year than the reader's, drifting up: two curves that cross once, which
    // is the case a single number cannot tell you about.
    ratio: 0.72 + index * 0.0026,
  })),
}

export const fixtureCohort = {
  groupId: FIXTURE_COMPARISON_ID,
  name: "Terminale 2 (fixture)",
  memberCount: 9,
  viewerUserId: "fixture-member-0",
  members: [
    { userId: "fixture-member-0", name: "You", average: 0.702 },
    { userId: "fixture-member-1", name: "Camille", average: 0.815 },
    { userId: "fixture-member-2", name: "Amélie", average: 0.774 },
    { userId: "fixture-member-3", name: "Bastien", average: 0.66 },
    { userId: "fixture-member-4", name: "Dylan", average: 0.59 },
    { userId: "fixture-member-5", name: "Éloïse", average: 0.71 },
  ],
}
