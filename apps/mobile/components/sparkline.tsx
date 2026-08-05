import { useState } from "react";
import { View } from "react-native";
import Svg, { Defs, LinearGradient, Path, Stop } from "react-native-svg";
import type { SeriesPoint } from "@avermate/core";
import { usePalette } from "@/lib/theme";

/**
 * The year, as one line.
 *
 * No axes, no grid, no tooltip: at this size they would be noise. The shape is
 * the message — climbing, flat, or slipping — and the exact numbers live one
 * screen deeper. The y-range fits the data rather than the full scale, because
 * a year spent between 12 and 14 is a flat line on a 0–20 axis.
 */
export function Sparkline({
  series,
  height = 72,
  positive = true,
}: {
  series: SeriesPoint[];
  height?: number;
  positive?: boolean;
}) {
  const palette = usePalette();
  // Measured rather than assumed: a viewBox scaled to fit would either letterbox
  // or stretch the stroke, and both look like a mistake at this size.
  const [width, setWidth] = useState(0);

  const points = series.filter(
    (point): point is { date: Date; ratio: number } => point.ratio !== null,
  );

  const ready = points.length >= 2 && width > 0;
  const padding = 4;

  let line = "";
  let area = "";

  if (ready) {
    const values = points.map((point) => point.ratio);
    const min = Math.min(...values);
    const max = Math.max(...values);
    const span = max - min || 1;

    const x = (index: number) =>
      padding + (index / (points.length - 1)) * (width - padding * 2);
    const y = (value: number) =>
      height - padding - ((value - min) / span) * (height - padding * 2);

    // A light Catmull-Rom smoothing: enough to look drawn rather than plotted,
    // not enough to invent movement that is not in the data.
    line = `M ${x(0)} ${y(values[0] as number)}`;
    for (let index = 1; index < points.length; index += 1) {
      const previousX = x(index - 1);
      const previousY = y(values[index - 1] as number);
      const currentX = x(index);
      const currentY = y(values[index] as number);
      const midX = (previousX + currentX) / 2;
      line += ` C ${midX} ${previousY}, ${midX} ${currentY}, ${currentX} ${currentY}`;
    }
    area = `${line} L ${x(points.length - 1)} ${height} L ${x(0)} ${height} Z`;
  }

  const stroke = positive ? palette.positive : palette.negative;

  return (
    <View
      style={{ height }}
      onLayout={(event) => setWidth(event.nativeEvent.layout.width)}
    >
      {ready ? (
        <Svg width={width} height={height}>
          <Defs>
            <LinearGradient id="spark" x1="0" y1="0" x2="0" y2="1">
              <Stop offset="0" stopColor={stroke} stopOpacity={0.18} />
              <Stop offset="1" stopColor={stroke} stopOpacity={0} />
            </LinearGradient>
          </Defs>
          <Path d={area} fill="url(#spark)" />
          <Path
            d={line}
            stroke={stroke}
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
            fill="none"
          />
        </Svg>
      ) : null}
    </View>
  );
}
