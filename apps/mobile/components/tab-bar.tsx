import { Pressable, StyleSheet, Text, View } from "react-native";
// expo-router vendors react-navigation; the props type must come from the
// same copy as the navigator that renders this bar.
import type { BottomTabBarProps } from "expo-router/build/react-navigation/bottom-tabs";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Icon, type IconName } from "@/components/icon";
import { useQuickAdd } from "@/components/quick-add";
import { haptic } from "@/lib/haptics";
import { t } from "@/lib/i18n";
import { useNavigationTabs } from "@/lib/navigation-settings";
import { radius, space, type, usePalette } from "@/lib/theme";

/**
 * The bottom bar, drawn to match the web's phone shell exactly.
 *
 * Four destinations and one action, which is as many targets as a thumb can
 * reach without looking. The action sits in the middle and is raised, because
 * "record a grade" is the thing this app is opened to do and it should not
 * take a scroll to reach. The three destinations are the account's own
 * choice — the same choice the web stores — and "More" holds the rest.
 */

interface TabCell {
  name: string;
  label: string;
  icon: IconName;
}

/** Literal keys so the catalogue scan sees them; resolved at render time. */
const TAB_LABELS: Record<string, () => string> = {
  "/dashboard": () => t("Home"),
  "/subjects": () => t("Subjects"),
  "/grades": () => t("Grades"),
  "/goals": () => t("Goals"),
  "/insights": () => t("Insights"),
  "/social": () => t("Social"),
};

export function TabBar({ state, navigation }: BottomTabBarProps) {
  const palette = usePalette();
  const insets = useSafeAreaInsets();
  const quickAdd = useQuickAdd();
  const chosen = useNavigationTabs();

  const tabs: TabCell[] = [
    ...chosen.map((entry) => ({
      name: entry.route,
      label: TAB_LABELS[entry.href]?.() ?? t(entry.label),
      icon: entry.icon,
    })),
    { name: "more", label: t("More"), icon: "ellipsis" },
  ];

  const current = state.routes[state.index]?.name;
  // The action splits the row in two, exactly as the web's grid does.
  const cells: Array<TabCell | null> = [
    tabs[0] as TabCell,
    tabs[1] as TabCell,
    null,
    tabs[2] as TabCell,
    tabs[3] as TabCell,
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
              style={{
                flex: 1,
                alignItems: "center",
                justifyContent: "center",
              }}
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

        // "More" also owns the routes that live behind it (settings, …), the
        // way an iOS More tab stays lit while you are inside it.
        const active =
          current === tab.name ||
          (tab.name === "more" &&
            !tabs.some((entry) => entry.name === current));
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
