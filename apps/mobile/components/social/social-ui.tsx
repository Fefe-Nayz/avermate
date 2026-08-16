import { Text, View } from "react-native";
import { Image } from "expo-image";
import { locale, t } from "@/lib/i18n";
import { numeric, radius, space, type, usePalette } from "@/lib/theme";

export function groupKindLabel(value: string): string {
  switch (value) {
    case "class":
      return t("Class");
    case "study":
      return t("Study group");
    default:
      return t("Friends group");
  }
}

export function comparisonLabel(
  kind: string,
  subjectName?: string | null,
): string {
  switch (kind) {
    case "subject":
      return subjectName ?? t("Subject");
    case "median":
      return t("Median grade");
    case "passRate":
      return t("Pass rate");
    case "goalProgress":
      return t("Goals achieved");
    default:
      return t("General average");
  }
}

/** Percent metrics carry no denominator; everything else sits on a scale. */
export function comparisonUnit(kind: string): "scale" | "percent" {
  return kind === "passRate" || kind === "goalProgress" ? "percent" : "scale";
}

/**
 * The server writes its refusals in plain sentences ("This group is on an
 * administrative hold", "This year is not compatible with the class
 * template"). The web shows them verbatim; so does native.
 */
export function serverMessage(error: unknown, fallback: string): string {
  if (
    typeof error === "object" &&
    error !== null &&
    "message" in error &&
    typeof error.message === "string" &&
    error.message.trim()
  ) {
    return error.message;
  }
  return fallback;
}

/**
 * The small social vocabulary on native: a person, and a shared figure.
 * Everything else is built from the ordinary layout pieces.
 */

export function SocialIdentity({
  name,
  handle,
  avatar,
  secondary,
}: {
  name: string;
  handle?: string | null;
  avatar?: string | null;
  secondary?: string;
}) {
  const palette = usePalette();
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase();
  const line = [handle ? `@${handle}` : null, secondary]
    .filter(Boolean)
    .join(" · ");

  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: space.md }}>
      <View
        style={{
          width: 38,
          height: 38,
          borderRadius: radius.pill,
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: palette.accentSoft,
          overflow: "hidden",
        }}
      >
        {avatar ? (
          <Image
            source={{ uri: avatar }}
            style={{ width: 38, height: 38 }}
            contentFit="cover"
          />
        ) : (
          <Text style={[type.callout, { color: palette.accent }]}>
            {initials || "?"}
          </Text>
        )}
      </View>
      <View style={{ flex: 1, gap: 2 }}>
        <Text
          numberOfLines={1}
          style={[type.body, { color: palette.text, fontWeight: "500" }]}
        >
          {name}
        </Text>
        {line ? (
          <Text
            numberOfLines={1}
            style={[type.footnote, { color: palette.textMuted }]}
          >
            {line}
          </Text>
        ) : null}
      </View>
    </View>
  );
}

/** "14,52 / 20" on the owner's scale — the point of the whole feature. */
export function formatSharedAverage(
  ratio: number,
  scale: number,
  decimals: number,
  unit: "scale" | "percent" = "scale",
): string {
  const language = locale() === "fr" ? "fr-FR" : "en-GB";
  if (unit === "percent") {
    const value = new Intl.NumberFormat(language, {
      maximumFractionDigits: 0,
    }).format(ratio * 100);
    return `${value} %`;
  }
  const digits = Math.min(decimals, 2);
  const value = new Intl.NumberFormat(language, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(ratio * scale);
  return `${value} / ${scale}`;
}

export function SharedAverageText({
  ratio,
  scale,
  decimals,
  unit = "scale",
  size = "callout",
}: {
  ratio: number | null;
  scale: number | null;
  decimals: number | null;
  unit?: "scale" | "percent";
  size?: "callout" | "heading" | "title";
}) {
  const palette = usePalette();
  if (ratio === null || scale === null) {
    return <Text style={[type.footnote, { color: palette.textFaint }]}>—</Text>;
  }
  return (
    <Text
      style={[type[size], numeric, { color: palette.text, fontWeight: "600" }]}
    >
      {formatSharedAverage(ratio, scale, decimals ?? 2, unit)}
    </Text>
  );
}
