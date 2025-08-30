"use client";

import { useState } from "react";
import { useTheme } from "next-themes";
import NumberTicker from "@/components/ui/number-ticker";
import { cn } from "@/lib/utils";

interface GradientStop {
  stop: number;
  color: [number, number, number];
}

const DARK_TEXT_GRADIENT_STOPS: GradientStop[] = [
  { stop: 0,   color: [255, 0, 0] },
  { stop: 25,  color: [255, 181, 0] },
  { stop: 50,  color: [145, 145, 145] },
  { stop: 75,  color: [0, 255, 241] },
  { stop: 100, color: [0, 255, 6] },
];

const DARK_BACKGROUND_GRADIENT_STOPS: GradientStop[] = [
  { stop: 0,   color: [68, 0, 0] },
  { stop: 25,  color: [119, 84, 0] },
  { stop: 50,  color: [55, 55, 55] },
  { stop: 75,  color: [0, 105, 99] },
  { stop: 100, color: [0, 111, 3] },
];

const LIGHT_TEXT_GRADIENT_STOPS: GradientStop[] = [
  { stop: 0,   color: [220, 0, 0] },
  { stop: 25,  color: [230, 140, 0] },
  { stop: 50,  color: [100, 100, 100] },
  { stop: 75,  color: [0, 170, 200] },
  { stop: 100, color: [0, 180, 0] },
];

const LIGHT_BACKGROUND_GRADIENT_STOPS: GradientStop[] = [
  { stop: 0,   color: [255, 220, 220] },
  { stop: 25,  color: [255, 240, 200] },
  { stop: 50,  color: [240, 240, 240] },
  { stop: 75,  color: [220, 255, 255] },
  { stop: 100, color: [220, 255, 220] },
];

function interpolateColorFromStops(
  stops: GradientStop[],
  ratio01: number
): string {
  const t = ratio01 * 100;

  for (let i = 0; i < stops.length - 1; i++) {
    const current = stops[i];
    const next = stops[i + 1];
    if (t >= current.stop && t <= next.stop) {
      const range = next.stop - current.stop;
      const localT = (t - current.stop) / range;
      const r = Math.round(current.color[0] + (next.color[0] - current.color[0]) * localT);
      const g = Math.round(current.color[1] + (next.color[1] - current.color[1]) * localT);
      const b = Math.round(current.color[2] + (next.color[2] - current.color[2]) * localT);
      return `rgb(${r}, ${g}, ${b})`;
    }
  }

  // Edge cases: if t < first stop or > last stop
  if (t <= stops[0].stop) {
    const [r, g, b] = stops[0].color;
    return `rgb(${r}, ${g}, ${b})`;
  }
  const [r, g, b] = stops[stops.length - 1].color;
  return `rgb(${r}, ${g}, ${b})`;
}

function getRatioFromDiff(diff: number, maxRange = 1): number {
  const clamped = Math.max(-maxRange, Math.min(diff, maxRange));
  return (clamped + maxRange) / (2 * maxRange);
}

export function DifferenceBadge({ diff }: { diff: number }) {
  const [animatedDiff, setAnimatedDiff] = useState(diff);
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === 'dark';

  const ratio = getRatioFromDiff(animatedDiff, 1);

  const textGradientStops = isDark ? DARK_TEXT_GRADIENT_STOPS : LIGHT_TEXT_GRADIENT_STOPS;
  const backgroundGradientStops = isDark ? DARK_BACKGROUND_GRADIENT_STOPS : LIGHT_BACKGROUND_GRADIENT_STOPS;

  const textColor = interpolateColorFromStops(textGradientStops, ratio);
  const backgroundColor = interpolateColorFromStops(backgroundGradientStops, ratio);

  return (
    <div className="py-2">
      <span
        className={cn("px-2 py-1 rounded-lg text-xl md:text-3xl")}
        style={{
          color: textColor,
          backgroundColor,
        }}
      >
        {animatedDiff > 0 && "+"}
        <NumberTicker
          decimalPlaces={3}
          value={diff}
          duration={2}
          onChange={(val) => setAnimatedDiff(val)}
        />
      </span>
    </div>
  );
}
