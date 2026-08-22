import { describe, expect, test } from "bun:test";
import { SubjectGraph } from "./graph";
import { createWidgetDefinition } from "./widget-defaults";
import { evaluateWidgetDefinition } from "./widget-evaluator";
import type { FriendContext } from "./friend";
import type { Grade, Subject } from "./types";
import type { WidgetDefinition, WidgetEvaluationContext } from "./widget-types";

/**
 * Two curves on one axis have to be over one span.
 *
 * The reader's line is walked here, over the window the card is scoped to; their friend's
 * arrives from the server sampled across that friend's whole year, because the server has
 * no idea what the reader is looking at. Drawn untouched, a card scoped to one term put
 * the reader's term beside their friend's September-to-June and presented it as a
 * comparison.
 */

function grade(id: string, value: number, at: Date): Grade {
  return {
    id,
    name: id,
    value,
    outOf: 20,
    coefficient: 1,
    passedAt: at,
    createdAt: at,
    subjectId: "maths",
    periodId: null,
    typeId: null,
    note: null,
    components: [],
  };
}

const subjects: Subject[] = [
  {
    id: "maths",
    name: "Mathematics",
    shortName: null,
    parentId: null,
    coefficient: 1,
    kind: "subject",
    isMain: true,
    sortOrder: 0,
    grades: [
      grade("autumn", 12, new Date(2026, 9, 10)),
      grade("winter", 14, new Date(2027, 0, 20)),
      grade("spring", 16, new Date(2027, 2, 10)),
    ],
  },
];

const friend: FriendContext = {
  userId: "friend-1",
  name: "Amélie",
  scale: 20,
  generalAverage: 0.7,
  subjects: [],
  history: [
    { at: new Date(2026, 8, 15), ratio: 0.5 },
    { at: new Date(2026, 11, 15), ratio: 0.6 },
    { at: new Date(2027, 1, 15), ratio: 0.7 },
    { at: new Date(2027, 5, 15), ratio: 0.9 },
  ],
};

function context(from: Date, to: Date): WidgetEvaluationContext {
  const graph = new SubjectGraph(subjects);
  return {
    surface: "insights",
    graph,
    subjects,
    scope: null,
    from,
    to,
    year: {
      startsAt: new Date(2026, 8, 1),
      endsAt: new Date(2027, 6, 1),
      scale: 20,
    },
    yearSubjects: subjects,
    periods: [],
    customAverages: [],
    goals: [],
    gradeTypes: [],
    friends: new Map([[friend.userId, friend]]),
    passingRatio: 0.5,
    now: new Date(2027, 3, 1),
    resolveTarget: () => ({ graph, subjects, scope: null, subjectId: null }),
  };
}

const curves: WidgetDefinition = (() => {
  const definition = createWidgetDefinition("insights");
  definition.analysis.measures = [
    {
      id: "measure",
      label: null,
      expression: {
        kind: "metric",
        metric: "friendCurves",
        goalId: null,
        memberId: friend.userId,
      },
    },
  ];
  // The comparison *is* the card: `friendCurves` groups by nothing, and the two lines
  // are its own reading rather than an axis the analysis asked for — so the channels a
  // grouped series would fill in are cleared with it.
  definition.analysis.dimensions = [];
  definition.visualization.encoding.x = null;
  definition.visualization.encoding.y = null;
  definition.visualization.recipe = "line";
  return definition;
})();

const theirs = (from: Date, to: Date) => {
  const result = evaluateWidgetDefinition(curves, context(from, to));
  if (result.kind !== "structured" || result.value.kind !== "curves") return null;
  return result.value.theirs;
};

describe("a friend's curve on the reader's axis", () => {
  test("keeps only the part of their record the window covers", () => {
    // A card scoped to the second term: one of their four points falls inside it.
    expect(
      theirs(new Date(2027, 0, 1), new Date(2027, 3, 1))?.map(
        (point) => point.ratio,
      ),
    ).toEqual([0.7]);
  });

  test("keeps all of it when the window is the year", () => {
    expect(theirs(new Date(2026, 8, 1), new Date(2027, 6, 1))).toHaveLength(4);
  });

  test("keeps none of it rather than borrowing from outside", () => {
    /**
     * Their record simply does not cover this window, so the card draws one line. The
     * alternative — showing their September point beside the reader's June — is the bug
     * this exists to prevent, and it is worse than an honest single line.
     */
    expect(theirs(new Date(2027, 3, 1), new Date(2027, 5, 1))).toEqual([]);
  });
});
