import { bandOf, type Ratio } from "@avermate/core";
import { Row, Text } from "@/components/native";
import { useYear } from "@/components/year-provider";
import { locale } from "@/lib/i18n";
import { radius, space, type, usePalette } from "@/lib/theme";
import { Column } from "@expo/ui";

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
}: {
  ratio: Ratio;
  size?: keyof typeof type;
  showScale?: boolean;
  colored?: boolean;
  decimals?: number;
}) {
  const palette = usePalette();
  const { scale, decimals: yearDecimals, passingRatio } = useYear();
  const digits = decimals ?? yearDecimals;

  if (ratio === null) {
    return (
      <Text size={size} tone="faint" mono>
        —
      </Text>
    );
  }

  const band = bandOf(ratio, passingRatio);
  const color = colored && band ? palette.band[band] : undefined;
  const value = format(ratio * scale, digits);

  if (!showScale) {
    return (
      <Text size={size} color={color} mono>
        {value}
      </Text>
    );
  }

  return (
    <Row spacing={2} alignment="end">
      <Text size={size} color={color} mono>
        {value}
      </Text>
      <Text size="callout" tone="faint" mono>
        {`/${format(scale, 0)}`}
      </Text>
    </Row>
  );
}

/** A signed change, on the year's scale rather than as a percentage. */
export function DeltaValue({
  delta,
  size = "footnote",
  decimals,
}: {
  delta: number | null;
  size?: keyof typeof type;
  decimals?: number;
}) {
  const palette = usePalette();
  const { scale, decimals: yearDecimals } = useYear();
  const digits = decimals ?? yearDecimals;

  if (delta === null) {
    return (
      <Text size={size} tone="faint" mono>
        —
      </Text>
    );
  }

  const value = delta * scale;
  const neutral = Math.abs(value) < 10 ** -digits / 2;
  const color = neutral
    ? palette.textFaint
    : value > 0
      ? palette.positive
      : palette.negative;

  const sign = neutral ? "±" : value > 0 ? "+" : "−";

  return (
    <Text size={size} color={color} mono>
      {`${sign}${format(Math.abs(value), digits)}`}
    </Text>
  );
}

/** A grade, in its band colour on a tinted plate. */
export function ResultBadge({ ratio }: { ratio: Ratio }) {
  const palette = usePalette();
  const { scale, decimals, passingRatio } = useYear();
  const band = ratio === null ? null : bandOf(ratio, passingRatio);

  return (
    <Column
      alignment="center"
      style={{
        paddingHorizontal: space.sm,
        paddingVertical: 3,
        borderRadius: radius.sm,
        backgroundColor: band ? palette.bandSoft[band] : palette.accentSoft,
      }}
    >
      <Text
        size="callout"
        mono
        color={band ? palette.band[band] : palette.textFaint}
      >
        {ratio === null ? "—" : format(ratio * scale, decimals)}
      </Text>
    </Column>
  );
}

/** Raw points as entered, never normalised. */
export function PointsValue({ value, outOf }: { value: number; outOf: number }) {
  const show = (input: number) =>
    input.toLocaleString(locale() === "fr" ? "fr-FR" : "en-GB", {
      maximumFractionDigits: 2,
    });

  return (
    <Text size="footnote" tone="muted" mono>
      {`${show(value)} / ${show(outOf)}`}
    </Text>
  );
}

export function CoefficientTag({ coefficient }: { coefficient: number }) {
  if (coefficient === 1) return null;

  return (
    <Text size="footnote" tone="faint" mono>
      {`×${coefficient.toLocaleString(undefined, { maximumFractionDigits: 2 })}`}
    </Text>
  );
}

/** A percentage, for rates and shares. */
export function PercentValue({
  ratio,
  size = "body",
}: {
  ratio: number | null;
  size?: keyof typeof type;
}) {
  if (ratio === null) {
    return (
      <Text size={size} tone="faint" mono>
        —
      </Text>
    );
  }

  return (
    <Text size={size} mono>
      {`${Math.round(ratio * 100)} %`}
    </Text>
  );
}
