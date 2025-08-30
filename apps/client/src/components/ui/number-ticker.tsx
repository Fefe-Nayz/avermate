"use client";

import { useEffect, useRef, useCallback } from "react";
import { useInView, useMotionValue, useSpring, animate } from "framer-motion";
import { cn } from "@/lib/utils";

interface NumberTickerProps {
  value: number;
  direction?: "up" | "down";
  className?: string;
  delay?: number; // delay in seconds
  decimalPlaces?: number;
  duration?: number; // duration in seconds
  /**
   * Fires whenever the ticker's current value changes.
   */
  onChange?: (currentValue: number) => void;
}

export default function NumberTicker({
  value,
  direction = "up",
  delay = 0,
  className,
  decimalPlaces = 0,
  duration,
  onChange,
}: NumberTickerProps) {
  const ref = useRef<HTMLSpanElement>(null);

  // Start at 0 if going "up", or at 'value' if going "down"
  const startValue = direction === "down" ? value : 0;
  const endValue = direction === "down" ? 0 : value;

  const motionValue = useMotionValue(startValue);

  // If no duration => fallback to a spring
  const springValue = useSpring(motionValue, {
    damping: 20,
    stiffness: 200,
  });

  const isInView = useInView(ref, { once: true, margin: "0px" });

  // For consistent decimal formatting
  const formatter = new Intl.NumberFormat("fr-FR", {
    minimumFractionDigits: decimalPlaces,
    maximumFractionDigits: decimalPlaces,
  });

  const updateDom = useCallback(
    (latest: number) => {
      if (ref.current) {
        // Update text
        ref.current.textContent = formatter.format(
          Number(latest.toFixed(decimalPlaces))
        );
      }
      // Fire onChange callback if provided
      onChange?.(latest);
    },
    [formatter, decimalPlaces, onChange]
  );

  // Trigger the animation once in view, after any delay
  useEffect(() => {
    if (!isInView) return;

    const timeoutId = setTimeout(() => {
      if (duration === undefined) {
        // Use the spring for open-ended timing
        motionValue.set(endValue);
      } else {
        // Animate with a fixed duration
        const controls = animate(motionValue, endValue, {
          duration,
          ease: [0.16, 1, 0.3, 1],
        });
        return () => controls.stop();
      }
    }, delay * 1000);

    return () => clearTimeout(timeoutId);
  }, [isInView, endValue, duration, delay, motionValue]);

  // Subscribe to value changes from either the spring or direct motionValue
  useEffect(() => {
    const activeValue = duration === undefined ? springValue : motionValue;
    const unsubscribe = activeValue.on("change", updateDom);
    return unsubscribe;
  }, [duration, springValue, motionValue, updateDom]);

  // Initialize text on first render
  useEffect(() => {
    updateDom(motionValue.get());
  }, [updateDom, motionValue]);

  return (
    <span
      className={cn("inline-block", className)}
      ref={ref}
    />
  );
}
