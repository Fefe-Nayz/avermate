import { useState } from "react";
import { Text, View } from "react-native";
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
import { numeric, space, type, usePalette } from "@/lib/theme";

type FeedbackStatus =
  | "open"
  | "triaged"
  | "in_progress"
  | "waiting"
  | "resolved"
  | "closed"
  | "rejected";
type FeedbackPriority = "low" | "normal" | "high" | "urgent";
type FeedbackSource =
  "all" | "form" | "auto:web" | "auto:mobile" | "auto:server";

const STATUSES: FeedbackStatus[] = [
  "open",
  "triaged",
  "in_progress",
  "waiting",
  "resolved",
  "closed",
  "rejected",
];
const PRIORITIES: FeedbackPriority[] = ["low", "normal", "high", "urgent"];

function statusLabel(value: string): string {
  if (value === "in_progress") return t("In progress");
  return t(value.charAt(0).toUpperCase() + value.slice(1));
}

async function refreshFeedback(): Promise<void> {
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: orpc.admin.feedbackQueue.key() }),
    queryClient.invalidateQueries({
      queryKey: orpc.admin.feedbackDetail.key(),
    }),
    queryClient.invalidateQueries({
      queryKey: orpc.admin.feedbackTriageStats.key(),
    }),
  ]);
}

