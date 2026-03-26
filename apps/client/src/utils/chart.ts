export interface ChartDataPoint {
  date?: string;
  average?: number | null;
  [key: string]: number | string | null | undefined;
}

const DAY_IN_MS = 1000 * 60 * 60 * 24;

export function getVisibleChartEndDate(
  periodEndDate: Date,
  options?: {
    snapshotDate?: Date | null;
    now?: Date;
  }
) {
  const now = options?.now ?? new Date();
  const cappedEndDate =
    periodEndDate.getTime() > now.getTime() ? now : periodEndDate;
  const snapshotDate = options?.snapshotDate;

  if (!snapshotDate) {
    return cappedEndDate;
  }

  return snapshotDate.getTime() < cappedEndDate.getTime()
    ? snapshotDate
    : cappedEndDate;
}

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

function linearRegression(points: { x: number; y: number }[]): {
  slope: number;
  intercept: number;
} {
  const n = points.length;
  const sumX = points.reduce((s, p) => s + p.x, 0);
  const sumY = points.reduce((s, p) => s + p.y, 0);
  const sumXY = points.reduce((s, p) => s + p.x * p.y, 0);
  const sumX2 = points.reduce((s, p) => s + p.x * p.x, 0);
  const denom = n * sumX2 - sumX * sumX;
  if (denom === 0) {
    return { slope: 0, intercept: sumY / n };
  }
  return {
    slope: (n * sumXY - sumX * sumY) / denom,
    intercept: (sumY - (((n * sumXY - sumX * sumY) / denom) * sumX)) / n,
  };
}

export function calculateTrendLineData(
  data: ChartDataPoint[],
  dataKey: string,
  {
    dateKey = "date",
    minValue = 0,
    maxValue = 20,
    subdivisions = 1,
  }: {
    dateKey?: string;
    minValue?: number;
    maxValue?: number;
    /** Number of piecewise segments (1 = single global regression, higher = more local) */
    subdivisions?: number;
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

  const n = normalizedPoints.length;
  const k = Math.min(Math.max(1, Math.round(subdivisions)), n);

  // Build piecewise segment regressions
  const segments: Array<{
    endX: number;
    slope: number;
    intercept: number;
  }> = [];

  for (let seg = 0; seg < k; seg++) {
    const ptStart = Math.floor((seg * n) / k);
    const ptEnd = Math.min(Math.floor(((seg + 1) * n) / k) - 1, n - 1);
    const segPts = normalizedPoints.slice(ptStart, ptEnd + 1);

    if (segPts.length === 0) continue;

    const endX = normalizedPoints[ptEnd].x;

    if (segPts.length === 1) {
      segments.push({ endX, slope: 0, intercept: segPts[0].y });
    } else {
      const { slope, intercept } = linearRegression(segPts);
      segments.push({ endX, slope, intercept });
    }
  }

  const firstIndex = validPoints[0].index;
  const lastIndex = validPoints[n - 1].index;

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

    // Find the segment this x falls into (first segment whose endX >= normalizedX)
    let seg = segments[segments.length - 1];
    for (const s of segments) {
      if (normalizedX <= s.endX) {
        seg = s;
        break;
      }
    }

    const predicted = seg.intercept + seg.slope * normalizedX;
    return Math.min(maxValue, Math.max(minValue, predicted));
  });
}
