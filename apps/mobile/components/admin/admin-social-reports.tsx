import { useState } from "react";
import { Alert, Text, View } from "react-native";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useMutation, useQuery } from "@tanstack/react-query";
import { AdminGate } from "@/components/admin/admin-gate";
import { ChoiceField, TextField } from "@/components/field";
import {
  Button,
  Card,
  Empty,
  Loading,
  Note,
  Problem,
  Row,
  Screen,
  Section,
} from "@/components/ui";
import { haptic } from "@/lib/haptics";
import { t } from "@/lib/i18n";
import { orpc, queryClient } from "@/lib/orpc";
import { space, type, usePalette } from "@/lib/theme";

type ReportStatus = "open" | "investigating" | "resolved" | "dismissed";
type ReportPriority = "low" | "normal" | "high" | "urgent";
const REPORT_STATUSES: ReportStatus[] = [
  "open",
  "investigating",
  "resolved",
  "dismissed",
];
const REPORT_PRIORITIES: ReportPriority[] = ["low", "normal", "high", "urgent"];

function reportLabel(value: string): string {
  return t(value.charAt(0).toUpperCase() + value.slice(1));
}

async function refreshReports(): Promise<void> {
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: orpc.admin.socialReports.key() }),
    queryClient.invalidateQueries({
      queryKey: orpc.admin.socialReportDetail.key(),
    }),
    queryClient.invalidateQueries({
      queryKey: orpc.admin.socialOverview.key(),
    }),
    queryClient.invalidateQueries({ queryKey: orpc.admin.socialAudit.key() }),
  ]);
}

export function AdminSocialReportsScreen() {
  const palette = usePalette();
  const router = useRouter();
  const [status, setStatus] = useState<ReportStatus | "all">("all");
  const [priority, setPriority] = useState<ReportPriority | "all">("all");
  const [search, setSearch] = useState("");
  const [offset, setOffset] = useState(0);
  const reports = useQuery(
    orpc.admin.socialReports.queryOptions({
      input: {
        statuses: status === "all" ? [] : [status],
        priorities: priority === "all" ? [] : [priority],
        search: search.trim(),
        limit: 25,
        offset,
      },
    }),
  );

  return (
    <AdminGate>
      <Stack.Screen options={{ title: t("Safety reports") }} />
      <Screen>
        <Note>
          {t(
            "Moderation shows the submitted safety message and opaque target capabilities, never grades or academic rows.",
          )}
        </Note>
        <Section title={t("Filters")}>
          <TextField
            label={t("Search report message")}
            value={search}
            onChangeText={(value) => {
              setSearch(value);
              setOffset(0);
            }}
          />
          <ChoiceField
            label={t("Status")}
            value={status}
            onChange={(value) => {
              setStatus(value as typeof status);
              setOffset(0);
            }}
            columns={2}
            choices={[
              { value: "all", label: t("All") },
              ...REPORT_STATUSES.map((value) => ({
                value,
                label: reportLabel(value),
              })),
            ]}
          />
          <ChoiceField
            label={t("Priority")}
            value={priority}
            onChange={(value) => {
              setPriority(value as typeof priority);
              setOffset(0);
            }}
            columns={2}
            choices={[
              { value: "all", label: t("All") },
              ...REPORT_PRIORITIES.map((value) => ({
                value,
                label: reportLabel(value),
              })),
            ]}
          />
        </Section>

        {reports.isLoading ? <Loading /> : null}
        {reports.isError ? (
          <Problem>{t("Social reports could not be loaded.")}</Problem>
        ) : null}
        <Section
          title={t("{count} reports", { count: reports.data?.total ?? 0 })}
        >
          {(reports.data?.items.length ?? 0) === 0 && !reports.isLoading ? (
            <Empty icon="shield-checkmark-outline" title={t("Nothing here")} />
          ) : (
            <Card padded={false}>
              {reports.data?.items.map((report, index) => (
                <Row
                  key={report.id}
                  first={index === 0}
                  title={report.category}
                  subtitle={`${report.priority} · ${report.status} · ${new Date(
                    report.updatedAt,
                  ).toLocaleDateString()}`}
                  onPress={() =>
                    router.push(`/admin/social/report/${report.id}`)
                  }
                  trailing={
                    <Text style={[type.footnote, { color: palette.textMuted }]}>
                      {report.groupId
                        ? t("Group")
                        : report.hasTargetUser
                          ? t("Account")
                          : t("Request")}
                    </Text>
                  }
                />
              ))}
            </Card>
          )}
          <View style={{ flexDirection: "row", gap: space.sm }}>
            <View style={{ flex: 1 }}>
              <Button
                label={t("Previous")}
                variant="ghost"
                disabled={offset === 0}
                onPress={() => setOffset(Math.max(0, offset - 25))}
              />
            </View>
            <View style={{ flex: 1 }}>
              <Button
                label={t("Next")}
                variant="ghost"
                disabled={
                  !reports.data ||
                  reports.data.offset + reports.data.limit >= reports.data.total
                }
                onPress={() => setOffset(offset + 25)}
              />
            </View>
          </View>
        </Section>
      </Screen>
    </AdminGate>
  );
}

