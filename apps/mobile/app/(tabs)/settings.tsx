import { useEffect, useState } from "react";
import { Alert, ScrollView, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as SecureStore from "expo-secure-store";
import Constants from "expo-constants";
import { Card, Loading, Row, Section } from "@/components/ui";
import { NativeSwitch } from "@/components/native-controls";
import { useYear } from "@/components/year-provider";
import { signOut, useSession } from "@/lib/auth-client";
import { haptic, setHapticsEnabled } from "@/lib/haptics";
import { locale, setLocale, t, type Locale } from "@/lib/i18n";
import { queryClient } from "@/lib/orpc";
import { radius, space, type, usePalette } from "@/lib/theme";

const HAPTICS_KEY = "avermate.haptics";
const LOCALE_KEY = "avermate.locale";

/**
 * Settings.
 *
 * Everything here is either about you, about how the app feels, or about
 * getting out. Preferences that only make sense with a mouse — chart
 * subdivisions, theme presets, custom colours — deliberately stay on the web:
 * shipping them here would double the surface for no one's benefit.
 */
export default function Settings() {
  const palette = usePalette();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { data: session, isPending } = useSession();
  const { year, years, periods } = useYear();

  const [haptics, setHaptics] = useState(true);
  const [language, setLanguage] = useState<Locale>(locale());

  useEffect(() => {
    void SecureStore.getItemAsync(HAPTICS_KEY).then((stored) => {
      if (stored === null) return;
      const enabled = stored === "true";
      setHaptics(enabled);
      setHapticsEnabled(enabled);
    });
  }, []);

  const toggleHaptics = (value: boolean) => {
    setHaptics(value);
    setHapticsEnabled(value);
    // Fire after enabling so the switch confirms itself in the hand.
    if (value) haptic("light");
    void SecureStore.setItemAsync(HAPTICS_KEY, String(value));
  };

  const switchLanguage = (next: Locale) => {
    haptic("selection");
    setLanguage(next);
    // The root layout listens and rebuilds the tree, so the tab bar and every
    // screen behind this one change language too, not just this screen.
    setLocale(next);
    void SecureStore.setItemAsync(LOCALE_KEY, next);
  };

  const leave = () => {
    Alert.alert(t("Sign out"), t("You will need your password to come back."), [
      { text: t("Cancel"), style: "cancel" },
      {
        text: t("Sign out"),
        style: "destructive",
        onPress: () => {
          haptic("warning");
          void signOut().then(() => {
            queryClient.clear();
            router.replace("/sign-in");
          });
        },
      },
    ]);
  };

  if (isPending) return <Loading />;

  const initials = (session?.user.name ?? "?")
    .split(" ")
    .map((part) => part[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: palette.background }}
      contentContainerStyle={{
        paddingTop: insets.top + space.md,
        paddingHorizontal: space.lg,
        paddingBottom: space.xxxl,
        gap: space.xl,
      }}
      showsVerticalScrollIndicator={false}
    >
      <Text style={[type.display, { color: palette.text }]}>
        {t("Settings")}
      </Text>

      <Card>
        <View
          style={{ flexDirection: "row", alignItems: "center", gap: space.md }}
        >
          <View
            style={{
              width: 48,
              height: 48,
              borderRadius: radius.pill,
              backgroundColor: palette.accentSoft,
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <Text style={[type.heading, { color: palette.text }]}>
              {initials}
            </Text>
          </View>
          <View style={{ flex: 1, gap: 2 }}>
            <Text style={[type.heading, { color: palette.text }]}>
              {session?.user.name}
            </Text>
            <Text
              numberOfLines={1}
              style={[type.footnote, { color: palette.textMuted }]}
            >
              {session?.user.email}
            </Text>
          </View>
        </View>
      </Card>

      <Section title={t("School year")}>
        <Card padded={false}>
          <Row
            first
            title={t("Current year")}
            subtitle={year?.name}
            onPress={() => router.push("/settings/year")}
            trailing={
              <Text style={[type.footnote, { color: palette.textFaint }]}>
                {years.length === 1
                  ? t("1 year")
                  : t("{count} years", { count: years.length })}
              </Text>
            }
          />
          <Row
            title={t("Periods")}
            onPress={() => router.push("/settings/periods")}
            subtitle={
              periods.length > 1
                ? periods
                    .slice(0, periods.length - 1)
                    .map((period) => period.name)
                    .join(" · ")
                : t("No split")
            }
          />
          <Row
            title={t("Custom averages")}
            onPress={() => router.push("/settings/averages")}
          />
          <Row
            title={t("Dashboard cards")}
            onPress={() => router.push("/settings/cards")}
          />
          <Row
            title={t("Add a year")}
            onPress={() => router.push("/year/new")}
          />
        </Card>
      </Section>

      <Section title={t("Appearance")}>
        <Card padded={false}>
          <Row
            first
            title={t("Haptic feedback")}
            subtitle={t("Small taps as you move through the app")}
            trailing={
              <NativeSwitch value={haptics} onValueChange={toggleHaptics} />
            }
          />
          <Row
            title={t("Language")}
            onPress={() => switchLanguage(language === "fr" ? "en" : "fr")}
            trailing={
              <Text style={[type.body, { color: palette.textMuted }]}>
                {language === "fr" ? "Français" : "English"}
              </Text>
            }
          />
        </Card>
        <Text
          style={[
            type.footnote,
            { color: palette.textFaint, paddingHorizontal: space.xs },
          ]}
        >
          {t("The app follows your device's light or dark setting.")}
        </Text>
      </Section>

      <Section title={t("Account")}>
        <Card padded={false}>
          <Row
            first
            title={t("Profile and password")}
            onPress={() => router.push("/settings/account")}
          />
          <Row
            title={t("Send feedback")}
            onPress={() => router.push("/settings/feedback")}
          />
          <Row
            title={t("About")}
            onPress={() => router.push("/settings/about")}
          />
          <Row
            title={t("Sign out")}
            destructive
            onPress={leave}
          />
        </Card>
      </Section>

      <View style={{ alignItems: "center", gap: space.xs }}>
        <Text style={[type.footnote, { color: palette.textFaint }]}>
          Avermate {Constants.expoConfig?.version ?? ""}
        </Text>
        <Text style={[type.footnote, { color: palette.textFaint }]}>
          {t("Made for students")}
        </Text>
      </View>
    </ScrollView>
  );
}
