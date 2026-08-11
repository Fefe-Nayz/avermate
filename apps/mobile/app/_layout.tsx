import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { QueryClientProvider } from "@tanstack/react-query";
import { Stack, type ErrorBoundaryProps } from "expo-router";
import { getLocales } from "expo-localization";
import * as SecureStore from "expo-secure-store";
import {
  DarkTheme,
  DefaultTheme,
  ThemeProvider,
} from "expo-router/react-navigation";
import { StatusBar } from "expo-status-bar";
import Constants from "expo-constants";
import * as Crypto from "expo-crypto";
import { Pressable, Text, View } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { YearProvider } from "@/components/year-provider";
import { PreferencesBootstrap } from "@/components/preferences-bootstrap";
import { SystemWidgetSync } from "@/components/system-widget-sync";
import { useSession } from "@/lib/auth-client";
import {
  queryScope,
  setQueryIdentity,
  subscribeQueryScope,
  type QueryScope,
} from "@/lib/query-client";
import { setHapticsEnabled } from "@/lib/haptics";
import { setInteractionPreferences } from "@/lib/interaction-preferences";
import {
  clearLocalUserSettings,
  LEGACY_LOCAL_KEYS,
  localUserKey,
} from "@/lib/local-settings";
import {
  localeRevision,
  setLocale,
  subscribeToLocale,
  t,
  type Locale,
} from "@/lib/i18n";
import {
  setSeasonalTheme,
  setThemePalette,
  setThemePreference,
  useIsDark,
  usePalette,
  space,
  type,
  type ThemePreference,
} from "@/lib/theme";
import { client } from "@/lib/orpc";
import { DEFAULT_CHART_SETTINGS, setChartSettings } from "@/lib/chart-settings";
import { clearHeldSocialInvitations } from "@/lib/social-invitation-session";

export const unstable_settings = { initialRouteName: "(tabs)" };

const reportedErrors = new Set<string>();

/** Last-resort native route boundary with one privacy-conscious report. */
export function ErrorBoundary({ error, retry }: ErrorBoundaryProps) {
  const palette = usePalette();

  useEffect(() => {
    const key = error.name.slice(0, 128) || "Error";
    if (reportedErrors.has(key)) return;
    reportedErrors.add(key);
    const appVersion = Constants.expoConfig?.version ?? "unknown";
    void Crypto.digestStringAsync(
      Crypto.CryptoDigestAlgorithm.SHA256,
      `mobile-route-boundary:${key}`,
    )
      .then((digest) =>
        client.feedback.autoReport({
          source: "mobile",
          errorDigest: `rn:${digest.slice(0, 40)}`,
          route: "/native/error-boundary",
          appVersion,
          context: {
            appVersion,
            platform: process.env.EXPO_OS ?? "unknown",
            buildVersion:
              Constants.expoConfig?.ios?.buildNumber ??
              String(Constants.expoConfig?.android?.versionCode ?? "unknown"),
          },
        }),
      )
      .catch(() => reportedErrors.delete(key));
  }, [error]);

  return (
    <View
      style={{
        flex: 1,
        justifyContent: "center",
        backgroundColor: palette.background,
        padding: space.xl,
        gap: space.lg,
      }}
    >
      <Text selectable style={[type.title, { color: palette.text }]}>
        {t("Something went wrong")}
      </Text>
      <Text selectable style={[type.body, { color: palette.textMuted }]}>
        {t("The error was reported without your grades or personal data.")}
      </Text>
      <Pressable
        accessibilityRole="button"
        onPress={retry}
        style={{
          minHeight: 52,
          alignItems: "center",
          justifyContent: "center",
          borderRadius: 12,
          backgroundColor: palette.accent,
        }}
      >
        <Text style={[type.heading, { color: palette.accentText }]}>
          {t("Try again")}
        </Text>
      </Pressable>
    </View>
  );
}

/**
 * Stored preferences, read once before anything paints.
 *
 * Language and haptics are plain module state rather than context — they are
 * read during render by hundreds of call sites and never change more than once
 * a session. Loading them up front is what keeps that honest.
 */
function resetRuntimePreferences(): void {
  const language: Locale = getLocales()[0]?.languageCode === "en" ? "en" : "fr";
  setLocale(language);
  setThemePreference("system");
  setThemePalette("default", null);
  setSeasonalTheme(true, "auto");
  setHapticsEnabled(true);
  setInteractionPreferences({ compactMode: false, reduceMotion: false });
  setChartSettings(DEFAULT_CHART_SETTINGS);
}

