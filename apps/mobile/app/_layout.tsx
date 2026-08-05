import { useEffect, useState, useSyncExternalStore } from "react";
import { QueryClientProvider } from "@tanstack/react-query";
import { Stack } from "expo-router";
import * as SecureStore from "expo-secure-store";
import {
  DarkTheme,
  DefaultTheme,
  ThemeProvider,
} from "expo-router/react-navigation";
import { StatusBar } from "expo-status-bar";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { YearProvider } from "@/components/year-provider";
import { Loading } from "@/components/native";
import { queryClient } from "@/lib/orpc";
import { setHapticsEnabled } from "@/lib/haptics";
import {
  localeRevision,
  setLocale,
  subscribeToLocale,
  t,
  type Locale,
} from "@/lib/i18n";
import { useIsDark, usePalette } from "@/lib/theme";

export const unstable_settings = { initialRouteName: "(tabs)" };

/**
 * Stored preferences, read once before anything paints.
 *
 * Language and haptics are plain module state rather than context — they are
 * read during render by hundreds of call sites and never change more than once
 * a session. Loading them up front is what keeps that honest.
 */
function usePreferences(): boolean {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    void Promise.all([
      SecureStore.getItemAsync("avermate.locale"),
      SecureStore.getItemAsync("avermate.haptics"),
    ]).then(([language, haptics]) => {
      if (language === "fr" || language === "en") setLocale(language as Locale);
      if (haptics !== null) setHapticsEnabled(haptics === "true");
      setReady(true);
    });
  }, []);

  return ready;
}

export default function RootLayout() {
  const isDark = useIsDark();
  const palette = usePalette();
  const ready = usePreferences();
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
    <QueryClientProvider client={queryClient}>
      <SafeAreaProvider>
        <ThemeProvider value={navigationTheme}>
          <StatusBar style={isDark ? "light" : "dark"} />
          <GestureHandlerRootView style={{ flex: 1 }}>
            {ready ? (
              // Keyed on the language so switching it rebuilds every screen
              // rather than only the one in front of you.
              <YearProvider key={language}>
                <Stack
                  screenOptions={{
                    headerShadowVisible: false,
                    headerTitleStyle: { fontSize: 17, fontWeight: "600" },
                    headerBackButtonDisplayMode: "minimal",
                    contentStyle: { backgroundColor: palette.background },
                  }}
                >
                  <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
                  <Stack.Screen
                    name="sign-in"
                    options={{ headerShown: false }}
                  />
                  <Stack.Screen name="sign-up" options={{ title: "" }} />
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
                </Stack>
              </YearProvider>
            ) : (
              <Loading />
            )}
          </GestureHandlerRootView>
        </ThemeProvider>
      </SafeAreaProvider>
    </QueryClientProvider>
  );
}
