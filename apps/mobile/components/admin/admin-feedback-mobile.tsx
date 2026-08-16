import { useState } from "react";
import { Pressable, Text, View } from "react-native";
import { Image } from "expo-image";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useMutation, useQuery } from "@tanstack/react-query";
import { AdminGate } from "@/components/admin/admin-gate";
import { formatDateTime } from "@/components/admin/admin-screens";
import { ChoiceField, TextField } from "@/components/field";
import { Icon } from "@/components/icon";
import {
  Badge,
  Button,
  Card,
  Confirmation,
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
import { numeric, radius, space, type, usePalette } from "@/lib/theme";

/**
 * The web's central feedback queue (`admin/feedback`), on the phone: the same
 * triage stats, filters (label filter included), bulk selection, and a detail
 * screen with the reporter link, redacted technical context and the screenshot
 * attachment — the list/detail split replacing the web's two-pane layout.
 */

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

/** The web's redacted context allow-list, mirrored key for key. */
const SAFE_CONTEXT_KEYS = new Set([
  "appVersion",
  "browser",
  "buildVersion",
  "connectivity",
  "device",
  "locale",
  "os",
  "platform",
  "route",
  "userAgent",
  "viewport",
]);

function safeContextEntries(context: Record<string, string>) {
  return Object.entries(context)
    .filter(
      ([key, value]) => SAFE_CONTEXT_KEYS.has(key) && typeof value === "string",
    )
    .map(([key, value]) => [key, value.slice(0, 500)] as const);
}

/** Literal keys so the catalogue check sees every status and priority. */
function statusLabel(value: string): string {
  switch (value) {
    case "open":
      return t("Open");
    case "triaged":
      return t("Triaged");
    case "in_progress":
      return t("In progress");
    case "waiting":
      return t("Waiting");
    case "resolved":
      return t("Resolved");
    case "closed":
      return t("Closed");
    case "rejected":
      return t("Rejected");
    case "low":
      return t("Low");
    case "normal":
      return t("Normal");
    case "high":
      return t("High");
    case "urgent":
      return t("Urgent");
    default:
      return value;
  }
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
  const [status, setStatus] = useState<FeedbackStatus | "all">("open");
  const [priority, setPriority] = useState<FeedbackPriority | "all">("all");
  const [source, setSource] = useState<FeedbackSource>("all");
  const [assignee, setAssignee] = useState<"all" | "unassigned" | "mine">(
    "all",
  );
  const [label, setLabel] = useState("");
  const [offset, setOffset] = useState(0);
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [bulkStatus, setBulkStatus] = useState<FeedbackStatus>("triaged");
  const [bulkPriority, setBulkPriority] = useState<FeedbackPriority>("normal");
  const [bulkAssignee, setBulkAssignee] = useState("");
  const [bulkNotice, setBulkNotice] = useState<string | null>(null);
  const [bulkProblem, setBulkProblem] = useState<string | null>(null);
  const stats = useQuery(orpc.admin.feedbackTriageStats.queryOptions());
  const assignees = useQuery(orpc.admin.feedbackAssignees.queryOptions());
  const queue = useQuery(
    orpc.admin.feedbackQueue.queryOptions({
      input: {
        statuses: status === "all" ? [] : [status],
        priorities: priority === "all" ? [] : [priority],
        kinds: [],
        source,
        assignee,
        label: label.trim() ? label.trim().toLowerCase() : null,
        duplicateGroupKey: null,
        search: search.trim(),
        limit: 25,
        offset,
      },
    }),
  );
  const bulk = useMutation({
    ...orpc.admin.bulkUpdateFeedbackTriage.mutationOptions(),
    onSuccess: async () => {
      haptic("success");
      setChecked(new Set());
      setBulkProblem(null);
      setBulkNotice(t("Selected feedback items updated."));
      await refreshFeedback();
    },
    onError: async () => {
      haptic("error");
      setBulkNotice(null);
      setBulkProblem(
        t("At least one item changed elsewhere. The queue was reloaded."),
      );
      await refreshFeedback();
    },
  });

  const items = queue.data?.items ?? [];
  const selectedItems = items.filter((item) => checked.has(item.id));
  const allSelected = items.length > 0 && checked.size === items.length;
  const applyBulk = (patch: {
    status?: FeedbackStatus;
    priority?: FeedbackPriority;
    assignedToUserId?: string | null;
  }) =>
    bulk.mutate({
      items: selectedItems.map((item) => ({
        feedbackId: item.id,
        expectedRevision: item.revision,
      })),
      patch,
    });
  const resetPage = () => {
    setOffset(0);
    setChecked(new Set());
  };
  const toggle = (id: string) =>
    setChecked((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <AdminGate>
      <Stack.Screen options={{ title: t("Feedback triage") }} />
      <Screen>
        <Section title={t("Central feedback queue")}>
          <Note>
            {t(
              "Manual requests and deduplicated automatic errors, with ownership, labels and an auditable internal timeline.",
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
              [t("Unique items"), stats.data?.total],
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
            placeholder={t("Search subject, route or opaque digest")}
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
              { value: "all", label: t("All statuses") },
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
              { value: "all", label: t("All priorities") },
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
              { value: "all", label: t("All sources") },
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
              { value: "all", label: t("All assignments") },
              { value: "unassigned", label: t("Unassigned") },
              { value: "mine", label: t("Assigned to me") },
            ]}
          />
          <TextField
            label={t("Label filter")}
            value={label}
            onChangeText={(value) => {
              setLabel(value);
              resetPage();
            }}
            autoCapitalize="none"
          />
        </Section>

        {checked.size > 0 ? (
          <Section title={t("{count} selected", { count: checked.size })}>
            <ChoiceField
              label={t("Status")}
              value={bulkStatus}
              onChange={(value) => setBulkStatus(value as FeedbackStatus)}
              columns={2}
              choices={STATUSES.filter((value) => value !== "open").map(
                (value) => ({ value, label: statusLabel(value) }),
              )}
            />
            <Button
              size="sm"
              label={t("Apply status")}
              variant="secondary"
              disabled={bulk.isPending}
              loading={bulk.isPending}
              onPress={() => applyBulk({ status: bulkStatus })}
            />
            <ChoiceField
              label={t("Priority")}
              value={bulkPriority}
              onChange={(value) => setBulkPriority(value as FeedbackPriority)}
              columns={2}
              choices={PRIORITIES.map((value) => ({
                value,
                label: statusLabel(value),
              }))}
            />
            <Button
              size="sm"
              label={t("Apply priority")}
              variant="secondary"
              disabled={bulk.isPending}
              onPress={() => applyBulk({ priority: bulkPriority })}
            />
            <ChoiceField
              label={t("Assigned administrator")}
              value={bulkAssignee}
              onChange={setBulkAssignee}
              choices={[
                { value: "", label: t("Unassigned") },
                ...(assignees.data ?? []).map((admin) => ({
                  value: admin.id,
                  label: admin.name,
                  hint: admin.email,
                })),
              ]}
            />
            <Button
              size="sm"
              label={t("Apply assignee")}
              variant="secondary"
              disabled={bulk.isPending}
              onPress={() =>
                applyBulk({ assignedToUserId: bulkAssignee || null })
              }
            />
            <Button
              size="sm"
              label={t("Clear selection")}
              variant="ghost"
              onPress={() => setChecked(new Set())}
            />
          </Section>
        ) : null}

        {queue.isLoading ? <Loading /> : null}
        {queue.isError ? (
          <Problem>{t("The feedback queue could not be loaded.")}</Problem>
        ) : null}
        <Section
          title={t("{count} items", { count: queue.data?.total ?? 0 })}
          action={
            items.length > 0 ? (
              <Button
                size="sm"
                variant="ghost"
                label={allSelected ? t("Clear selection") : t("Select page")}
                onPress={() =>
                  setChecked(
                    allSelected
                      ? new Set()
                      : new Set(items.map((item) => item.id)),
                  )
                }
              />
            ) : undefined
          }
        >
          {bulkNotice ? <Confirmation>{bulkNotice}</Confirmation> : null}
          {bulkProblem ? <Problem>{bulkProblem}</Problem> : null}
          {items.length === 0 && !queue.isLoading ? (
            <Empty
              icon="checkmark-circle-outline"
              title={t("No feedback matches these filters.")}
            />
          ) : (
            <Card padded={false}>
              {items.map((item, index) => (
                <Row
                  key={item.id}
                  first={index === 0}
                  title={item.subject}
                  subtitle={`${item.priority} · ${item.status} · ${item.source}${
                    item.duplicateCount > 1 ? ` · ×${item.duplicateCount}` : ""
                  }`}
                  onPress={() => router.push(`/admin/feedback/${item.id}`)}
                  trailing={
                    <View
                      style={{
                        flexDirection: "row",
                        alignItems: "center",
                        gap: space.sm,
                      }}
                    >
                      {item.labels.length > 0 ? (
                        <Text
                          numberOfLines={1}
                          style={[
                            type.footnote,
                            { color: palette.textMuted, maxWidth: 96 },
                          ]}
                        >
                          {item.labels.join(" · ")}
                        </Text>
                      ) : null}
                      <Pressable hitSlop={10} onPress={() => toggle(item.id)}>
                        <Icon
                          name={
                            checked.has(item.id) ? "checkbox" : "square-outline"
                          }
                          size={20}
                          color={
                            checked.has(item.id)
                              ? palette.accent
                              : palette.textFaint
                          }
                        />
                      </Pressable>
                    </View>
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
                onPress={() => {
                  setChecked(new Set());
                  setOffset(Math.max(0, offset - 25));
                }}
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
                onPress={() => {
                  setChecked(new Set());
                  setOffset(offset + 25);
                }}
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
  const router = useRouter();
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
    onError: async () => {
      haptic("error");
      // The web reloads the latest revision as soon as the conflict is known.
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

  const context = detail.data ? safeContextEntries(detail.data.context) : [];

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
            <View
              style={{
                flexDirection: "row",
                flexWrap: "wrap",
                gap: space.sm,
                paddingHorizontal: space.xs,
              }}
            >
              <Badge label={detail.data.kind} toneColor="accent" />
              <Badge
                label={
                  detail.data.source.startsWith("auto:")
                    ? t("Automatic")
                    : t("Form")
                }
              />
              {detail.data.duplicateCount > 1 ? (
                <Badge
                  label={t("{count} occurrences", {
                    count: detail.data.duplicateCount,
                  })}
                />
              ) : null}
            </View>
            <Card>
              <Text selectable style={[type.body, { color: palette.text }]}>
                {detail.data.message}
              </Text>
            </Card>
            <Card padded={false}>
              <Row
                first
                title={t("Reporter")}
                subtitle={`${detail.data.reporter.name} · ${detail.data.reporter.email}`}
                onPress={() =>
                  router.push({
                    pathname: "/admin/user/[id]",
                    params: { id: detail.data.reporter.id },
                  })
                }
              />
              <Row
                title={t("Last seen")}
                subtitle={formatDateTime(detail.data.lastSeenAt)}
              />
              {detail.data.route ? (
                <Row
                  title={t("Sanitized route")}
                  subtitle={detail.data.route}
                />
              ) : null}
              {detail.data.errorDigest ? (
                <Row
                  title={t("Opaque error digest")}
                  subtitle={detail.data.errorDigest}
                />
              ) : null}
            </Card>
            {detail.data.attachmentUrl ? (
              <Image
                source={detail.data.attachmentUrl}
                contentFit="contain"
                accessibilityLabel={t("Feedback screenshot")}
                style={{
                  width: "100%",
                  height: 200,
                  borderRadius: radius.md,
                  backgroundColor: palette.accentSoft,
                }}
              />
            ) : null}
          </Section>

          {context.length > 0 ? (
            <Section title={t("Redacted technical context")}>
              <Card style={{ gap: space.sm }}>
                {context.map(([key, value]) => (
                  <View key={key} style={{ gap: 2 }}>
                    <Text style={[type.label, { color: palette.textFaint }]}>
                      {key}
                    </Text>
                    <Text
                      selectable
                      style={[type.footnote, { color: palette.text }]}
                    >
                      {value}
                    </Text>
                  </View>
                ))}
              </Card>
            </Section>
          ) : null}

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
                {t(
                  "This item changed elsewhere. The latest version was reloaded.",
                )}
              </Problem>
            ) : null}
          </Section>

          <Section title={t("Labels")}>
            <Card padded={false}>
              {detail.data.labels.length === 0 ? (
                <Row first muted title={t("No labels yet")} />
              ) : (
                detail.data.labels.map((item, index) => (
                  <Row
                    key={item.id ?? item.label}
                    first={index === 0}
                    title={item.label}
                    destructive
                    onPress={() =>
                      removeLabel.mutate({ feedbackId: id, label: item.label })
                    }
                  />
                ))
              )}
            </Card>
            <TextField
              label={t("New label")}
              value={label}
              onChangeText={setLabel}
              autoCapitalize="none"
              maxLength={30}
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
            {addLabel.error instanceof Error ? (
              <Problem>{addLabel.error.message}</Problem>
            ) : null}
          </Section>

          <Section title={t("Internal comments")}>
            <Card padded={false}>
              {detail.data.comments.length === 0 ? (
                <Row first muted title={t("No internal comment yet")} />
              ) : (
                detail.data.comments.map((item, index) => (
                  <Row
                    key={item.id}
                    first={index === 0}
                    title={item.body}
                    subtitle={`${item.authorName ?? t("Administrator")} · ${formatDateTime(item.createdAt)}`}
                  />
                ))
              )}
            </Card>
            <TextField
              label={t("Add an internal comment")}
              value={comment}
              onChangeText={setComment}
              multiline
              maxLength={4000}
            />
            <Button
              label={t("Add internal comment")}
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
                  subtitle={`${event.actorName ?? t("System")} · ${event.changedKeys.join(", ")} · ${formatDateTime(
                    event.createdAt,
                  )}`}
                />
              ))}
            </Card>
          </Section>
        </Screen>
      ) : null}
    </AdminGate>
  );
}