export function AdminFeedbackQueueScreen() {
  const palette = usePalette();
  const router = useRouter();
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<FeedbackStatus | "all">("all");
  const [priority, setPriority] = useState<FeedbackPriority | "all">("all");
  const [source, setSource] = useState<FeedbackSource>("all");
  const [assignee, setAssignee] = useState<"all" | "unassigned" | "mine">(
    "all",
  );
  const [offset, setOffset] = useState(0);
  const stats = useQuery(orpc.admin.feedbackTriageStats.queryOptions());
  const queue = useQuery(
    orpc.admin.feedbackQueue.queryOptions({
      input: {
        statuses: status === "all" ? [] : [status],
        priorities: priority === "all" ? [] : [priority],
        kinds: [],
        source,
        assignee,
        label: null,
        duplicateGroupKey: null,
        search: search.trim(),
        limit: 25,
        offset,
      },
    }),
  );

  const resetPage = () => setOffset(0);
  return (
    <AdminGate>
      <Stack.Screen options={{ title: t("Feedback triage") }} />
      <Screen>
        <Section title={t("Central feedback queue")}>
          <Note>
            {t(
              "Forms and deduplicated automatic errors stay in one role-gated queue. Academic data is never shown here.",
            )}
          </Note>
          <View
            style={{ flexDirection: "row", flexWrap: "wrap", gap: space.sm }}
          >
            {[
              [t("Unresolved"), stats.data?.unresolved],
              [t("Occurrences"), stats.data?.occurrences],
              [t("Urgent"), stats.data?.urgent],
              [t("Unassigned"), stats.data?.unassigned],
            ].map(([label, value]) => (
              <Card
                key={String(label)}
                style={{ flexBasis: "47%", flexGrow: 1 }}
              >
                <Text style={[type.footnote, { color: palette.textMuted }]}>
                  {label}
                </Text>
                <Text style={[type.title, numeric, { color: palette.text }]}>
                  {String(value ?? "—")}
                </Text>
              </Card>
            ))}
          </View>
        </Section>

        <Section title={t("Filters")}>
          <TextField
            label={t("Search")}
            value={search}
            onChangeText={(value) => {
              setSearch(value);
              resetPage();
            }}
            placeholder={t("Subject, route or opaque digest")}
          />
          <ChoiceField
            label={t("Status")}
            value={status}
            onChange={(value) => {
              setStatus(value as typeof status);
              resetPage();
            }}
            columns={2}
            choices={[
              { value: "all", label: t("All") },
              ...STATUSES.map((value) => ({
                value,
                label: statusLabel(value),
              })),
            ]}
          />
          <ChoiceField
            label={t("Priority")}
            value={priority}
            onChange={(value) => {
              setPriority(value as typeof priority);
              resetPage();
            }}
            columns={2}
            choices={[
              { value: "all", label: t("All") },
              ...PRIORITIES.map((value) => ({
                value,
                label: statusLabel(value),
              })),
            ]}
          />
          <ChoiceField
            label={t("Source")}
            value={source}
            onChange={(value) => {
              setSource(value as FeedbackSource);
              resetPage();
            }}
            columns={2}
            choices={[
              { value: "all", label: t("All") },
              { value: "form", label: t("Forms") },
              { value: "auto:web", label: t("Automatic · Web") },
              { value: "auto:mobile", label: t("Automatic · Mobile") },
              { value: "auto:server", label: t("Automatic · Server") },
            ]}
          />
          <ChoiceField
            label={t("Assignment")}
            value={assignee}
            onChange={(value) => {
              setAssignee(value as typeof assignee);
              resetPage();
            }}
            columns={2}
            choices={[
              { value: "all", label: t("All") },
              { value: "unassigned", label: t("Unassigned") },
              { value: "mine", label: t("Assigned to me") },
            ]}
          />
        </Section>

        {queue.isLoading ? <Loading /> : null}
        {queue.isError ? (
          <Problem>{t("The feedback queue could not be loaded.")}</Problem>
        ) : null}
        <Section title={t("{count} items", { count: queue.data?.total ?? 0 })}>
          {(queue.data?.items.length ?? 0) === 0 && !queue.isLoading ? (
            <Empty icon="checkmark-circle-outline" title={t("Nothing here")} />
          ) : (
            <Card padded={false}>
              {queue.data?.items.map((item, index) => (
                <Row
                  key={item.id}
                  first={index === 0}
                  title={item.subject}
                  subtitle={`${item.priority} · ${item.status} · ${item.source}${
                    item.duplicateCount > 1 ? ` · ×${item.duplicateCount}` : ""
                  }`}
                  onPress={() => router.push(`/admin/feedback/${item.id}`)}
                  trailing={
                    <Text style={[type.footnote, { color: palette.textMuted }]}>
                      {item.labels.join(" · ")}
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
                  !queue.data ||
                  queue.data.offset + queue.data.limit >= queue.data.total
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

export function AdminFeedbackDetailScreen() {
  const palette = usePalette();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [label, setLabel] = useState("");
  const [comment, setComment] = useState("");
  const detail = useQuery({
    ...orpc.admin.feedbackDetail.queryOptions({ input: { feedbackId: id } }),
    enabled: Boolean(id),
  });
  const assignees = useQuery(orpc.admin.feedbackAssignees.queryOptions());
  const update = useMutation({
    ...orpc.admin.updateFeedbackTriage.mutationOptions(),
    onSuccess: async () => {
      haptic("success");
      await refreshFeedback();
    },
  });
  const addLabel = useMutation({
    ...orpc.admin.addFeedbackLabel.mutationOptions(),
    onSuccess: async () => {
      setLabel("");
      await refreshFeedback();
    },
  });
  const removeLabel = useMutation({
    ...orpc.admin.removeFeedbackLabel.mutationOptions(),
    onSuccess: refreshFeedback,
  });
  const addComment = useMutation({
    ...orpc.admin.addFeedbackComment.mutationOptions(),
    onSuccess: async () => {
      setComment("");
      await refreshFeedback();
    },
  });

  const patch = (
    value:
      | { status: FeedbackStatus }
      | { priority: FeedbackPriority }
      | { assignedToUserId: string | null },
  ) => {
    if (!detail.data) return;
    update.mutate({
      feedbackId: detail.data.id,
      expectedRevision: detail.data.revision,
      patch: value,
    });
  };

  return (
    <AdminGate>
      <Stack.Screen options={{ title: t("Feedback detail") }} />
      {detail.isLoading ? <Loading /> : null}
      {detail.isError ? (
        <Screen>
          <Problem>{t("This feedback item could not be loaded.")}</Problem>
        </Screen>
      ) : null}
      {detail.data ? (
        <Screen>
          <Section title={detail.data.subject}>
            <Card style={{ gap: space.md }}>
              <Text selectable style={[type.body, { color: palette.text }]}>
                {detail.data.message}
              </Text>
              <Text
                selectable
                style={[type.footnote, { color: palette.textMuted }]}
              >
                {detail.data.reporter.name} · {detail.data.reporter.email}
              </Text>
              <Text
                selectable
                style={[type.footnote, { color: palette.textMuted }]}
              >
                {detail.data.source} · {detail.data.route ?? t("No route")} · ×
                {detail.data.duplicateCount}
              </Text>
              {detail.data.errorDigest ? (
                <Text
                  selectable
                  style={[type.footnote, { color: palette.textMuted }]}
                >
                  {t("Opaque error digest")}: {detail.data.errorDigest}
                </Text>
              ) : null}
              <Note>
                {t(
                  "Raw stack traces, arbitrary diagnostic context and academic records stay hidden on mobile.",
                )}
              </Note>
            </Card>
          </Section>

          <Section title={t("Triage")}>
            <ChoiceField
              label={t("Status")}
              value={detail.data.status}
              onChange={(value) => patch({ status: value as FeedbackStatus })}
              columns={2}
              choices={STATUSES.map((value) => ({
                value,
                label: statusLabel(value),
              }))}
            />
            <ChoiceField
              label={t("Priority")}
              value={detail.data.priority}
              onChange={(value) =>
                patch({ priority: value as FeedbackPriority })
              }
              columns={2}
              choices={PRIORITIES.map((value) => ({
                value,
                label: statusLabel(value),
              }))}
            />
            <ChoiceField
              label={t("Assigned administrator")}
              value={detail.data.assignedToUserId ?? ""}
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
            {update.isError ? (
              <Problem>
                {t("This item changed elsewhere. Refresh before trying again.")}
              </Problem>
            ) : null}
          </Section>

          <Section title={t("Labels")}>
            <Card padded={false}>
              {detail.data.labels.map((item, index) => (
                <Row
                  key={item.id}
                  first={index === 0}
                  title={item.label}
                  destructive
                  onPress={() =>
                    removeLabel.mutate({ feedbackId: id, label: item.label })
                  }
                />
              ))}
            </Card>
            <TextField
              label={t("New label")}
              value={label}
              onChangeText={setLabel}
              autoCapitalize="none"
            />
            <Button
              label={t("Add label")}
              variant="secondary"
              disabled={!label.trim()}
              loading={addLabel.isPending}
              onPress={() =>
                addLabel.mutate({ feedbackId: id, label: label.trim() })
              }
            />
          </Section>

          <Section title={t("Internal comments")}>
            <Card padded={false}>
              {detail.data.comments.length === 0 ? (
                <Row first title={t("No internal comment yet")} />
              ) : (
                detail.data.comments.map((item, index) => (
                  <Row
                    key={item.id}
                    first={index === 0}
                    title={item.body}
                    subtitle={`${item.authorName ?? t("Administrator")} · ${new Date(
                      item.createdAt,
                    ).toLocaleString()}`}
                  />
                ))
              )}
            </Card>
            <TextField
              label={t("Add an internal comment")}
              value={comment}
              onChangeText={setComment}
              multiline
            />
            <Button
              label={t("Add comment")}
              variant="secondary"
              disabled={!comment.trim()}
              loading={addComment.isPending}
              onPress={() =>
                addComment.mutate({ feedbackId: id, body: comment.trim() })
              }
            />
          </Section>

          <Section title={t("Audit timeline")}>
            <Card padded={false}>
              {detail.data.events.map((event, index) => (
                <Row
                  key={event.id}
                  first={index === 0}
                  title={event.kind}
                  subtitle={`${event.actorName ?? t("System")} · ${event.changedKeys.join(", ")} · ${new Date(
                    event.createdAt,
                  ).toLocaleString()}`}
                />
              ))}
            </Card>
          </Section>
        </Screen>
      ) : null}
    </AdminGate>
  );
}
