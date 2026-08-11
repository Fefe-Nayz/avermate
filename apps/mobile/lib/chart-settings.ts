import { useSyncExternalStore } from "react";

export interface ChartSettings {
  autoZoom: boolean;
  showTrend: boolean;
  trendSubdivisions: number;
  showPoints: boolean;
  showSubSubjects: boolean;
}

export const DEFAULT_CHART_SETTINGS: ChartSettings = {
  autoZoom: true,
  showTrend: false,
  trendSubdivisions: 1,
  showPoints: true,
  showSubSubjects: true,
};

let current = DEFAULT_CHART_SETTINGS;
let revision = 0;
const listeners = new Set<() => void>();

export function setChartSettings(value: ChartSettings): void {
  const next = {
    ...value,
    trendSubdivisions: Math.max(1, Math.min(12, value.trendSubdivisions)),
  };
  if (JSON.stringify(current) === JSON.stringify(next)) return;
  current = next;
  revision += 1;
  for (const listener of listeners) listener();
}

export function chartSettings(): ChartSettings {
  return current;
}

export function chartChildren<T>(
  children: readonly T[],
  showSubSubjects: boolean,
): readonly T[] {
  return showSubSubjects ? children : [];
}

export function useChartSettings(): ChartSettings {
  useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => revision,
    () => 0,
  );
  return current;
}
