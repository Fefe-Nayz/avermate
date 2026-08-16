import { useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { bandOf, gradeRatio, type Grade } from "@avermate/core";
import { Icon, type IconName } from "@/components/icon";
import { Card, Note, Row } from "@/components/ui";
import { CoefficientTag, ResultBadge } from "@/components/value";
import { formatMonth } from "@/components/format";
import { useYear } from "@/components/year-provider";
import { haptic } from "@/lib/haptics";
import { locale, t } from "@/lib/i18n";
import { numeric, radius, space, type, usePalette } from "@/lib/theme";
import {
  addMonths,
  dayKey,
  groupGradesByDay,
  latestGradeDay,
  monthMatrix,
  monthResultDays,
  sameDay,
  sameMonth,
  startOfMonth,
} from "./grade-views";

/**
 * Grades, on a calendar — the web's month grid, phone-sized.
 *
 * Colour is the result band and days are local, for the same reasons the web
 * component gives: on a screen of marks the one thing worth seeing at a glance
 * is *how it went*, and a late-evening grade must sit in the same month here
 * as it does in the list. Cells hold a dot per result — a mark chip in a cell
 * this narrow is unreadable — and tapping a day opens its results underneath,
 * exactly the web's phone behaviour.
 */

function tag(): string {
  return locale() === "fr" ? "fr-FR" : "en-GB";
}

/** "lundi 5 janvier" — the heading of a selected day. */
function formatSelectedDay(key: string): string {
  return new Date(`${key}T00:00:00`).toLocaleDateString(tag(), {
    weekday: "long",
    day: "numeric",
    month: "long",
  });
}

function HeaderControl({
  icon,
  label,
  accessibilityLabel,
  onPress,
}: {
  icon?: IconName;
  label?: string;
  accessibilityLabel: string;
  onPress: () => void;
}) {
  const palette = usePalette();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      hitSlop={6}
      onPress={() => {
        haptic("selection");
        onPress();
      }}
      style={({ pressed }) => ({
        minHeight: 32,
        minWidth: 32,
        paddingHorizontal: label ? space.md : 0,
        alignItems: "center",
        justifyContent: "center",
        borderRadius: radius.md,
        borderCurve: "continuous",
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: palette.border,
        backgroundColor: pressed ? palette.accentSoft : "transparent",
      })}
    >
      {icon ? <Icon name={icon} size={16} color={palette.textMuted} /> : null}
      {label ? (
        <Text
          style={[type.footnote, { color: palette.text, fontWeight: "500" }]}
        >
          {label}
        </Text>
      ) : null}
    </Pressable>
  );
}

