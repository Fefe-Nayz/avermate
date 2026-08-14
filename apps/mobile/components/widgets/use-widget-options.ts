import { useMemo } from "react";
import type {
  WidgetFlowContext,
  WidgetFlowOption,
  WidgetSurface,
} from "@avermate/core";
import { FULL_YEAR_PERIOD_ID } from "@avermate/core";
import { useYear } from "@/components/year-provider";

function option(value: string, label: string): WidgetFlowOption {
  return { value, messageKey: label };
}

/** Dynamic reference pools supplied to the core flow resolver. */
export function useWidgetFlowContext(
  surface: WidgetSurface,
): WidgetFlowContext {
  const { subjects, customAverages, goals, periods } = useYear();

  return useMemo(() => {
    const byId = new Map(subjects.map((subject) => [subject.id, subject]));
    const subjectLabel = (id: string): string => {
      const names: string[] = [];
      const seen = new Set<string>();
      let current = byId.get(id);
      while (current && !seen.has(current.id)) {
        seen.add(current.id);
        names.unshift(current.name);
        current = current.parentId ? byId.get(current.parentId) : undefined;
      }
      return names.join(" / ");
    };

    return {
      surface,
      options: {
        subjects: [...subjects]
          .sort((left, right) => left.sortOrder - right.sortOrder)
          .map((subject) => option(subject.id, subjectLabel(subject.id))),
        "custom-averages": [...customAverages]
          .sort((left, right) => left.sortOrder - right.sortOrder)
          .map((average) => option(average.id, average.name)),
        goals: [...goals]
          .sort((left, right) => (left.sortOrder ?? 0) - (right.sortOrder ?? 0))
          .map((goal) => option(goal.id, goal.name)),
        periods: [...periods]
          .filter((period) => period.id !== FULL_YEAR_PERIOD_ID)
          .sort((left, right) => left.sortOrder - right.sortOrder)
          .map((period) => option(period.id, period.name)),
      },
    };
  }, [customAverages, goals, periods, subjects, surface]);
}
