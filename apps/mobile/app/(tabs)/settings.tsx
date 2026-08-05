import { useEffect, useState } from "react";
import { Alert } from "react-native";
import { useRouter } from "expo-router";
import * as SecureStore from "expo-secure-store";
import Constants from "expo-constants";
import { Column } from "@expo/ui";
import { Grouped, Label, Line, Loading, Row, Section, Text } from "@/components/native";
import { PickerField, SwitchField } from "@/components/controls";
import { Sign } from "@/components/icon";
import { useYear } from "@/components/year-provider";
import { signOut, useSession } from "@/lib/auth-client";
import { haptic, setHapticsEnabled } from "@/lib/haptics";
import { locale, setLocale, t, type Locale } from "@/lib/i18n";
import { queryClient } from "@/lib/orpc";
import { radius, space, usePalette } from "@/lib/theme";

const HAPTICS_KEY = "avermate.haptics";
const LOCALE_KEY = "avermate.locale";

/**
 * Settings — the hub for everything that is not a grade.
 *
 * Grouped rows, drawn by the platform, so this screen looks like the one the
 * user was in before they opened the app. Each group is one question: who you
 * are, what year you are in, how it feels, and how to get out.
 */
export default function Settings() {
  const palette = usePalette();
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
    if (value) haptic("light");
    void SecureStore.setItemAsync(HAPTICS_KEY, String(value));
  };

  const switchLanguage = (next: string) => {
    setLanguage(next as Locale);
    // The root layout listens and rebuilds the tree, so the tab bar and every
    // screen behind this one change language too, not just this screen.
    setLocale(next as Locale);
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

  const namedPeriods = periods
    .slice(0, Math.max(0, periods.length - 1))
    .map((period) => period.name);

  return (
    <Grouped>
      <Section>
        <Row spacing={space.md}>
          <Column
            alignment="center"
            style={{
              width: 52,
              height: 52,
              borderRadius: radius.pill,
              backgroundColor: palette.accentSoft,
              paddingVertical: space.lg,
            }}
          >
            <Text size="heading">{initials}</Text>
          </Column>
          <Column spacing={2}>
            <Text size="heading">{session?.user.name ?? ""}</Text>
            <Text size="footnote" tone="muted" numberOfLines={1}>
              {session?.user.email ?? ""}
            </Text>
          </Column>
        </Row>
      </Section>

      <Section title={t("School year")}>
        <Line
          leading="year"
          title={t("Current year")}
          detail={year?.name}
          onPress={() => router.push("/settings/year")}
          trailing={
            <Text size="footnote" tone="faint">
              {years.length === 1
                ? t("1 year")
                : t("{count} years", { count: years.length })}
            </Text>
          }
        />
        <Line
          leading="period"
          title={t("Periods")}
          onPress={() => router.push("/settings/periods")}
          detail={namedPeriods.length > 0 ? namedPeriods.join(" · ") : t("No split")}
        />
        <Line
          leading="average"
          title={t("Custom averages")}
          onPress={() => router.push("/settings/averages")}
        />
        <Line
          leading="card"
          title={t("Dashboard cards")}
          onPress={() => router.push("/settings/cards")}
        />
        <Line
          leading="add"
          title={t("Add a year")}
          onPress={() => router.push("/year/new")}
        />
      </Section>

      <Section title={t("Appearance")}>
        <SwitchField
          label={t("Haptic feedback")}
          detail={t("Small taps as you move through the app")}
          value={haptics}
          onValueChange={toggleHaptics}
        />
        <PickerField
          label={t("Language")}
          value={language}
          onChange={switchLanguage}
          choices={[
            { value: "fr", label: "Français" },
            { value: "en", label: "English" },
          ]}
        />
        <Line
          leading="appearance"
          title={t("Theme")}
          detail={t("Follows your device")}
        />
      </Section>

      <Section title={t("Account")}>
        <Line
          leading="account"
          title={t("Profile and password")}
          onPress={() => router.push("/settings/account")}
        />
        <Line
          leading="feedback"
          title={t("Send feedback")}
          onPress={() => router.push("/settings/feedback")}
        />
        <Line
          leading="info"
          title={t("About")}
          onPress={() => router.push("/settings/about")}
        />
        <Line
          leading="signOut"
          title={t("Sign out")}
          destructive
          onPress={leave}
        />
      </Section>

      <Section>
        <Column alignment="center" spacing={space.xs}>
          <Row spacing={space.xs}>
            <Sign glyph="review" size={14} tone="faint" />
            <Text size="footnote" tone="faint">
              {`Avermate ${Constants.expoConfig?.version ?? ""}`}
            </Text>
          </Row>
          <Label>{t("Made for students")}</Label>
        </Column>
      </Section>
    </Grouped>
  );
}
