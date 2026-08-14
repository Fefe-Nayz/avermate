import { Alert, Text } from "react-native";
import { Stack } from "expo-router";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  Button,
  Card,
  Empty,
  Loading,
  Note,
  Problem,
  Screen,
  Section,
} from "@/components/ui";
import { haptic } from "@/lib/haptics";
import { t } from "@/lib/i18n";
import { orpc, queryClient } from "@/lib/orpc";
import { space, type, usePalette } from "@/lib/theme";

function categoryLabel(value: string) {
  switch (value) {
    case "harassment":
      return t("Harassment");
    case "privacy":
      return t("Privacy");
    case "impersonation":
      return t("Impersonation");
    case "unsafe_content":
      return t("Unsafe content");
    default:
      return t("Other");
  }
}

function statusLabel(value: string) {
  switch (value) {
    case "open":
      return t("Open");
    case "investigating":
      return t("Investigating");
    case "resolved":
      return t("Resolved");
    default:
      return t("Dismissed");
  }
}

/** The moderation queue, each report with its lifecycle inline. */
export function AdminSocialReportsScreen() {
  const palette = usePalette();
  const reports = useQuery(
    orpc.admin.socialReports.queryOptions({ input: { status: "all" } }),
  );
  const update = useMutation({
    ...orpc.admin.updateSocialReport.mutationOptions(),
    onSuccess: async () => {
      haptic("success");
      await queryClient.invalidateQueries({
        queryKey: orpc.admin.socialReports.key(),
      });
    },
  });

  return (
    <>
      <Stack.Screen options={{ title: t("Reports") }} />
      <Screen>
        <Note>
          {t("What members flagged. Messages never contain academic figures.")}
        </Note>
        <Section title={t("Queue")}>
          {reports.isLoading ? (
            <Loading />
          ) : reports.isError ? (
            <Problem>{t("Reports could not be refreshed.")}</Problem>
          ) : reports.data?.length ? (
            reports.data.map((report) => (
              <Card key={report.id} style={{ gap: space.md }}>
                <Text style={[type.heading, { color: palette.text }]}>
                  {categoryLabel(report.category)} ·{" "}
                  {statusLabel(report.status)}
                </Text>
                <Text selectable style={[type.body, { color: palette.text }]}>
                  {report.message}
                </Text>
                <Text style={[type.footnote, { color: palette.textMuted }]}>
                  {t("From {name}", { name: report.reporter })}
                  {report.target
                    ? ` · ${t("about {name}", { name: report.target })}`
                    : ""}
                  {report.groupName
                    ? ` · ${t("class {name}", { name: report.groupName })}`
                    : ""}
                </Text>
                <Button
                  label={t("Change status")}
                  variant="secondary"
                  disabled={update.isPending}
                  onPress={() =>
                    Alert.alert(t("Change status"), undefined, [
                      { text: t("Cancel"), style: "cancel" },
                      ...(
                        [
                          "open",
                          "investigating",
                          "resolved",
                          "dismissed",
                        ] as const
                      )
                        .filter((status) => status !== report.status)
                        .map((status) => ({
                          text: statusLabel(status),
                          onPress: () =>
                            update.mutate({ reportId: report.id, status }),
                        })),
                    ])
                  }
                />
              </Card>
            ))
          ) : (
            <Empty
              icon="flag-outline"
              title={t("No reports")}
              body={t("Nothing waits in this view.")}
            />
          )}
        </Section>
      </Screen>
    </>
  );
}
