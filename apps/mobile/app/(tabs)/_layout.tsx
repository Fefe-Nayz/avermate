import { Redirect, Tabs } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { Loading } from "@/components/ui";
import { AnnouncementBanner } from "@/components/announcements/announcement-banner";
import { QuickAddProvider } from "@/components/quick-add";
import { TabBar } from "@/components/tab-bar";
import { useYear } from "@/components/year-provider";
import { useSession } from "@/lib/auth-client";
import { usePalette } from "@/lib/theme";

/**
 * The shell: three destinations of the account's choosing, the raised "+"
 * that records a grade, and "More" holding everything else — the same
 * arrangement as the web's phone chrome. Every route in the group stays
 * registered whether or not it is pinned, so a deep link or a More row can
 * always land.
 *
 * Each screen draws its own large title in content rather than in a
 * navigation bar: the header then scrolls away with the page, which is what
 * gives a phone back the vertical space a fixed bar would eat.
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
    <SafeAreaView
      edges={["top"]}
      style={{ flex: 1, backgroundColor: palette.background }}
    >
      <AnnouncementBanner />
      <QuickAddProvider>
        <Tabs
          screenOptions={{ headerShown: false }}
          tabBar={(props) => <TabBar {...props} />}
        >
          <Tabs.Screen name="index" />
          <Tabs.Screen name="subjects" />
          <Tabs.Screen name="grades" />
          <Tabs.Screen name="goals" />
          <Tabs.Screen name="insights" />
          <Tabs.Screen name="social" />
          <Tabs.Screen name="more" />
          <Tabs.Screen name="settings" />
        </Tabs>
      </QuickAddProvider>
    </SafeAreaView>
  );
}
