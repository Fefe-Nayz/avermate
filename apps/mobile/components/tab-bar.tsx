import { Pressable, StyleSheet, Text, View } from "react-native";
import type { BottomTabBarProps } from "@react-navigation/bottom-tabs";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Icon, type IconName } from "@/components/icon";
import { useQuickAdd } from "@/components/quick-add";
import { haptic } from "@/lib/haptics";
import { t } from "@/lib/i18n";
import { radius, space, type, usePalette } from "@/lib/theme";

/**
 * The bottom bar, drawn to match the web's phone shell exactly.
 *
 * Four destinations and one action, which is as many targets as a thumb can
 * reach without looking. The action sits in the middle and is raised, because
 * "record a grade" is the thing this app is opened to do and it should not
 * take a scroll to reach.
 */

const TABS: Array<{ name: string; label: string; icon: IconName }> = [
  { name: "index", label: t("Home"), icon: "layout-dashboard" },
  { name: "subjects", label: t("Subjects"), icon: "book-marked" },
  { name: "grades", label: t("Grades"), icon: "list-checks" },
  { name: "more", label: t("More"), icon: "ellipsis" },
];

export function TabBar({ state, navigation }: BottomTabBarProps) {
  const palette = usePalette();
  const insets = useSafeAreaInsets();
  const quickAdd = useQuickAdd();

  const current = state.routes[state.index]?.name;
  // The action splits the row in two, exactly as the web's grid does.
  const cells: Array<(typeof TABS)[number] | null> = [
    TABS[0] as (typeof TABS)[number],
    TABS[1] as (typeof TABS)[number],
    null,
    TABS[2] as (typeof TABS)[number],
    TABS[3] as (typeof TABS)[number],
  ];

  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        height: 56 + insets.bottom,
        paddingBottom: insets.bottom,
        backgroundColor: palette.background,
        borderTopWidth: StyleSheet.hairlineWidth,
        borderTopColor: palette.hairline,
      }}
    >
      {cells.map((tab, index) => {
        if (!tab) {
          return (
            <View
              key="action"
              style={{ flex: 1, alignItems: "center", justifyContent: "center" }}
            >
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t("Add")}
                onPress={() => {
                  haptic("medium");
                  quickAdd.open();
                }}
                style={({ pressed }) => ({
                  marginTop: -26,
                  width: 52,
                  height: 52,
                  borderRadius: radius.pill,
                  alignItems: "center",
                  justifyContent: "center",
                  backgroundColor: palette.accent,
                  // The web rings the button in the page background so it
                  // reads as floating above the bar rather than punched
                  // through it.
                  borderWidth: 4,
                  borderColor: palette.background,
                  transform: [{ scale: pressed ? 0.92 : 1 }],
                })}
              >
                <Icon name="add" size={24} color={palette.accentText} />
              </Pressable>
            </View>
          );
        }

        const active = current === tab.name;
        return (
          <Pressable
            key={tab.name}
            accessibilityRole="button"
            accessibilityState={{ selected: active }}
            onPress={() => {
              haptic("selection");
              if (!active) navigation.navigate(tab.name);
            }}
            style={{
              flex: 1,
              alignItems: "center",
              justifyContent: "center",
              gap: 2,
              height: "100%",
            }}
          >
            <Icon
              name={tab.icon}
              size={22}
              color={active ? palette.accent : palette.textFaint}
              strokeWidth={active ? 2.2 : 1.8}
            />
            <Text
              numberOfLines={1}
              style={[
                type.label,
                {
                  fontSize: 10,
                  letterSpacing: 0,
                  textTransform: "none",
                  color: active ? palette.accent : palette.textFaint,
                },
              ]}
            >
              {tab.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}
