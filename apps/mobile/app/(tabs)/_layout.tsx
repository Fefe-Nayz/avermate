import { Redirect, Tabs } from "expo-router";
import { StyleSheet } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { Loading } from "@/components/native";
import { useYear } from "@/components/year-provider";
import { useSession } from "@/lib/auth-client";
import { haptic } from "@/lib/haptics";
import { t } from "@/lib/i18n";
import { usePalette } from "@/lib/theme";

/**
 * Five destinations, and every screen in the app hangs off one of them.
 *
 * Each screen draws its own large title in content rather than in a navigation
 * bar: the header then scrolls away with the page, which is what gives a phone
 * back the vertical space a fixed bar would eat.
 */
export default function TabsLayout() {
  const palette = usePalette();
  const { data: session, isPending } = useSession();
  const { years, isLoading } = useYear();

  // The gate lives on the layout rather than on a separate index route: a deep
  // link and a cold start both land here without passing through anything else,
  // and `/` already belongs to the dashboard.
  if (isPending) return <Loading />;
  if (!session) return <Redirect href="/sign-in" />;
  if (isLoading) return <Loading />;
  if (years.length === 0) return <Redirect href="/onboarding" />;

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: palette.text,
        tabBarInactiveTintColor: palette.textFaint,
        tabBarStyle: {
          backgroundColor: palette.background,
          borderTopWidth: StyleSheet.hairlineWidth,
          borderTopColor: palette.hairline,
          elevation: 0,
        },
        tabBarLabelStyle: { fontSize: 11, fontWeight: "500" },
      }}
      screenListeners={{ tabPress: () => haptic("selection") }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: t("Home"),
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="home-outline" size={size} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="subjects"
        options={{
          title: t("Subjects"),
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="albums-outline" size={size} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="grades"
        options={{
          title: t("Grades"),
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="list-outline" size={size} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="goals"
        options={{
          title: t("Goals"),
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="flag-outline" size={size} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="settings"
        options={{
          title: t("Settings"),
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="person-outline" size={size} color={color} />
          ),
        }}
      />
    </Tabs>
  );
}
