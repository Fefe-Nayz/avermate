// "use client";

// import { useEffect, useRef, useCallback } from "react";
// import { useInView, useMotionValue, useSpring, animate } from "framer-motion";
// import { cn } from "@/lib/utils";

// interface NumberTickerProps {
//   value: number;
//   direction?: "up" | "down";
//   className?: string;
//   delay?: number; // delay in seconds
//   decimalPlaces?: number;
//   duration?: number; // duration in seconds
//   /**
//    * Fires whenever the ticker's current value changes.
//    */
//   onChange?: (currentValue: number) => void;
// }

// export default function NumberTicker({
//   value,
//   direction = "up",
//   delay = 0,
//   className,
//   decimalPlaces = 0,
//   duration,
//   onChange,
// }: NumberTickerProps) {
//   const ref = useRef<HTMLSpanElement>(null);

//   // Start at 0 if going "up", or at 'value' if going "down"
//   const startValue = direction === "down" ? value : 0;
//   const endValue = direction === "down" ? 0 : value;

//   const motionValue = useMotionValue(startValue);

//   // If no duration => fallback to a spring
//   const springValue = useSpring(motionValue, {
//     damping: 20,
//     stiffness: 200,
//   });

//   const isInView = useInView(ref, { once: true, margin: "0px" });

//   // For consistent decimal formatting
//   const formatter = new Intl.NumberFormat("fr-FR", {
//     minimumFractionDigits: decimalPlaces,
//     maximumFractionDigits: decimalPlaces,
//   });

//   const updateDom = useCallback(
//     (latest: number) => {
//       if (ref.current) {
//         // Update text
//         ref.current.textContent = formatter.format(
//           Number(latest.toFixed(decimalPlaces))
//         );
//       }
//       // Fire onChange callback if provided
//       onChange?.(latest);
//     },
//     [formatter, decimalPlaces, onChange]
//   );

//   // Trigger the animation once in view, after any delay
//   useEffect(() => {
//     if (!isInView) return;

//     const timeoutId = setTimeout(() => {
//       if (duration === undefined) {
//         // Use the spring for open-ended timing
//         motionValue.set(endValue);
//       } else {
//         // Animate with a fixed duration
//         const controls = animate(motionValue, endValue, {
//           duration,
//           ease: [0.16, 1, 0.3, 1],
//         });
//         return () => controls.stop();
//       }
//     }, delay * 1000);

//     return () => clearTimeout(timeoutId);
//   }, [isInView, endValue, duration, delay, motionValue]);

//   // Subscribe to value changes from either the spring or direct motionValue
//   useEffect(() => {
//     const activeValue = duration === undefined ? springValue : motionValue;
//     const unsubscribe = activeValue.on("change", updateDom);
//     return unsubscribe;
//   }, [duration, springValue, motionValue, updateDom]);

//   // Initialize text on first render
//   useEffect(() => {
//     updateDom(motionValue.get());
//   }, [updateDom, motionValue]);

//   return (
//     <span
//       className={cn("inline-block", className)}
//       ref={ref}
//     />
//   );
// }

"use client";

import NumberFlow, { continuous } from "@number-flow/react";
import { motion, useInView } from "motion/react";
import { useEffect, useState, useRef } from "react";

const MotionNumberFlow = motion.create(NumberFlow);

interface NumberTickerProps {
  value: number;
  decimalPlaces?: number;
  duration?: number; // seconds
  onChange?: (currentValue: number) => void;
  className?: string;
  style?: React.CSSProperties;
  triggerOnView?: boolean; // New prop to control view-based animation
}

export default function NumberTicker({
  value,
  decimalPlaces = 0,
  duration = 2,
  onChange,
  className,
  style,
  triggerOnView = false,
}: NumberTickerProps) {
  const [displayValue, setDisplayValue] = useState(0);
  const ref = useRef<HTMLSpanElement>(null);
  const isInView = useInView(ref, { once: true, margin: "0px" });

  useEffect(() => {
    if (triggerOnView) {
      // Only animate when in view
      if (isInView) {
        const t = setTimeout(() => setDisplayValue(value), 0);
        return () => clearTimeout(t);
      }
    } else {
      // Original behavior - animate immediately
      const t = setTimeout(() => setDisplayValue(value), 0);
      return () => clearTimeout(t);
    }
  }, [value, isInView, triggerOnView]);

  const handleAnimationsFinish = () => {
    onChange?.(value);
  };

  return (
    <span ref={ref} className="inline-block">
      <MotionNumberFlow
        plugins={[continuous]}
        value={displayValue}
        // If you want fixed decimals, uncomment:
        // format={{ minimumFractionDigits: decimalPlaces, maximumFractionDigits: decimalPlaces }}
        // If you want to slow down/speed up the digit roll, uncomment:
        // transformTiming={{ duration: duration * 1000, easing: "ease-out" }}
        onAnimationsFinish={handleAnimationsFinish}
        /** KEY: allow container layout animation to pick up width changes from NumberFlow */
        layout
        layoutRoot
        className={className}
        style={style}
      />
    </span>
  );
}
