import { useSyncExternalStore } from "react";

export type ChartLineStyle = "smooth" | "straight" | "step";

export interface ChartSettings {
  autoZoom: boolean;
  connectGrades: boolean;
  lineStyle: ChartLineStyle;
  showTrend: boolean;
  trendSubdivisions: number;
  showPoints: boolean;
  showSubSubjects: boolean;
}

export const DEFAULT_CHART_SETTINGS: ChartSettings = {
  autoZoom: true,
  connectGrades: false,
  lineStyle: "smooth",
  showTrend: false,
  trendSubdivisions: 1,
  showPoints: true,
  showSubSubjects: true,
};

const LINE_STYLES: readonly ChartLineStyle[] = ["smooth", "straight", "step"];

/** What older clients and the server may hand over: the new knobs optional. */
export type ChartSettingsInput = Omit<
  ChartSettings,
  "lineStyle" | "connectGrades"
> & {
  lineStyle?: ChartLineStyle;
  connectGrades?: boolean;
};

let current = DEFAULT_CHART_SETTINGS;
let revision = 0;
const listeners = new Set<() => void>();

export function setChartSettings(value: ChartSettingsInput): void {
  const next: ChartSettings = {
    ...value,
    connectGrades: value.connectGrades === true,
    lineStyle:
      value.lineStyle && LINE_STYLES.includes(value.lineStyle)
        ? value.lineStyle
        : DEFAULT_CHART_SETTINGS.lineStyle,
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