export function GradeCalendar({ grades }: { grades: readonly Grade[] }) {
  const palette = usePalette();
  const router = useRouter();
  const { graph, now, passingRatio } = useYear();

  // The web derives this from the date-fns locale: Sundays for English,
  // Mondays for French.
  const weekStartsOn = locale() === "fr" ? 1 : 0;

  const today = useMemo(() => new Date(now), [now]);
  const [month, setMonth] = useState(() =>
    startOfMonth(latestGradeDay(grades, today)),
  );
  const [selectedKey, setSelectedKey] = useState<string | null>(null);

  const byDay = useMemo(() => groupGradesByDay(grades), [grades]);
  const weeks = useMemo(
    () => monthMatrix(month, weekStartsOn),
    [month, weekStartsOn],
  );
  const weekdays = useMemo(
    () =>
      (weeks[0] ?? []).map((day) =>
        day.toLocaleDateString(tag(), { weekday: "short" }).toUpperCase(),
      ),
    [weeks],
  );

  const monthCount = monthResultDays(weeks, byDay, month);
  const selected = selectedKey ? (byDay.get(selectedKey) ?? []) : [];

  return (
    <View style={{ gap: space.md }}>
      <View
        style={{ flexDirection: "row", alignItems: "center", gap: space.sm }}
      >
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={[type.section, { color: palette.text }]}>
            {formatMonth(month)}
          </Text>
          <Text style={[type.caption, { color: palette.textMuted }]}>
            {monthCount === 1
              ? t("1 day with results")
              : t("{count} days with results", { count: monthCount })}
          </Text>
        </View>
        <HeaderControl
          icon="chevron-back"
          accessibilityLabel={t("Previous month")}
          onPress={() => setMonth((current) => addMonths(current, -1))}
        />
        <HeaderControl
          label={t("Today")}
          accessibilityLabel={t("Today")}
          onPress={() => setMonth(startOfMonth(today))}
        />
        <HeaderControl
          icon="chevron-forward"
          accessibilityLabel={t("Next month")}
          onPress={() => setMonth((current) => addMonths(current, 1))}
        />
      </View>

      <Card padded={false}>
        <View
          style={{
            flexDirection: "row",
            borderBottomWidth: StyleSheet.hairlineWidth,
            borderBottomColor: palette.hairline,
            backgroundColor: palette.accentSoft,
          }}
        >
          {weekdays.map((label, index) => (
            <Text
              key={index}
              style={[
                type.label,
                {
                  flex: 1,
                  paddingVertical: space.sm,
                  textAlign: "center",
                  color: palette.textMuted,
                },
              ]}
            >
              {label}
            </Text>
          ))}
        </View>

        {weeks.map((week, weekIndex) => (
          <View
            key={dayKey(week[0] as Date)}
            style={{
              flexDirection: "row",
              borderTopWidth: weekIndex === 0 ? 0 : StyleSheet.hairlineWidth,
              borderTopColor: palette.hairline,
            }}
          >
            {week.map((day, dayIndex) => {
              const key = dayKey(day);
              const dayGrades = byDay.get(key) ?? [];
              const outside = !sameMonth(day, month);
              const isToday = sameDay(day, today);
              const isSelected = key === selectedKey;

              return (
                <Pressable
                  key={key}
                  accessibilityRole="button"
                  accessibilityState={{ selected: isSelected }}
                  accessibilityLabel={day.toLocaleDateString(tag(), {
                    day: "numeric",
                    month: "long",
                  })}
                  disabled={dayGrades.length === 0}
                  onPress={() => {
                    haptic("selection");
                    setSelectedKey(isSelected ? null : key);
                  }}
                  style={{
                    flex: 1,
                    minHeight: 64,
                    padding: space.xs,
                    gap: space.xs,
                    borderRightWidth:
                      dayIndex < 6 ? StyleSheet.hairlineWidth : 0,
                    borderRightColor: palette.hairline,
                    backgroundColor: isSelected
                      ? palette.accentSoft
                      : "transparent",
                  }}
                >
                  <View
                    style={{
                      width: 20,
                      height: 20,
                      alignItems: "center",
                      justifyContent: "center",
                      borderRadius: radius.pill,
                      backgroundColor: isToday ? palette.accent : "transparent",
                    }}
                  >
                    <Text
                      style={[
                        type.caption,
                        numeric,
                        {
                          color: isToday
                            ? palette.accentText
                            : outside
                              ? palette.textFaint
                              : palette.textMuted,
                          fontWeight: isToday ? "600" : "400",
                        },
                      ]}
                    >
                      {day.getDate()}
                    </Text>
                  </View>
                  <View
                    style={{ flexDirection: "row", flexWrap: "wrap", gap: 2 }}
                  >
                    {dayGrades.slice(0, 6).map((grade) => {
                      const ratio = gradeRatio(grade);
                      const band =
                        ratio === null ? null : bandOf(ratio, passingRatio);
                      return (
                        <View
                          key={grade.id}
                          style={{
                            width: 6,
                            height: 6,
                            borderRadius: radius.pill,
                            backgroundColor: band
                              ? palette.band[band]
                              : palette.textFaint,
                          }}
                        />
                      );
                    })}
                  </View>
                </Pressable>
              );
            })}
          </View>
        ))}
      </Card>

      {selectedKey ? (
        <Card padded={false}>
          <View
            style={{
              paddingHorizontal: space.lg,
              paddingVertical: space.md,
              borderBottomWidth: StyleSheet.hairlineWidth,
              borderBottomColor: palette.hairline,
            }}
          >
            <Text style={[type.callout, { color: palette.text }]}>
              {formatSelectedDay(selectedKey)}
            </Text>
          </View>
          {selected.map((grade, index) => (
            <Row
              key={grade.id}
              first={index === 0}
              title={grade.name}
              subtitle={graph.byId(grade.subjectId)?.name ?? ""}
              onPress={() => router.push(`/grade/${grade.id}`)}
              trailing={
                <View
                  style={{
                    flexDirection: "row",
                    alignItems: "center",
                    gap: space.sm,
                  }}
                >
                  <CoefficientTag coefficient={grade.coefficient} />
                  <ResultBadge ratio={gradeRatio(grade)} />
                </View>
              }
            />
          ))}
        </Card>
      ) : (
        <Note>{t("Select a day to see its results.")}</Note>
      )}
    </View>
  );
}