export function AdminSocialReportDetailScreen() {
  const palette = usePalette();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [reason, setReason] = useState("");
  const report = useQuery({
    ...orpc.admin.socialReportDetail.queryOptions({ input: { reportId: id } }),
    enabled: Boolean(id),
  });
  const assignees = useQuery(orpc.admin.feedbackAssignees.queryOptions());
  const groups = useQuery({
    ...orpc.admin.socialGroups.queryOptions({
      input: {
        state: "all",
        type: "all",
        search: "",
        limit: 100,
        offset: 0,
      },
    }),
    enabled: Boolean(report.data?.groupId),
  });
  const affectedGroup = groups.data?.items.find(
    (group) => group.id === report.data?.groupId,
  );

  const update = useMutation({
    ...orpc.admin.updateSocialReport.mutationOptions(),
    onSuccess: async () => {
      haptic("success");
      await refreshReports();
    },
  });
  const freezeProfile = useMutation({
    ...orpc.admin.freezeSocialProfile.mutationOptions(),
    onSuccess: async () => {
      haptic("warning");
      setReason("");
      await refreshReports();
    },
  });
  const freezeGroup = useMutation({
    ...orpc.admin.freezeSocialGroup.mutationOptions(),
    onSuccess: async () => {
      haptic("warning");
      setReason("");
      await Promise.all([
        refreshReports(),
        queryClient.invalidateQueries({
          queryKey: orpc.admin.socialGroups.key(),
        }),
      ]);
    },
  });

  const patch = (value: {
    status?: ReportStatus;
    priority?: ReportPriority;
    assignedToUserId?: string | null;
  }) => {
    if (!report.data) return;
    update.mutate({
      reportId: report.data.id,
      expectedRevision: report.data.revision,
      ...value,
    });
  };

  const confirmFreeze = () => {
    if (!report.data || reason.trim().length < 10) return;
    const isGroup = Boolean(report.data.groupId);
    Alert.alert(
      isGroup ? t("Freeze this group?") : t("Freeze the reported profile?"),
      t(
        "Sharing stops immediately. This action is audited and does not expose or alter academic records.",
      ),
      [
        { text: t("Cancel"), style: "cancel" },
        {
          text: t("Freeze"),
          style: "destructive",
          onPress: () => {
            if (report.data?.targetUserId) {
              freezeProfile.mutate({
                userId: report.data.targetUserId,
                frozen: true,
                reason: reason.trim(),
              });
            } else if (affectedGroup) {
              freezeGroup.mutate({
                groupId: affectedGroup.id,
                frozen: true,
                expectedRevision: affectedGroup.revision,
                reason: reason.trim(),
              });
            }
          },
        },
      ],
    );
  };

  return (
    <AdminGate>
      <Stack.Screen options={{ title: t("Safety report") }} />
      {report.isLoading ? <Loading /> : null}
      {report.isError ? (
        <Screen>
          <Problem>{t("This safety report could not be loaded.")}</Problem>
        </Screen>
      ) : null}
      {report.data ? (
        <Screen>
          <Section title={report.data.category}>
            <Card style={{ gap: space.md }}>
              <Text selectable style={[type.body, { color: palette.text }]}>
                {report.data.message}
              </Text>
              <Text
                selectable
                style={[type.footnote, { color: palette.textMuted }]}
              >
                {t("Reported by {name}", {
                  name: report.data.reporter.name,
                })}{" "}
                · {new Date(report.data.createdAt).toLocaleString()}
              </Text>
              <Note>
                {t(
                  "The target remains an administrator-only capability. Grades, subjects and raw school records are not part of this view.",
                )}
              </Note>
            </Card>
          </Section>

          <Section title={t("Moderation decision")}>
            <ChoiceField
              label={t("Status")}
              value={report.data.status}
              onChange={(value) => patch({ status: value as ReportStatus })}
              columns={2}
              choices={REPORT_STATUSES.map((value) => ({
                value,
                label: reportLabel(value),
              }))}
            />
            <ChoiceField
              label={t("Priority")}
              value={report.data.priority}
              onChange={(value) => patch({ priority: value as ReportPriority })}
              columns={2}
              choices={REPORT_PRIORITIES.map((value) => ({
                value,
                label: reportLabel(value),
              }))}
            />
            <ChoiceField
              label={t("Assigned administrator")}
              value={report.data.assignedToUserId ?? ""}
              onChange={(value) => patch({ assignedToUserId: value || null })}
              choices={[
                { value: "", label: t("Unassigned") },
                ...(assignees.data ?? []).map((admin) => ({
                  value: admin.id,
                  label: admin.name,
                  hint: admin.email,
                })),
              ]}
            />
            <View style={{ flexDirection: "row", gap: space.sm }}>
              <View style={{ flex: 1 }}>
                <Button
                  label={t("Resolve")}
                  variant="secondary"
                  disabled={update.isPending}
                  onPress={() => patch({ status: "resolved" })}
                />
              </View>
              <View style={{ flex: 1 }}>
                <Button
                  label={t("Dismiss")}
                  variant="ghost"
                  disabled={update.isPending}
                  onPress={() => patch({ status: "dismissed" })}
                />
              </View>
            </View>
            {update.isError ? (
              <Problem>
                {t(
                  "This report changed elsewhere. Refresh before trying again.",
                )}
              </Problem>
            ) : null}
          </Section>

          {report.data.targetUserId || affectedGroup ? (
            <Section title={t("Immediate safety action")}>
              <TextField
                label={t("Required audit reason")}
                value={reason}
                onChangeText={setReason}
                multiline
                placeholder={t("At least 10 characters")}
              />
              <Button
                label={
                  affectedGroup
                    ? t("Freeze group sharing")
                    : t("Freeze reported profile")
                }
                variant="destructive"
                disabled={
                  reason.trim().length < 10 ||
                  freezeProfile.isPending ||
                  freezeGroup.isPending
                }
                onPress={confirmFreeze}
              />
              {freezeProfile.isError || freezeGroup.isError ? (
                <Problem>
                  {t("The target changed or could not be frozen safely.")}
                </Problem>
              ) : null}
            </Section>
          ) : report.data.groupId ? (
            <Note>
              {t(
                "This group is outside the first moderation page. Open Social groups to find and freeze it.",
              )}
            </Note>
          ) : null}
        </Screen>
      ) : null}
    </AdminGate>
  );
}