function usePreferences(identity: string): boolean {
  const [loadedIdentity, setLoadedIdentity] = useState<string | null>(null);
  const previousIdentity = useRef<string | null>(null);

  useEffect(() => {
    let alive = true;
    resetRuntimePreferences();

    const previous = previousIdentity.current;
    previousIdentity.current = identity;
    if (previous && previous !== identity) clearHeldSocialInvitations();
    if (previous?.startsWith("user:") && previous !== identity) {
      void clearLocalUserSettings(previous.slice(5)).catch(() => undefined);
    }

    void (async () => {
      // A global mirror cannot safely be attributed after an account switch,
      // so old builds' keys are deliberately discarded instead of migrated.
      await Promise.all(
        LEGACY_LOCAL_KEYS.map((key) => SecureStore.deleteItemAsync(key)),
      ).catch(() => undefined);

      const userId = identity.startsWith("user:") ? identity.slice(5) : null;
      if (userId) {
        const [language, haptics, theme] = await Promise.all([
          SecureStore.getItemAsync(localUserKey(userId, "locale")),
          SecureStore.getItemAsync(localUserKey(userId, "haptics")),
          SecureStore.getItemAsync(localUserKey(userId, "theme")),
        ]).catch(() => [null, null, null] as const);
        if (!alive) return;
        if (language === "fr" || language === "en") {
          setLocale(language as Locale);
        }
        if (haptics !== null) setHapticsEnabled(haptics === "true");
        if (theme === "system" || theme === "light" || theme === "dark") {
          setThemePreference(theme as ThemePreference);
        }
      }

      if (alive) setLoadedIdentity(identity);
    })();

    return () => {
      alive = false;
    };
  }, [identity]);

  return loadedIdentity === identity;
}

export default function RootLayout() {
  const session = useSession();
  const identity = session.isPending
    ? "pending"
    : session.data?.user.id
      ? `user:${session.data.user.id}`
      : "anonymous";
  const scope = useSyncExternalStore(
    subscribeQueryScope,
    queryScope,
    queryScope,
  );
  const preferencesReady = usePreferences(identity);

  useEffect(() => {
    setQueryIdentity(identity);
  }, [identity]);

  // Never render a new identity under the previous identity's provider, even
  // for the single commit before the effect rotates the cache.
  if (scope.identity !== identity || !preferencesReady) {
    return <View style={{ flex: 1, backgroundColor: "#0B0B0A" }} />;
  }

  return <ReadyLayout scope={scope} />;
}

