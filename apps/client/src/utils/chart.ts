export interface ChartDataPoint {
  date?: string;
  average?: number | null;
  [key: string]: number | string | null | undefined;
}

const DAY_IN_MS = 1000 * 60 * 60 * 24;

/**
 * Calculate the Y-axis domain for chart data based on the auto-zoom setting
 * @param data - Array of chart data points
 * @param defaultMin - Default minimum value (e.g., 0)
 * @param defaultMax - Default maximum value (e.g., 20)
 * @param dataKey - Specific key or keys to use for calculation (defaults to 'average')
 * @param autoZoomYAxis - Whether to auto-zoom the Y-axis
 * @returns [min, max] array for Y-axis domain
 */
export function calculateYAxisDomain(
  data: ChartDataPoint[],
  defaultMin: number = 0,
  defaultMax: number = 20,
  dataKey: string | string[] = "average",
  autoZoomYAxis: boolean = true
): [number, number] {
  if (!autoZoomYAxis) {
    return [defaultMin, defaultMax];
  }

  let validValues: number[] = [];

  if (dataKey === "all") {
    data.forEach((point) => {
      Object.entries(point).forEach(([key, value]) => {
        if (key !== "date" && typeof value === "number" && value !== null) {
          validValues.push(value);
        }
      });
    });
  } else {
    const keys = Array.isArray(dataKey) ? dataKey : [dataKey];
    validValues = data.flatMap((point) =>
      keys
        .map((key) => point[key])
        .filter(
          (value): value is number => value !== null && typeof value === "number"
        )
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

export function calculateTrendLineData(
  data: ChartDataPoint[],
  dataKey: string,
  {
    dateKey = "date",
    minValue = 0,
    maxValue = 20,
  }: {
    dateKey?: string;
    minValue?: number;
    maxValue?: number;
  } = {}
): Array<number | null> {
  const validPoints = data
    .map((point, index) => {
      const rawValue = point[dataKey];
      const rawDate = point[dateKey];

      if (typeof rawValue !== "number" || typeof rawDate !== "string") {
        return null;
      }

      const timestamp = new Date(rawDate).getTime();
      if (!Number.isFinite(timestamp)) {
        return null;
      }

      return { index, x: timestamp, y: rawValue };
    })
    .filter(
      (point): point is { index: number; x: number; y: number } => point !== null
    );

  if (validPoints.length < 2) {
    return data.map(() => null);
  }

  const firstX = validPoints[0].x;
  const normalizedPoints = validPoints.map((point) => ({
    ...point,
    x: (point.x - firstX) / DAY_IN_MS,
  }));

  const count = normalizedPoints.length;
  const sumX = normalizedPoints.reduce((total, point) => total + point.x, 0);
  const sumY = normalizedPoints.reduce((total, point) => total + point.y, 0);
  const sumXY = normalizedPoints.reduce(
    (total, point) => total + point.x * point.y,
    0
  );
  const sumX2 = normalizedPoints.reduce(
    (total, point) => total + point.x * point.x,
    0
  );

  const denominator = count * sumX2 - sumX * sumX;
  if (denominator === 0) {
    return data.map(() => null);
  }

  const slope = (count * sumXY - sumX * sumY) / denominator;
  const intercept = (sumY - slope * sumX) / count;
  const firstIndex = validPoints[0].index;
  const lastIndex = validPoints[validPoints.length - 1].index;

  return data.map((point, index) => {
    if (index < firstIndex || index > lastIndex) {
      return null;
    }

    const rawDate = point[dateKey];
    if (typeof rawDate !== "string") {
      return null;
    }

    const timestamp = new Date(rawDate).getTime();
    if (!Number.isFinite(timestamp)) {
      return null;
    }

    const normalizedX = (timestamp - firstX) / DAY_IN_MS;
    const predictedValue = intercept + slope * normalizedX;

    return Math.min(maxValue, Math.max(minValue, predictedValue));
  });
}
