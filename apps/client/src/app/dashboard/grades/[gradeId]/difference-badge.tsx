"use client";

import { useLayoutEffect, useRef, useState } from "react";
import { useTheme } from "next-themes";
import { motion, MotionConfig } from "motion/react";
import { useCanAnimate } from "@number-flow/react";
import NumberTicker from "@/components/ui/number-ticker";
import { cn } from "@/lib/utils";

interface GradientStop { stop: number; color: [number, number, number]; }

const DARK_TEXT_GRADIENT_STOPS: GradientStop[] = [
  { stop: 0, color: [255, 0, 0] },
  { stop: 25, color: [255, 181, 0] },
  { stop: 50, color: [145, 145, 145] },
  { stop: 75, color: [0, 255, 241] },
  { stop: 100, color: [0, 255, 6] },
];
const DARK_BACKGROUND_GRADIENT_STOPS: GradientStop[] = [
  { stop: 0, color: [68, 0, 0] },
  { stop: 25, color: [119, 84, 0] },
  { stop: 50, color: [55, 55, 55] },
  { stop: 75, color: [0, 105, 99] },
  { stop: 100, color: [0, 111, 3] },
];
const LIGHT_TEXT_GRADIENT_STOPS: GradientStop[] = [
  { stop: 0, color: [220, 0, 0] },
  { stop: 25, color: [230, 140, 0] },
  { stop: 50, color: [100, 100, 100] },
  { stop: 75, color: [0, 170, 200] },
  { stop: 100, color: [0, 180, 0] },
];
const LIGHT_BACKGROUND_GRADIENT_STOPS: GradientStop[] = [
  { stop: 0, color: [255, 220, 220] },
  { stop: 25, color: [255, 240, 200] },
  { stop: 50, color: [240, 240, 240] },
  { stop: 75, color: [220, 255, 255] },
  { stop: 100, color: [220, 255, 220] },
];

function interpolateColorFromStops(stops: GradientStop[], ratio01: number) {
  const t = ratio01 * 100;
  for (let i = 0; i < stops.length - 1; i++) {
    const a = stops[i], b = stops[i + 1];
    if (t >= a.stop && t <= b.stop) {
      const lt = (t - a.stop) / (b.stop - a.stop);
      const r = Math.round(a.color[0] + (b.color[0] - a.color[0]) * lt);
      const g = Math.round(a.color[1] + (b.color[1] - a.color[1]) * lt);
      const bl = Math.round(a.color[2] + (b.color[2] - a.color[2]) * lt);
      return `rgb(${r}, ${g}, ${bl})`;
    }
  }
  const [r, g, b] = t <= stops[0].stop ? stops[0].color : stops[stops.length - 1].color;
  return `rgb(${r}, ${g}, ${b})`;
}

function getRatioFromDiff(diff: number, maxRange = 1) {
  const clamped = Math.max(-maxRange, Math.min(diff, maxRange));
  return (clamped + maxRange) / (2 * maxRange);
}

/** Observe live content width (works during NumberFlow animations). */
function useMeasuredWidth<T extends HTMLElement>() {
  const ref = useRef<T | null>(null);
  const [width, setWidth] = useState<number>(0);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => setWidth(Math.ceil(el.getBoundingClientRect().width));
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    window.addEventListener("resize", measure);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, []);

  return [ref, width] as const;
}

export function DifferenceBadge({ diff }: { diff: number }) {
  const [animatedDiff, setAnimatedDiff] = useState(diff);
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === "dark";
  const canAnimate = useCanAnimate();

  const ratio = getRatioFromDiff(animatedDiff, 1);
  const textColor = interpolateColorFromStops(
    isDark ? DARK_TEXT_GRADIENT_STOPS : LIGHT_TEXT_GRADIENT_STOPS,
    ratio
  );
  const backgroundColor = interpolateColorFromStops(
    isDark ? DARK_BACKGROUND_GRADIENT_STOPS : LIGHT_BACKGROUND_GRADIENT_STOPS,
    ratio
  );

  // Measure the REAL content (sign + NumberTicker) and animate wrapper width to it.
  const [contentRef, contentWidth] = useMeasuredWidth<HTMLSpanElement>();

  return (
    <div className="py-2">
      <MotionConfig
        transition={{
          // springy but stable; disabled if NumberFlow can't animate
          layout: canAnimate ? { type: "spring", duration: 0.6, bounce: 0 } : { duration: 0 },
        }}
      >
        <motion.span
          className={cn(
            "inline-block rounded-lg", // pill
            "overflow-hidden" // hides content while width animates smaller
          )}
          // Animate the pill's width to match the live content width
          initial={false}
          animate={{ width: contentWidth || "auto" }}
          style={{
            backgroundColor,
            color: textColor,
            // Optional: GPU hint for smoother width animations
            willChange: "width",
          }}
          // If you prefer layout projection, you can also keep layout
          // layout
        >
          {/* Actual content we measure. Keep padding here so it's included in measured width. */}
          <span
            ref={contentRef}
            className="inline-flex items-center whitespace-nowrap px-2 py-1 text-xl md:text-3xl font-semibold leading-none"
          >
            {animatedDiff > 0 && "+"}
            <NumberTicker
              decimalPlaces={3}
              value={diff}
              duration={2}
              className="leading-none"
              onChange={(val) => setAnimatedDiff(val)}
            />
          </span>
        </motion.span>
      </MotionConfig>
    </div>
  );
}