function ReadyLayout({ scope }: { scope: QueryScope }) {
  const isDark = useIsDark();
  const palette = usePalette();
  const language = useSyncExternalStore(subscribeToLocale, localeRevision);

  // The navigation theme drives the header and card backgrounds React
  // Navigation draws itself, so it has to read from the same palette as
  // everything else or the seams show.
  const navigationTheme = {
    ...(isDark ? DarkTheme : DefaultTheme),
    colors: {
      ...(isDark ? DarkTheme : DefaultTheme).colors,
      background: palette.background,
      card: palette.background,
      text: palette.text,
      border: palette.hairline,
      primary: palette.accent,
    },
  };

  return (
    <QueryClientProvider key={scope.generation} client={scope.client}>
      <SafeAreaProvider>
        <ThemeProvider value={navigationTheme}>
          <StatusBar style={isDark ? "light" : "dark"} />
          <GestureHandlerRootView style={{ flex: 1 }}>
            {/* Keying on language rebuilds every screen, including tab labels. */}
            <YearProvider key={language}>
              <PreferencesBootstrap />
              <SystemWidgetSync />
              <Stack
                screenOptions={{
                  headerShadowVisible: false,
                  headerTitleStyle: { fontSize: 17, fontWeight: "600" },
                  headerBackButtonDisplayMode: "minimal",
                  contentStyle: { backgroundColor: palette.background },
                }}
              >
                <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
                <Stack.Screen name="sign-in" options={{ headerShown: false }} />
                <Stack.Screen name="sign-up" options={{ title: "" }} />
                <Stack.Screen name="verify-email" options={{ title: "" }} />
                <Stack.Screen name="forgot-password" options={{ title: "" }} />
                <Stack.Screen
                  name="onboarding"
                  options={{ headerShown: false }}
                />
                {/*
                 * Pushed, never presented as a modal. A form on a phone is a
                 * place you go, with a back gesture that means "leave" — not
                 * a card floating over the thing you were reading.
                 */}
                <Stack.Screen
                  name="grade/new"
                  options={{ title: t("New grade") }}
                />
                <Stack.Screen name="grade/[id]" options={{ title: "" }} />
                <Stack.Screen name="average/[id]" options={{ title: "" }} />
                <Stack.Screen name="subject/[id]" options={{ title: "" }} />
                <Stack.Screen name="subject/new" options={{ title: "" }} />
                <Stack.Screen name="subject/edit" options={{ title: "" }} />
                <Stack.Screen name="goal/[id]" options={{ title: "" }} />
                <Stack.Screen name="goal/edit" options={{ title: "" }} />
                <Stack.Screen
                  name="goal/new"
                  options={{ title: t("New goal") }}
                />
                <Stack.Screen name="year/new" options={{ title: "" }} />
                <Stack.Screen
                  name="announcements"
                  options={{ title: t("Announcements") }}
                />
                <Stack.Screen
                  name="settings/appearance"
                  options={{ title: t("Appearance") }}
                />
                <Stack.Screen
                  name="settings/integrations"
                  options={{ title: t("Integrations") }}
                />
                <Stack.Screen
                  name="settings/system-widget"
                  options={{ title: t("Home screen widget") }}
                />
                <Stack.Screen
                  name="settings/widget-library"
                  options={{ title: t("Widget library") }}
                />
                <Stack.Screen
                  name="social/index"
                  options={{ title: t("Social") }}
                />
                <Stack.Screen
                  name="social/setup"
                  options={{ title: t("Social setup") }}
                />
                <Stack.Screen
                  name="social/profile"
                  options={{ title: t("Social profile") }}
                />
                <Stack.Screen
                  name="social/friends"
                  options={{ title: t("Friends") }}
                />
                <Stack.Screen
                  name="social/friend/[friendshipId]"
                  options={{ title: t("Shared profile") }}
                />
                <Stack.Screen
                  name="social/friend-invitations/index"
                  options={{ title: t("Private invitations") }}
                />
                <Stack.Screen
                  name="social/friend-invitations/[token]"
                  options={{ title: t("Friend invitation") }}
                />
                <Stack.Screen
                  name="social/circles/index"
                  options={{ title: t("Friend circles") }}
                />
                <Stack.Screen
                  name="social/circles/[circleId]"
                  options={{ title: t("Friend circle") }}
                />
                <Stack.Screen
                  name="social/blocks"
                  options={{ title: t("Blocked accounts") }}
                />
                <Stack.Screen
                  name="social/grants"
                  options={{ title: t("Sharing permissions") }}
                />
                <Stack.Screen
                  name="social/groups/index"
                  options={{ title: t("Groups and classes") }}
                />
                <Stack.Screen
                  name="social/groups/new"
                  options={{ title: t("Create a group") }}
                />
                <Stack.Screen
                  name="social/groups/[groupId]/index"
                  options={{ title: t("Group") }}
                />
                <Stack.Screen
                  name="social/groups/[groupId]/metric"
                  options={{ title: t("Group statistics") }}
                />
                <Stack.Screen
                  name="social/groups/[groupId]/invitations"
                  options={{ title: t("Group invitations") }}
                />
                <Stack.Screen
                  name="social/groups/[groupId]/manage"
                  options={{ title: t("Group settings") }}
                />
                <Stack.Screen
                  name="social/groups/[groupId]/policy"
                  options={{ title: t("New policy version") }}
                />
                <Stack.Screen
                  name="social/invitations/[token]"
                  options={{ title: t("Group invitation") }}
                />
                <Stack.Screen
                  name="social/invitation"
                  options={{ title: t("Private social invitation") }}
                />
                <Stack.Screen
                  name="social/invitation-process"
                  options={{ title: t("Private social invitation") }}
                />
                <Stack.Screen
                  name="social/notifications"
                  options={{ title: t("Social notifications") }}
                />
                <Stack.Screen
                  name="social/report"
                  options={{ title: t("Report a safety concern") }}
                />
                <Stack.Screen
                  name="social/reports"
                  options={{ title: t("Submitted reports") }}
                />
                <Stack.Screen
                  name="admin/index"
                  options={{ title: t("Administration") }}
                />
                <Stack.Screen
                  name="admin/users"
                  options={{ title: t("Users") }}
                />
                <Stack.Screen
                  name="admin/user/[id]"
                  options={{ title: t("User") }}
                />
                <Stack.Screen
                  name="admin/announcements"
                  options={{ title: t("Announcements") }}
                />
                <Stack.Screen
                  name="admin/feedback"
                  options={{ title: t("Feedback") }}
                />
                <Stack.Screen
                  name="admin/feedback/[id]"
                  options={{ title: t("Feedback detail") }}
                />
                <Stack.Screen
                  name="admin/social/index"
                  options={{ title: t("Social moderation") }}
                />
                <Stack.Screen
                  name="admin/social/reports"
                  options={{ title: t("Safety reports") }}
                />
                <Stack.Screen
                  name="admin/social/report/[id]"
                  options={{ title: t("Safety report") }}
                />
                <Stack.Screen
                  name="admin/social/groups"
                  options={{ title: t("Social groups") }}
                />
                <Stack.Screen
                  name="admin/social/audit"
                  options={{ title: t("Social audit") }}
                />
                <Stack.Screen
                  name="admin/presets"
                  options={{ title: t("Managed presets") }}
                />
                <Stack.Screen
                  name="admin/preset/new"
                  options={{ title: t("New managed preset") }}
                />
                <Stack.Screen
                  name="admin/preset/[id]"
                  options={{ title: t("Managed preset") }}
                />
              </Stack>
            </YearProvider>
          </GestureHandlerRootView>
        </ThemeProvider>
      </SafeAreaProvider>
    </QueryClientProvider>
  );
}
