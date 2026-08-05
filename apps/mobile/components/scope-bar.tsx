import { useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useYear } from "@/components/year-provider";
import { haptic } from "@/lib/haptics";
import { t } from "@/lib/i18n";
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
  const { years, year, selectYear, periods, period, selectPeriod } = useYear();
  const [open, setOpen] = useState(false);

  const showYear = years.length > 1;
  const showPeriods = periods.length > 1;
  if (!showYear && !showPeriods) return null;

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
    </View>
  );
}
