import { memo, useMemo, useState } from "react";
import { View } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import { usePalette } from "@/lib/theme";

/**
 * The web's day-per-tick rewind scrubber, translated for touch: one thin
 * tick per day, taller ticks on month starts, and a moving indicator for
 * the shown day. A drag previews as the finger moves and commits only on
 * release, exactly like the web — the ticks themselves never re-render
 * during a drag, only the indicator does.
 */

function clampDay(day: number, totalDays: number): number {
  return Math.max(0, Math.min(totalDays, day));
}

const Ticks = memo(function Ticks({
  totalDays,
  monthStarts,
  baseColor,
  monthColor,
}: {
  totalDays: number;
  monthStarts: readonly number[];
  baseColor: string;
  monthColor: string;
}) {
  const months = useMemo(() => new Set(monthStarts), [monthStarts]);
  return (
    <View
      pointerEvents="none"
      style={{
        flexDirection: "row",
        alignItems: "flex-end",
        justifyContent: "space-between",
        flex: 1,
      }}
    >
      {Array.from({ length: totalDays + 1 }, (_unused, day) => (
        <View
          key={day}
          style={{
            width: 1,
            height: months.has(day) ? 16 : 10,
            backgroundColor: months.has(day) ? monthColor : baseColor,
          }}
        />
      ))}
    </View>
  );
});

export function DayScrubber({
  totalDays,
  selectedDay,
  monthStarts,
  onCommit,
  onPreview,
}: {
  totalDays: number;
  selectedDay: number;
  monthStarts: readonly number[];
  onCommit: (day: number) => void;
  /** Fired as the finger moves; the caller shows the previewed date. */
  onPreview?: (day: number | null) => void;
}) {
  const palette = usePalette();
  const [width, setWidth] = useState(0);
  const [previewDay, setPreviewDay] = useState<number | null>(null);

  const shown = clampDay(previewDay ?? selectedDay, Math.max(1, totalDays));

  const dayAtX = (x: number): number =>
    width <= 0
      ? selectedDay
      : clampDay(Math.round((x / width) * totalDays), totalDays);

  const preview = (day: number) => {
    setPreviewDay(day);
    onPreview?.(day);
  };
  const finish = (commit: number | null) => {
    setPreviewDay(null);
    onPreview?.(null);
    if (commit !== null) onCommit(commit);
  };

  const pan = Gesture.Pan()
    .runOnJS(true)
    .activeOffsetX([-6, 6])
    .failOffsetY([-14, 14])
    .onStart((event) => preview(dayAtX(event.x)))
    .onUpdate((event) => preview(dayAtX(event.x)))
    .onEnd((event, success) => finish(success ? dayAtX(event.x) : null))
    .onFinalize(() => {
      if (previewDay !== null) finish(null);
    });

  const tap = Gesture.Tap()
    .runOnJS(true)
    .maxDuration(280)
    .onEnd((event, success) => {
      if (success) onCommit(dayAtX(event.x));
    });

  const indicatorLeft =
    width > 0 && totalDays > 0 ? (shown / totalDays) * width : 0;

  return (
    <GestureDetector gesture={Gesture.Race(pan, tap)}>
      <View
        accessibilityRole="adjustable"
        accessibilityValue={{ min: 0, max: totalDays, now: shown }}
        onLayout={(event) => setWidth(event.nativeEvent.layout.width)}
        style={{ height: 36, justifyContent: "flex-end" }}
      >
        <Ticks
          totalDays={totalDays}
          monthStarts={monthStarts}
          baseColor={`${palette.textFaint}73`}
          monthColor={`${palette.textMuted}B3`}
        />
        <View
          pointerEvents="none"
          style={{
            position: "absolute",
            bottom: 0,
            left: Math.max(0, Math.min(indicatorLeft - 1, width - 2)),
            width: 2,
            height: 24,
            backgroundColor: palette.accent,
          }}
        />
      </View>
    </GestureDetector>
  );
}
