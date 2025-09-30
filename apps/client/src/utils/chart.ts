import { getChartSettings } from "@/hooks/use-chart-settings";

export interface ChartDataPoint {
  date?: string;
  average?: number | null;
  [key: string]: number | string | null | undefined;
}

/**
 * Calculate the Y-axis domain for chart data based on the auto-zoom setting
 * @param data - Array of chart data points
 * @param defaultMin - Default minimum value (e.g., 0)
 * @param defaultMax - Default maximum value (e.g., 20)
 * @param dataKey - Specific key to use for calculation (defaults to 'average')
 * @returns [min, max] array for Y-axis domain
 */
export function calculateYAxisDomain(
  data: ChartDataPoint[],
  defaultMin: number = 0,
  defaultMax: number = 20,
  dataKey: string = "average"
): [number, number] {
  const settings = getChartSettings();

  if (!settings.autoZoomYAxis) {
    return [defaultMin, defaultMax];
  }

  // Extract numeric values from the specified key or all numeric properties
  let validValues: number[] = [];

  if (dataKey === "all") {
    // Use all numeric properties
    data.forEach((point) => {
      Object.entries(point).forEach(([key, value]) => {
        if (key !== "date" && typeof value === "number" && value !== null) {
          validValues.push(value);
        }
      });
    });
  } else {
    // Use specific key
    validValues = data
      .map((point) => (point as any)[dataKey])
      .filter(
        (value): value is number => value !== null && typeof value === "number"
      );
  }

  if (validValues.length === 0) {
    return [defaultMin, defaultMax];
  }

  // Calculate min and max with a small margin
  const minValue = Math.min(...validValues);
  const maxValue = Math.max(...validValues);

  // Add margin (10% of the range, but at least 0.5)
  const range = maxValue - minValue;
  const margin = Math.max(range * 0.1, 0.5);

  const min = Math.max(defaultMin, minValue - margin);
  const max = Math.min(defaultMax, maxValue + margin);

  return [Math.floor(min), Math.ceil(max)];
}
