import { Text, View } from "react-native";
import { Stack, useRouter } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { Card, Loading, Row, Screen, Section } from "@/components/ui";
import { AdminGate } from "@/components/admin/admin-gate";
import { t } from "@/lib/i18n";
import { orpc } from "@/lib/orpc";
import { numeric, space, type, usePalette } from "@/lib/theme";

/**
 * The admin overview — `AdminOverviewScreen` from
 * `components/admin/admin-screens`, declared inline so this route also links
 * to the card gallery curation screen. If that screen ever gains its row in
 * the shared component, this file can go back to a bare re-export.
 */
export default function AdminOverview() {
  const palette = usePalette();
  const router = useRouter();
  const overview = useQuery(
    orpc.admin.overview.queryOptions({ input: { days: 30 } }),
  );

  return (
    <AdminGate>
      <Stack.Screen options={{ title: t("Administration") }} />
      <Screen>
        {overview.isLoading ? <Loading /> : null}
        {overview.data ? (
          <>
            <Section title={t("Last 30 days")}>
              <View
                style={{
                  flexDirection: "row",
                  flexWrap: "wrap",
                  gap: space.sm,
                }}
              >
                {[
                  [t("Users"), overview.data.totals.users],
                  [t("Years"), overview.data.totals.years],
                  [t("Subjects"), overview.data.totals.subjects],
                  [t("Grades"), overview.data.totals.grades],
                  [t("Weekly active"), overview.data.weeklyActiveUsers],
                  [t("Open feedback"), overview.data.openFeedback],
                ].map(([label, value]) => (
                  <Card
                    key={String(label)}
                    style={{ flexBasis: "47%", flexGrow: 1 }}
                  >
                    <Text style={[type.footnote, { color: palette.textMuted }]}>
                      {label}
                    </Text>
                    <Text
                      selectable
                      style={[type.title, numeric, { color: palette.text }]}
                    >
                      {String(value)}
                    </Text>
                  </Card>
                ))}
              </View>
            </Section>
            <Section title={t("Manage")}>
              <Card padded={false}>
                <Row
                  first
                  title={t("Users")}
                  onPress={() => router.push("/admin/users")}
                />
                <Row
                  title={t("Announcements")}
                  onPress={() => router.push("/admin/announcements")}
                />
                <Row
                  title={t("Feedback")}
                  onPress={() => router.push("/admin/feedback")}
                />
                <Row
                  title={t("Social moderation")}
                  onPress={() => router.push("/admin/social")}
                />
                <Row
                  title={t("Managed presets")}
                  onPress={() => router.push("/admin/presets")}
                />
                <Row
                  title={t("Card gallery")}
                  onPress={() => router.push("/admin/card-templates")}
                />
              </Card>
            </Section>
          </>
        ) : null}
      </Screen>
    </AdminGate>
  );
}
