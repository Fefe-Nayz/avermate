import { useState } from "react";
import { Alert, Text, View } from "react-native";
import { Stack } from "expo-router";
import { useMutation, useQuery } from "@tanstack/react-query";
import { AdminGate } from "@/components/admin/admin-gate";
import { formatDateTime } from "@/components/admin/admin-screens";
import { ChoiceField } from "@/components/field";
import {
  Badge,
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

/**
 * The web's moderation queue (`admin/social/reports`), aligned: the status
 * filter, and each report carrying its whole lifecycle — status, priority,
 * assignment — inline on the card.
 */

type ReportStatus = "open" | "investigating" | "resolved" | "dismissed";
type ReportPriority = "low" | "normal" | "high" | "urgent";

const REPORT_STATUSES: ReportStatus[] = [
  "open",
  "investigating",
  "resolved",
  "dismissed",
];
const REPORT_PRIORITIES: ReportPriority[] = ["low", "normal", "high", "urgent"];

function categoryLabel(value: string): string {
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

function statusLabel(value: string): string {
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

function priorityLabel(value: string): string {
  switch (value) {
    case "low":
      return t("Low");
    case "high":
      return t("High");
    case "urgent":
      return t("Urgent");
    default:
      return t("Normal");
  }
}

/** Priority is ordered, so the marks climb: muted, accent, warning, negative. */
function PriorityMark({ priority }: { priority: string }) {
  return (
    <Badge
      label={priorityLabel(priority)}
      toneColor={
        priority === "urgent"
          ? "negative"
          : priority === "high" || priority === "normal"
            ? "accent"
            : "neutral"
      }
      icon={
        priority === "urgent" || priority === "high" ? "warning" : undefined
      }
    />
  );
}

function StatusMark({ status }: { status: string }) {
  return (
    <Badge
      label={statusLabel(status)}
      toneColor={status === "resolved" ? "positive" : "neutral"}
      icon={
        status === "open"
          ? "flag-outline"
          : status === "investigating"
            ? "search-outline"
            : status === "resolved"
              ? "checkmark-circle"
              : "remove-outline"
      }
    />
  );
}

export default function AdminSocialReports() {
  const palette = usePalette();
  const [status, setStatus] = useState<"all" | ReportStatus>("all");
  const reports = useQuery(
    orpc.admin.socialReports.queryOptions({ input: { status } }),
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
    <AdminGate>
      <Stack.Screen options={{ title: t("Reports") }} />
      <Screen>
        <Note>
          {t("What members flagged. Messages never contain academic figures.")}
        </Note>
        <ChoiceField
          label={t("Status")}
          value={status}
          onChange={(value) => setStatus(value as typeof status)}
          columns={2}
          choices={[
            { value: "all", label: t("All statuses") },
            ...REPORT_STATUSES.map((value) => ({
              value,
              label: statusLabel(value),
            })),
          ]}
        />
        <Section title={t("Queue")}>
          {reports.isLoading ? (
            <Loading />
          ) : reports.isError ? (
            <Problem>{t("Reports could not be refreshed.")}</Problem>
          ) : reports.data?.length ? (
            reports.data.map((report) => (
              <Card key={report.id} style={{ gap: space.md }}>
                <View
                  style={{
                    flexDirection: "row",
                    flexWrap: "wrap",
                    alignItems: "center",
                    gap: space.sm,
                  }}
                >
                  <Text
                    style={[
                      type.heading,
                      { flexShrink: 1, color: palette.text },
                    ]}
                  >
                    {categoryLabel(report.category)}
                  </Text>
                  <StatusMark status={report.status} />
                  <PriorityMark priority={report.priority} />
                </View>
                <Text style={[type.footnote, { color: palette.textFaint }]}>
                  {formatDateTime(report.createdAt)}
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
                  {report.assignedTo
                    ? ` · ${t("assigned to {name}", { name: report.assignedTo })}`
                    : ""}
                </Text>
                <View
                  style={{
                    flexDirection: "row",
                    flexWrap: "wrap",
                    gap: space.sm,
                  }}
                >
                  <View style={{ flexGrow: 1 }}>
                    <Button
                      size="sm"
                      label={t("Change status")}
                      variant="secondary"
                      disabled={update.isPending}
                      onPress={() =>
                        Alert.alert(t("Change status"), undefined, [
                          { text: t("Cancel"), style: "cancel" },
                          ...REPORT_STATUSES.filter(
                            (value) => value !== report.status,
                          ).map((value) => ({
                            text: statusLabel(value),
                            onPress: () =>
                              update.mutate({
                                reportId: report.id,
                                status: value,
                              }),
                          })),
                        ])
                      }
                    />
                  </View>
                  <View style={{ flexGrow: 1 }}>
                    <Button
                      size="sm"
                      label={t("Priority")}
                      variant="secondary"
                      disabled={update.isPending}
                      onPress={() =>
                        Alert.alert(t("Priority"), undefined, [
                          { text: t("Cancel"), style: "cancel" },
                          ...REPORT_PRIORITIES.filter(
                            (value) => value !== report.priority,
                          ).map((value) => ({
                            text: priorityLabel(value),
                            onPress: () =>
                              update.mutate({
                                reportId: report.id,
                                priority: value,
                              }),
                          })),
                        ])
                      }
                    />
                  </View>
                  <View style={{ flexGrow: 1 }}>
                    <Button
                      size="sm"
                      label={
                        report.assignedTo ? t("Unassign") : t("Assign to me")
                      }
                      variant="outline"
                      disabled={update.isPending}
                      onPress={() =>
                        update.mutate({
                          reportId: report.id,
                          assignToMe: !report.assignedTo,
                        })
                      }
                    />
                  </View>
                </View>
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
    </AdminGate>
  );
}
