import { useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Icon } from "@/components/icon";
import { haptic } from "@/lib/haptics";
import {
  formatDate,
  formatDay,
  formatMonth,
  formatNumber,
  parseNumber,
} from "@/components/format";
import { locale, t } from "@/lib/i18n";

export { formatDate, formatDay, formatMonth, formatNumber, parseNumber };
import { numeric, radius, space, type, usePalette } from "@/lib/theme";

/**
 * A date picker that stays on the page.
 *
 * The platform date picker is a sheet, and a sheet over a form means the thing
 * you are editing disappears while you edit it. This expands in place instead:
 * one row collapsed, a month grid open. Two taps for "today", three for
 * anything in the same month — which covers nearly every grade anyone enters.
 */

const DAY = 24 * 60 * 60 * 1000;

function tag(locale: string) {
  return locale === "fr" ? "fr-FR" : "en-GB";
}

function sameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

/** Monday-first weeks — the app's audience is French before anything else. */
function weekdayLabels(): string[] {
  const reference = new Date(2024, 0, 1); // a Monday
  return Array.from({ length: 7 }, (_, index) => {
    const day = new Date(reference.getTime() + index * DAY);
    return day
      .toLocaleDateString(tag(locale()), { weekday: "narrow" })
      .toUpperCase();
  });
}

function monthGrid(month: Date): Array<Date | null> {
  const first = new Date(month.getFullYear(), month.getMonth(), 1);
  const lead = (first.getDay() + 6) % 7;
  const length = new Date(
    month.getFullYear(),
    month.getMonth() + 1,
    0,
  ).getDate();

  const cells: Array<Date | null> = Array.from({ length: lead }, () => null);
  for (let day = 1; day <= length; day += 1) {
    cells.push(new Date(month.getFullYear(), month.getMonth(), day));
  }
  return cells;
}

export function DateField({
  label,
  value,
  onChange,
  min,
  max,
}: {
  label: string;
  value: Date;
  onChange: (value: Date) => void;
  min?: Date;
  max?: Date;
}) {
  const palette = usePalette();
  const [open, setOpen] = useState(false);
  const [month, setMonth] = useState(
    () => new Date(value.getFullYear(), value.getMonth(), 1),
  );

  const cells = useMemo(() => monthGrid(month), [month]);
  const labels = useMemo(() => weekdayLabels(), []);
  const today = new Date();

  // Bounds are compared against copies: `setHours` mutates, and these Dates
  // belong to the caller — clamping the calendar must not move the school year.
  const startOfDay = (date: Date) =>
    new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();

  const outOfRange = (date: Date) =>
    (min !== undefined && startOfDay(date) < startOfDay(min)) ||
    (max !== undefined && startOfDay(date) > startOfDay(max));

  const shift = (direction: -1 | 1) => {
    haptic("selection");
    setMonth(new Date(month.getFullYear(), month.getMonth() + direction, 1));
  };

  const pick = (date: Date) => {
    haptic("light");
    onChange(date);
    setOpen(false);
  };

  return (
    <View style={{ gap: space.sm }}>
      <Text style={[type.label, { color: palette.textFaint }]}>{label}</Text>
      <View
        style={{
          backgroundColor: palette.surface,
          borderRadius: radius.md,
          borderWidth: StyleSheet.hairlineWidth,
          borderColor: palette.border,
          overflow: "hidden",
        }}
      >
        <Pressable
          onPress={() => {
            haptic("selection");
            setMonth(new Date(value.getFullYear(), value.getMonth(), 1));
            setOpen((current) => !current);
          }}
          style={{
            flexDirection: "row",
            alignItems: "center",
            gap: space.sm,
            minHeight: 52,
            paddingHorizontal: space.md,
          }}
        >
          <Icon name="calendar-outline" size={18} color={palette.textFaint} />
          <Text style={[type.body, { flex: 1, color: palette.text }]}>
            {sameDay(value, today) ? t("Today") : formatDate(value)}
          </Text>
          <Icon
            name={open ? "chevron-up" : "chevron-down"}
            size={16}
            color={palette.textFaint}
          />
        </Pressable>

        {open ? (
          <View
            style={{
              padding: space.md,
              gap: space.sm,
              borderTopWidth: StyleSheet.hairlineWidth,
              borderTopColor: palette.hairline,
            }}
          >
            <View
              style={{
                flexDirection: "row",
                alignItems: "center",
                justifyContent: "space-between",
              }}
            >
              <Pressable
                onPress={() => shift(-1)}
                hitSlop={12}
                style={{ padding: space.xs }}
              >
                <Icon name="chevron-back" size={18} color={palette.textMuted} />
              </Pressable>
              <Text style={[type.callout, { color: palette.text }]}>
                {month.toLocaleDateString(tag(locale()), {
                  month: "long",
                  year: "numeric",
                })}
              </Text>
              <Pressable
                onPress={() => shift(1)}
                hitSlop={12}
                style={{ padding: space.xs }}
              >
                <Icon
                  name="chevron-forward"
                  size={18}
                  color={palette.textMuted}
                />
              </Pressable>
            </View>

            <View style={{ flexDirection: "row" }}>
              {labels.map((day, index) => (
                <Text
                  key={index}
                  style={[
                    type.footnote,
                    {
                      flex: 1,
                      textAlign: "center",
                      color: palette.textFaint,
                      fontSize: 11,
                    },
                  ]}
                >
                  {day}
                </Text>
              ))}
            </View>

            <View style={{ flexDirection: "row", flexWrap: "wrap" }}>
              {cells.map((date, index) => {
                if (!date) {
                  return (
                    <View
                      key={`gap-${index}`}
                      style={{ width: `${100 / 7}%`, height: 40 }}
                    />
                  );
                }
                const selected = sameDay(date, value);
                const isToday = sameDay(date, today);
                const disabled = outOfRange(new Date(date));

                return (
                  <Pressable
                    key={date.toISOString()}
                    disabled={disabled}
                    onPress={() => pick(date)}
                    style={{
                      width: `${100 / 7}%`,
                      height: 40,
                      alignItems: "center",
                      justifyContent: "center",
                    }}
                  >
                    <View
                      style={{
                        width: 34,
                        height: 34,
                        borderRadius: 17,
                        alignItems: "center",
                        justifyContent: "center",
                        backgroundColor: selected
                          ? palette.accent
                          : "transparent",
                        borderWidth: !selected && isToday ? 1 : 0,
                        borderColor: palette.border,
                        opacity: disabled ? 0.25 : 1,
                      }}
                    >
                      <Text
                        style={[
                          type.callout,
                          numeric,
                          {
                            color: selected ? palette.accentText : palette.text,
                          },
                        ]}
                      >
                        {date.getDate()}
                      </Text>
                    </View>
                  </Pressable>
                );
              })}
            </View>

            <Pressable
              onPress={() => pick(new Date())}
              style={{
                alignSelf: "center",
                paddingVertical: space.sm,
                paddingHorizontal: space.md,
              }}
            >
              <Text style={[type.callout, { color: palette.textMuted }]}>
                {t("Today")}
              </Text>
            </Pressable>
          </View>
        ) : null}
      </View>
    </View>
  );
}
