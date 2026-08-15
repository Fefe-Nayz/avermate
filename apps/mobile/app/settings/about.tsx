import { Linking, View } from "react-native";
import { Stack } from "expo-router";
import Constants from "expo-constants";
import { Card, Label, Note, Row, Screen, Section } from "@/components/ui";
import { Wordmark } from "@/components/wordmark";
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
      <Screen>
        <View style={{ gap: space.md, paddingTop: space.sm }}>
          <Wordmark />
          <Note>
            {t(
              "Track your grades, understand what moves your average, and get a plan for the result you are aiming at.",
            )}
          </Note>
        </View>

        <Section title={t("Your data")}>
          <Card>
            <Note>
              {t(
                "Your grades are yours. Averages are computed on this device, not on a server, and nothing identifying you is ever compared against anybody else.",
              )}
            </Note>
          </Card>
        </Section>

        <Section title={t("The long version")}>
          <Card padded={false}>
            <Row
              first
              title={t("Terms")}
              onPress={() => open("https://avermate.fr/legal/terms")}
            />
            <Row
              title={t("Privacy")}
              onPress={() => open("https://avermate.fr/legal/privacy")}
            />
            <Row
              title={t("Avermate on the web")}
              onPress={() => open("https://avermate.fr")}
            />
          </Card>
        </Section>

        <View style={{ alignItems: "center", gap: space.xs }}>
          <Label>
            {t("Version {version}", {
              version: Constants.expoConfig?.version ?? "—",
            })}
          </Label>
          <Note>{t("Made for students")}</Note>
        </View>
      </Screen>
    </>
  );
}
