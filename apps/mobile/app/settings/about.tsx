import { Linking } from "react-native";
import { Stack } from "expo-router";
import Constants from "expo-constants";
import { Column, Spacer } from "@expo/ui";
import { Grouped, Label, Line, Section, Text } from "@/components/native";
import { Wordmark } from "@/components/wordmark";
import { FromReactNative } from "@/components/native";
import { haptic } from "@/lib/haptics";
import { t } from "@/lib/i18n";
import { space } from "@/lib/theme";

/**
 * About.
 *
 * Short on purpose. What the app is, what it does with your data, and where to
 * read the long version — anything more is a page nobody opens twice.
 */
export default function About() {
  const open = (url: string) => {
    haptic("light");
    void Linking.openURL(url);
  };

  return (
    <>
      <Stack.Screen options={{ title: t("About") }} />
      <Grouped>
        <Section>
          <Column spacing={space.md}>
            <FromReactNative height={30}>
              <Wordmark />
            </FromReactNative>
            <Text size="callout" tone="muted">
              {t(
                "Track your grades, understand what moves your average, and get a plan for the result you are aiming at.",
              )}
            </Text>
          </Column>
        </Section>

        <Section title={t("Your data")}>
          <Text size="footnote" tone="muted">
            {t(
              "Your grades are yours. Averages are computed on this device, not on a server, and nothing identifying you is ever compared against anybody else.",
            )}
          </Text>
        </Section>

        <Section title={t("The long version")}>
          <Line
            leading="legal"
            title={t("Terms")}
            onPress={() => open("https://avermate.fr/legal/terms")}
          />
          <Line
            leading="legal"
            title={t("Privacy")}
            onPress={() => open("https://avermate.fr/legal/privacy")}
          />
          <Line
            leading="external"
            title={t("Avermate on the web")}
            onPress={() => open("https://avermate.fr")}
          />
        </Section>

        <Section>
          <Column alignment="center" spacing={space.xs}>
            <Label>
              {t("Version {version}", {
                version: Constants.expoConfig?.version ?? "—",
              })}
            </Label>
            <Text size="footnote" tone="faint">
              {t("Made for students")}
            </Text>
          </Column>
        </Section>

        <Spacer size={space.xl} />
      </Grouped>
    </>
  );
}
