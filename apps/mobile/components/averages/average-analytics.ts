import {
  consistency,
  gradeRatios,
  median,
  passRate,
  resolveCustomAverage,
  subjectImpact,
  type CustomAverage,
  type Grade,
  type Impact,
  type Ratio,
  type Scope,
  type Subject,
  type SubjectGraph,
} from "@avermate/core";

export interface AverageCompositionItem {
  coefficient: number;
  ratio: Ratio;
  subject: Subject;
}

export interface AverageImpactItem {
  impact: Impact;
  subject: Subject;
}

export interface AverageAnalytics {
  composition: AverageCompositionItem[];
  consistency: number | null;
  custom: CustomAverage | null;
  grades: Grade[];
  impacts: AverageImpactItem[];
  median: number | null;
  passRate: number | null;
  ratio: Ratio;
  resolvedGraph: SubjectGraph;
  scope: Scope;
}

/**
 * Resolve the selected general or custom average from the hydrated snapshot.
 * Keeping this pure makes the overview, detail screen and tests agree on
 * custom coefficients without introducing a second mobile request.
 */
export function averageAnalytics(
  graph: SubjectGraph,
  averageId: string,
  customAverages: readonly CustomAverage[],
  passingRatio: number,
): AverageAnalytics | null {
  const isGeneral = averageId === "general";
  const custom = isGeneral
    ? null
    : (customAverages.find((average) => average.id === averageId) ?? null);
  if (!isGeneral && !custom) return null;

  const resolved = custom
    ? resolveCustomAverage(graph, custom)
    : { graph, scope: {} satisfies Scope };
  const contributors = resolved.graph.contributorsOf(null);
  const ratios = gradeRatios(resolved.graph);
  const grades = resolved.graph.allGrades().slice().reverse();

  const composition = custom
    ? custom.entries.flatMap((entry): AverageCompositionItem[] => {
        const subject = graph.byId(entry.subjectId);
        if (!subject || !resolved.graph.has(subject.id)) return [];
        return [
          {
            coefficient: entry.coefficient ?? subject.coefficient,
            ratio: resolved.graph.ratio(subject.id, resolved.scope),
            subject,
          },
        ];
      })
    : contributors.map((subject) => ({
        coefficient: subject.coefficient,
        ratio: graph.ratio(subject.id),
        subject,
      }));

  return {
    composition,
    consistency: consistency(ratios),
    custom,
    grades,
    impacts: contributors.map((subject) => ({
      impact: subjectImpact(resolved.graph, subject.id, null, resolved.scope),
      subject,
    })),
    median: median(ratios),
    passRate: passRate(ratios, passingRatio),
    ratio: resolved.graph.ratio(null, resolved.scope),
    resolvedGraph: resolved.graph,
    scope: resolved.scope,
  };
}
