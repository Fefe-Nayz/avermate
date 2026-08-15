import { Text, View, type StyleProp, type TextStyle } from "react-native";
import { bandOf, type Ratio } from "@avermate/core";
import { numeric, space, type, usePalette } from "@/lib/theme";
import { useYear } from "@/components/year-provider";
import { locale } from "@/lib/i18n";

/**
 * How a number looks.
 *
 * The engine works in ratios; a screen works in whatever scale the year uses.
 * Every conversion happens here, so a 14.75 means the same thing on the
 * dashboard, in a list row and inside a goal plan.
 */

function format(value: number, decimals: number): string {
  return value.toLocaleString(locale() === "fr" ? "fr-FR" : "en-GB", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

export function AverageValue({
  ratio,
  size = "body",
  showScale = false,
  colored = false,
  decimals,
  style,
}: {
  ratio: Ratio;
  size?:
    "hero" | "display" | "title" | "heading" | "body" | "callout" | "footnote";
  showScale?: boolean;
  colored?: boolean;
  decimals?: number;
  style?: StyleProp<TextStyle>;
}) {
  const palette = usePalette();
  const { scale, decimals: yearDecimals, passingRatio } = useYear();
  const digits = decimals ?? yearDecimals;

  if (ratio === null) {
    return (
      <Text style={[type[size], numeric, { color: palette.textFaint }, style]}>
        —
      </Text>
    );
  }

  const band = bandOf(ratio, passingRatio);
  const color = colored && band ? palette.band[band] : palette.text;

  return (
    <View style={{ flexDirection: "row", alignItems: "baseline" }}>
      <Text style={[type[size], numeric, { color }, style]}>
        {format(ratio * scale, digits)}
      </Text>
      {showScale ? (
        <Text
          style={[
            numeric,
            {
              color: palette.textFaint,
              fontSize: Math.round(type[size].fontSize * 0.45),
              marginLeft: 3,
            },
          ]}
        >
          /{format(scale, 0)}
        </Text>
      ) : null}
    </View>
  );
}

/** A signed change, on the year's scale rather than as a percentage. */
export function DeltaValue({
  delta,
  size = "footnote",
  decimals,
}: {
  delta: number | null;
  size?: "heading" | "body" | "callout" | "footnote" | "title";
  decimals?: number;
}) {
  const palette = usePalette();
  const { scale, decimals: yearDecimals } = useYear();
  const digits = decimals ?? yearDecimals;

  if (delta === null) {
    return (
      <Text style={[type[size], numeric, { color: palette.textFaint }]}>—</Text>
    );
  }

  const value = delta * scale;
  const neutral = Math.abs(value) < 10 ** -digits / 2;
  const color = neutral
    ? palette.textFaint
    : value > 0
      ? palette.positive
      : palette.negative;

  return (
    <Text style={[type[size], numeric, { color }]}>
      {neutral ? "±" : value > 0 ? "+" : "−"}
      {format(Math.abs(value), digits)}
    </Text>
  );
}

/** A grade, in its band colour on a tinted plate. */
export function ResultBadge({ ratio }: { ratio: Ratio }) {
  const palette = usePalette();
  const { scale, decimals, passingRatio } = useYear();
  const band = ratio === null ? null : bandOf(ratio, passingRatio);

  return (
    <View
      style={{
        paddingHorizontal: space.sm,
        paddingVertical: 3,
        borderRadius: 8,
        backgroundColor: band ? palette.bandSoft[band] : palette.accentSoft,
        minWidth: 56,
        alignItems: "center",
      }}
    >
      <Text
        style={[
          type.callout,
          numeric,
          { color: band ? palette.band[band] : palette.textFaint },
        ]}
      >
        {ratio === null ? "—" : format(ratio * scale, decimals)}
      </Text>
    </View>
  );
}

/** Raw points as entered, never normalised. */
export function PointsValue({
  value,
  outOf,
}: {
  value: number;
  outOf: number;
}) {
  const palette = usePalette();
  const show = (input: number) =>
    input.toLocaleString(locale() === "fr" ? "fr-FR" : "en-GB", {
      maximumFractionDigits: 2,
    });

  return (
    <Text style={[type.footnote, numeric, { color: palette.textMuted }]}>
      {show(value)} / {show(outOf)}
    </Text>
  );
}

export function CoefficientTag({ coefficient }: { coefficient: number }) {
  const palette = usePalette();
  if (coefficient === 1) return null;

  return (
    <Text style={[type.footnote, numeric, { color: palette.textFaint }]}>
      ×{coefficient.toLocaleString(undefined, { maximumFractionDigits: 2 })}
    </Text>
  );
}

/** A percentage, for rates and shares. */
export function PercentValue({
  ratio,
  size = "body",
}: {
  ratio: number | null;
  size?:
    "hero" | "display" | "title" | "heading" | "body" | "callout" | "footnote";
}) {
  const palette = usePalette();

  if (ratio === null) {
    return (
      <Text style={[type[size], numeric, { color: palette.textFaint }]}>—</Text>
    );
  }

  return (
    <Text style={[type[size], numeric, { color: palette.text }]}>
      {`${Math.round(ratio * 100)} %`}
    </Text>
  );
}
