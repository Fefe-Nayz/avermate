import { useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { NativeSlider } from "@/components/native-controls";
import { formatDate } from "@/components/format";
import { useYear } from "@/components/year-provider";
import { haptic } from "@/lib/haptics";
import { t } from "@/lib/i18n";
import {
  calendarDayTimestamp,
  dayAtOffset,
  isoCalendarDay,
  offsetForTimelineDay,
  timelineBounds,
} from "@/lib/timeline";
import { radius, space, type, usePalette } from "@/lib/theme";

/**
 * What you are looking at: which year, and which slice of it.
 *
 * Both live in one rail because they answer the same question, and the year
 * expands in place rather than into a sheet — the same rule the forms follow.
 * The rail hides itself entirely when there is one year and no periods, so a
 * student with a simple setup never sees a control they cannot use.
 */
export function ScopeBar() {
  const palette = usePalette();
  const router = useRouter();
  const {
    years,
    year,
    selectYear,
    periods,
    period,
    selectPeriod,
    timelineDate,
    setTimelineDate,
    yearGraph,
    now,
  } = useYear();
  const [open, setOpen] = useState(false);
  const [timelineOpen, setTimelineOpen] = useState(false);

  const showYear = years.length > 1;
  const showPeriods = periods.length > 1;
  if (!year) return null;

  const bounds = timelineBounds(year, now);
  const selectedDay = timelineDate
    ? offsetForTimelineDay(timelineDate, year, now)
    : bounds.totalDays;
  const selectedDate = new Date(
    calendarDayTimestamp(
      timelineDate ?? isoCalendarDay(bounds.maximum),
    ) ?? bounds.maximum,
  );

  return (
    <View style={{ gap: space.sm }}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{
          gap: space.sm,
          paddingHorizontal: space.lg,
          alignItems: "center",
        }}
        style={{ marginHorizontal: -space.lg }}
      >
        {showYear ? (
          <>
            <Pressable
              onPress={() => {
                haptic("selection");
                setOpen((current) => !current);
              }}
              style={{
                flexDirection: "row",
                alignItems: "center",
                gap: space.xs,
                minHeight: 38,
                paddingHorizontal: space.md,
                borderRadius: radius.pill,
                backgroundColor: palette.surface,
                borderWidth: StyleSheet.hairlineWidth,
                borderColor: open ? palette.accent : palette.border,
              }}
            >
              <Ionicons name="school-outline" size={14} color={palette.textMuted} />
              <Text style={[type.callout, { color: palette.text }]}>
                {year?.name ?? "—"}
              </Text>
              <Ionicons
                name={open ? "chevron-up" : "chevron-down"}
                size={12}
                color={palette.textFaint}
              />
            </Pressable>
            <View
              style={{
                width: StyleSheet.hairlineWidth,
                alignSelf: "stretch",
                marginVertical: space.sm,
                backgroundColor: palette.border,
              }}
            />
          </>
        ) : null}

        {showPeriods
          ? periods.map((item) => {
              const active = item.id === period.id;
              return (
                <Pressable
                  key={item.id}
                  onPress={() => {
                    haptic("selection");
                    selectPeriod(item.id);
                  }}
                  style={{
                    minHeight: 38,
                    justifyContent: "center",
                    paddingHorizontal: space.md,
                    borderRadius: radius.pill,
                    backgroundColor: active ? palette.accent : palette.surface,
                    borderWidth: StyleSheet.hairlineWidth,
                    borderColor: active ? palette.accent : palette.border,
                  }}
                >
                  <Text
                    style={[
                      type.callout,
                      { color: active ? palette.accentText : palette.textMuted },
                    ]}
                  >
                    {item.name}
                  </Text>
                </Pressable>
              );
            })
          : null}

        {showYear || showPeriods ? (
          <View
            style={{
              width: StyleSheet.hairlineWidth,
              alignSelf: "stretch",
              marginVertical: space.sm,
              backgroundColor: palette.border,
            }}
          />
        ) : null}
        <Pressable
          accessibilityLabel={
            timelineDate ? t("Adjust time travel date") : t("Time travel")
          }
          accessibilityRole="button"
          accessibilityState={{ expanded: timelineOpen, selected: Boolean(timelineDate) }}
          onPress={() => {
            haptic("selection");
            if (!timelineDate) {
              setTimelineDate(dayAtOffset(year, now, bounds.totalDays));
            }
            setTimelineOpen((current) => !current);
          }}
          style={{
            flexDirection: "row",
            alignItems: "center",
            gap: space.xs,
            minHeight: 38,
            paddingHorizontal: space.md,
            borderRadius: radius.pill,
            backgroundColor: timelineDate ? palette.accent : palette.surface,
            borderWidth: StyleSheet.hairlineWidth,
            borderColor: timelineDate ? palette.accent : palette.border,
          }}
        >
          <Ionicons
            name="time-outline"
            size={14}
            color={timelineDate ? palette.accentText : palette.textMuted}
          />
          <Text
            style={[
              type.callout,
              { color: timelineDate ? palette.accentText : palette.textMuted },
            ]}
          >
            {timelineDate ? formatDate(selectedDate, "short") : t("Time travel")}
          </Text>
        </Pressable>
      </ScrollView>

      {open ? (
        <View
          style={{
            backgroundColor: palette.surface,
            borderRadius: radius.md,
            borderWidth: StyleSheet.hairlineWidth,
            borderColor: palette.border,
            overflow: "hidden",
          }}
        >
          {years.map((item, index) => {
            const active = item.id === year?.id;
            return (
              <Pressable
                key={item.id}
                onPress={() => {
                  haptic("light");
                  selectYear(item.id);
                  setOpen(false);
                }}
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  gap: space.sm,
                  minHeight: 48,
                  paddingHorizontal: space.md,
                  borderTopWidth: index === 0 ? 0 : StyleSheet.hairlineWidth,
                  borderTopColor: palette.hairline,
                }}
              >
                <Text style={[type.body, { flex: 1, color: palette.text }]}>
                  {item.name}
                </Text>
                {active ? (
                  <Ionicons name="checkmark" size={18} color={palette.accent} />
                ) : null}
              </Pressable>
            );
          })}
          <Pressable
            onPress={() => {
              haptic("light");
              setOpen(false);
              router.push("/year/new");
            }}
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: space.sm,
              minHeight: 48,
              paddingHorizontal: space.md,
              borderTopWidth: StyleSheet.hairlineWidth,
              borderTopColor: palette.hairline,
            }}
          >
            <Ionicons name="add" size={18} color={palette.textMuted} />
            <Text style={[type.body, { color: palette.textMuted }]}>
              {t("Add a year")}
            </Text>
          </Pressable>
        </View>
      ) : null}

      {timelineOpen && timelineDate ? (
        <View
          accessibilityLabel={t("Time travel")}
          style={{
            backgroundColor: palette.surface,
            borderRadius: radius.md,
            borderWidth: StyleSheet.hairlineWidth,
            borderColor: palette.border,
            padding: space.md,
            gap: space.sm,
          }}
        >
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: space.sm,
            }}
          >
            <View style={{ flex: 1, gap: 2 }}>
              <Text selectable style={[type.callout, { color: palette.text }]}>
                {t("Showing {date}", { date: formatDate(selectedDate) })}
              </Text>
              <Text
                selectable
                style={[type.footnote, { color: palette.textMuted }]}
              >
                {t("{count} grades visible", {
                  count: String(yearGraph.allGrades().length),
                })}
              </Text>
            </View>
            <Pressable
              accessibilityLabel={t("Back to today")}
              accessibilityRole="button"
              hitSlop={10}
              onPress={() => {
                haptic("light");
                setTimelineDate(null);
                setTimelineOpen(false);
              }}
              style={{ padding: space.xs }}
            >
              <Ionicons name="close" size={20} color={palette.textMuted} />
            </Pressable>
          </View>

          <View
            style={{ flexDirection: "row", alignItems: "center", gap: space.sm }}
          >
            <Pressable
              accessibilityLabel={t("Previous day")}
              accessibilityRole="button"
              disabled={selectedDay <= 0}
              hitSlop={8}
              onPress={() =>
                setTimelineDate(dayAtOffset(year, now, selectedDay - 1))
              }
              style={{ opacity: selectedDay <= 0 ? 0.35 : 1, padding: space.xs }}
            >
              <Ionicons name="remove" size={18} color={palette.textMuted} />
            </Pressable>
            <View style={{ flex: 1 }}>
              <NativeSlider
                min={0}
                max={Math.max(1, bounds.totalDays)}
                step={1}
                value={selectedDay}
                onValueChange={(value) =>
                  setTimelineDate(dayAtOffset(year, now, value))
                }
              />
            </View>
            <Pressable
              accessibilityLabel={t("Next day")}
              accessibilityRole="button"
              disabled={selectedDay >= bounds.totalDays}
              hitSlop={8}
              onPress={() =>
                setTimelineDate(dayAtOffset(year, now, selectedDay + 1))
              }
              style={{
                opacity: selectedDay >= bounds.totalDays ? 0.35 : 1,
                padding: space.xs,
              }}
            >
              <Ionicons name="add" size={18} color={palette.textMuted} />
            </Pressable>
          </View>

          <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
            <Text style={[type.footnote, { color: palette.textFaint }]}>
              {formatDate(new Date(bounds.minimum), "short")}
            </Text>
            <Text style={[type.footnote, { color: palette.textFaint }]}>
              {formatDate(new Date(bounds.maximum), "short")}
            </Text>
          </View>
        </View>
      ) : null}
    </View>
  );
}
