import { Alert, ScrollView, Text, View } from "react-native";
import { useRouter } from "expo-router";
import Constants from "expo-constants";
import { useQuery } from "@tanstack/react-query";
import { Heading, Card, Loading, Row, Section } from "@/components/ui";
import { useYear } from "@/components/year-provider";
import { signOut, useSession } from "@/lib/auth-client";
import { haptic } from "@/lib/haptics";
import { t } from "@/lib/i18n";
import { orpc, queryClient } from "@/lib/orpc";
import { clearLocalUserSettings } from "@/lib/local-settings";
import { radius, space, type, usePalette } from "@/lib/theme";

/**
 * Settings.
 *
 * Everything here is either about you, about how the app feels, or about
 * getting out. Cross-device appearance and interaction preferences live on a
 * dedicated screen so this index stays quick to scan.
 */
export default function Settings() {
  const palette = usePalette();
  const router = useRouter();
  const { data: session, isPending } = useSession();
  const { year, years, periods } = useYear();
  const announcements = useQuery({
    ...orpc.announcements.active.queryOptions({
      input: { yearId: year?.id ?? "" },
    }),
    enabled: Boolean(year?.id),
  });
  const admin = useQuery(orpc.admin.access.queryOptions());

  const leave = () => {
    Alert.alert(t("Sign out"), t("You will need your password to come back."), [
      { text: t("Cancel"), style: "cancel" },
      {
        text: t("Sign out"),
        style: "destructive",
        onPress: () => {
          haptic("warning");
          void signOut().then(async () => {
            if (session?.user.id) {
              await clearLocalUserSettings(session.user.id).catch(
                () => undefined,
              );
            }
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
      contentInsetAdjustmentBehavior="never"
      style={{ flex: 1, backgroundColor: palette.background }}
      contentContainerStyle={{
        paddingTop: space.md,
        paddingHorizontal: space.lg,
        paddingBottom: space.xxxl,
        gap: space.xl,
      }}
      showsVerticalScrollIndicator={false}
    >
      <Heading icon="settings" title={t("Settings")} />

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
            title={t("Year preset")}
            subtitle={t("Official curriculum and updates")}
            onPress={() => router.push("/settings/preset")}
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
            title={t("Home screen widget")}
            subtitle={t("Private, aggregate-only progress")}
            onPress={() => router.push("/settings/system-widget")}
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
            title={t("Theme, language and interaction")}
            subtitle={t("Shared with the web app")}
            onPress={() => router.push("/settings/appearance")}
          />
          <Row
            title={t("Navigation")}
            subtitle={t("Choose the three tabs you reach for")}
            onPress={() => router.push("/settings/navigation")}
          />
        </Card>
      </Section>

      <Section title={t("Account")}>
        <Card padded={false}>
          <Row
            first
            title={t("Profile and password")}
            onPress={() => router.push("/settings/account")}
          />
          <Row
            title={t("Announcements")}
            subtitle={
              (announcements.data?.length ?? 0) > 0
                ? t("{count} unread", {
                    count: announcements.data?.length ?? 0,
                  })
                : t("Your inbox")
            }
            onPress={() => router.push("/announcements")}
          />
          <Row
            title={t("Integrations")}
            subtitle={t("Connect AI assistants with OAuth")}
            onPress={() => router.push("/settings/integrations")}
          />
          <Row
            title={t("Social, friends and classes")}
            subtitle={t("Private by default; sharing is always explicit")}
            onPress={() => router.push("/social")}
          />
          <Row
            title={t("Send feedback")}
            onPress={() => router.push("/settings/feedback")}
          />
          <Row
            title={t("About")}
            onPress={() => router.push("/settings/about")}
          />
          <Row title={t("Sign out")} destructive onPress={leave} />
        </Card>
      </Section>

      {admin.data?.isAdmin ? (
        <Section title={t("Administration")}>
          <Card padded={false}>
            <Row
              first
              title={t("Open admin console")}
              subtitle={t("Users, announcements and feedback")}
              onPress={() => router.push("/admin")}
            />
          </Card>
        </Section>
      ) : null}

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
