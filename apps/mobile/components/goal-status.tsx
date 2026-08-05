import { Column } from "@expo/ui";
import type { GoalStatus } from "@avermate/core";
import { Text } from "@/components/native";
import { t } from "@/lib/i18n";
import { radius, space, usePalette } from "@/lib/theme";

/**
 * A goal has six states and every one of them needs a different sentence.
 * "Out of reach" is the strongest thing the app ever says, so it is earned by
 * arithmetic — the engine only returns it once the best possible outcome still
 * falls short.
 */
export function statusLabel(status: GoalStatus): string {
  switch (status) {
    case "achieved":
      return t("Reached");
    case "secured":
      return t("Locked in");
    case "on-track":
      return t("On track");
    case "at-risk":
      return t("Needs work");
    case "unreachable":
      return t("Out of reach");
    case "no-data":
      return t("No data yet");
  }
}

export function StatusPill({ status }: { status: GoalStatus }) {
  const palette = usePalette();

  const colors: Record<GoalStatus, { fg: string; bg: string }> = {
    achieved: { fg: palette.band.excellent, bg: palette.bandSoft.excellent },
    secured: { fg: palette.band.excellent, bg: palette.bandSoft.excellent },
    "on-track": { fg: palette.band.good, bg: palette.bandSoft.good },
    "at-risk": { fg: palette.band.weak, bg: palette.bandSoft.weak },
    unreachable: { fg: palette.band.poor, bg: palette.bandSoft.poor },
    "no-data": { fg: palette.textFaint, bg: palette.accentSoft },
  };

  const tone = colors[status];

  return (
    <Column
      alignment="center"
      style={{
        paddingHorizontal: space.sm,
        paddingVertical: 3,
        borderRadius: radius.sm,
        backgroundColor: tone.bg,
      }}
    >
      <Text size="footnote" color={tone.fg}>
        {statusLabel(status)}
      </Text>
    </Column>
  );
}
