import { useMemo, useState } from "react";
import { Text, View } from "react-native";
import Svg, { G, Line, Polygon, Text as SvgText } from "react-native-svg";
import { Card } from "@/components/ui";
import { t } from "@/lib/i18n";
import { numeric, radius, space, type, usePalette } from "@/lib/theme";
import { radarScene, type RadarPoint } from "./subject-radar-geometry";

/**
 * The headline subjects on one comparable radial scale — the same chart the
 * web dashboard draws, with the same folded spoke labels. A tap reads the
 * nearest subject's value, standing in for the web's hover tooltip.
 */
export function SubjectRadar({
  points,
  scale,
  formatValue,
  height = 340,
}: {
  points: readonly RadarPoint[];
  scale: number;
  formatValue: (value: number) => string;
  height?: number;
}) {
  const palette = usePalette();
  const [width, setWidth] = useState(0);
  const [focused, setFocused] = useState<number | null>(null);

  const scene = useMemo(
    () => (width > 0 ? radarScene({ points, scale, width, height }) : null),
    [height, points, scale, width],
  );

  if (points.length < 3) return null;

  const focusedVertex =
    scene && focused !== null ? scene.vertices[focused] : undefined;

  return (
    <Card style={{ paddingHorizontal: space.sm }}>
      <View
        onLayout={(event) => setWidth(event.nativeEvent.layout.width)}
        onStartShouldSetResponder={() => true}
        onResponderRelease={(event) => {
          if (!scene) return;
          const { locationX, locationY } = event.nativeEvent;
          let best: number | null = null;
          let bestDistance = Number.POSITIVE_INFINITY;
          scene.vertices.forEach((vertex, index) => {
            const distance = Math.hypot(
              vertex.x - locationX,
              vertex.y - locationY,
            );
            if (distance < bestDistance) {
              bestDistance = distance;
              best = index;
            }
          });
          setFocused((current) => (current === best ? null : best));
        }}
        style={{ height }}
      >
        {scene ? (
          <Svg height={height} width={width}>
            <G>
              {scene.gridRings.map((ringLine) => (
                <Polygon
                  fill="none"
                  key={`ring-${ringLine.value}`}
                  points={ringLine.points}
                  stroke={palette.text}
                  strokeOpacity={0.2}
                  strokeWidth={1}
                />
              ))}
              {scene.spokes.map((spoke) => (
                <Line
                  key={`spoke-${spoke.key}`}
                  stroke={palette.text}
                  strokeOpacity={0.2}
                  strokeWidth={1}
                  x1={scene.cx}
                  x2={spoke.x}
                  y1={scene.cy}
                  y2={spoke.y}
                />
              ))}
              <Polygon
                fill={palette.chart1}
                fillOpacity={0.1}
                points={scene.area}
                stroke={palette.chart1}
                strokeWidth={2}
              />
              {scene.gridLabels.map((label) => (
                <SvgText
                  fill={palette.text}
                  fillOpacity={0.6}
                  fontSize={10}
                  key={`grid-${label.value}`}
                  x={label.x}
                  y={label.y + 3}
                >
                  {formatValue(label.value)}
                </SvgText>
              ))}
              {scene.labels.map((label) => (
                <SvgText
                  fill={palette.text}
                  fontSize={scene.fontSize}
                  key={label.key}
                  textAnchor={label.anchor}
                  transform={`rotate(${label.rotation} ${label.x} ${label.y})`}
                  x={label.x}
                  y={label.y + scene.fontSize * 0.35}
                >
                  {label.text}
                </SvgText>
              ))}
            </G>
          </Svg>
        ) : null}

        {focusedVertex ? (
          <View
            pointerEvents="none"
            style={{
              position: "absolute",
              left: Math.max(
                space.sm,
                Math.min(focusedVertex.x - 60, width - 132),
              ),
              top: Math.max(space.sm, focusedVertex.y - 56),
              backgroundColor: palette.surfaceRaised,
              borderColor: palette.border,
              borderRadius: radius.md,
              borderWidth: 1,
              gap: 2,
              paddingHorizontal: space.md,
              paddingVertical: space.sm,
            }}
          >
            <Text style={[type.footnote, { color: palette.text }]}>
              {focusedVertex.subject}
            </Text>
            <Text
              style={[type.footnote, numeric, { color: palette.textMuted }]}
            >
              {`${t("Average")} · ${formatValue(focusedVertex.value)}`}
            </Text>
          </View>
        ) : null}
      </View>
    </Card>
  );
}
