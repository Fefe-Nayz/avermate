import { useState } from "react";
import { Alert, Text, View } from "react-native";
import { Stack } from "expo-router";
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

type GroupState = "active" | "frozen" | "archived" | "all";
type GroupType = "friends" | "study_group" | "class" | "all";

export function AdminSocialGroupsScreen() {
  const palette = usePalette();
  const [state, setState] = useState<GroupState>("all");
  const [groupType, setGroupType] = useState<GroupType>("all");
  const [search, setSearch] = useState("");
  const [offset, setOffset] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const groups = useQuery(
    orpc.admin.socialGroups.queryOptions({
      input: {
        state,
        type: groupType,
        search: search.trim(),
        limit: 25,
        offset,
      },
    }),
  );
  const selected = groups.data?.items.find((group) => group.id === selectedId);
  const freeze = useMutation({
    ...orpc.admin.freezeSocialGroup.mutationOptions(),
    onSuccess: async () => {
      haptic("warning");
      setSelectedId(null);
      setReason("");
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: orpc.admin.socialGroups.key(),
        }),
        queryClient.invalidateQueries({
          queryKey: orpc.admin.socialOverview.key(),
        }),
        queryClient.invalidateQueries({
          queryKey: orpc.admin.socialAudit.key(),
        }),
      ]);
    },
  });

  const confirm = () => {
    if (!selected || reason.trim().length < 10) return;
    const frozen = selected.state !== "frozen";
    Alert.alert(
      frozen ? t("Freeze this group?") : t("Unfreeze this group?"),
      frozen
        ? t(
            "Accepted consents are withdrawn, invitations are revoked and sharing stops until members consent again.",
          )
        : t(
            "The group becomes active again, but prior consent and ranking opt-ins are not silently restored.",
          ),
      [
        { text: t("Cancel"), style: "cancel" },
        {
          text: frozen ? t("Freeze") : t("Unfreeze"),
          style: frozen ? "destructive" : "default",
          onPress: () =>
            freeze.mutate({
              groupId: selected.id,
              frozen,
              expectedRevision: selected.revision,
              reason: reason.trim(),
            }),
        },
      ],
    );
  };

  return (
    <AdminGate>
      <Stack.Screen options={{ title: t("Social groups") }} />
      <Screen>
        <Note>
          {t(
            "Class groups are self-declared. This moderation view contains group metadata and counts only, never academic rows.",
          )}
        </Note>
        <Section title={t("Filters")}>
          <TextField
            label={t("Search group name")}
            value={search}
            onChangeText={(value) => {
              setSearch(value);
              setOffset(0);
            }}
          />
          <ChoiceField
            label={t("State")}
            value={state}
            onChange={(value) => {
              setState(value as GroupState);
              setOffset(0);
            }}
            columns={2}
            choices={[
              { value: "all", label: t("All") },
              { value: "active", label: t("Active") },
              { value: "frozen", label: t("Frozen") },
              { value: "archived", label: t("Archived") },
            ]}
          />
          <ChoiceField
            label={t("Type")}
            value={groupType}
            onChange={(value) => {
              setGroupType(value as GroupType);
              setOffset(0);
            }}
            columns={2}
            choices={[
              { value: "all", label: t("All") },
              { value: "friends", label: t("Friends") },
              { value: "study_group", label: t("Study group") },
              { value: "class", label: t("Class") },
            ]}
          />
        </Section>

        {groups.isLoading ? <Loading /> : null}
        {groups.isError ? (
          <Problem>{t("Social groups could not be loaded.")}</Problem>
        ) : null}
        <Section
          title={t("{count} groups", { count: groups.data?.total ?? 0 })}
        >
          {(groups.data?.items.length ?? 0) === 0 && !groups.isLoading ? (
            <Empty icon="people-outline" title={t("Nothing here")} />
          ) : (
            <Card padded={false}>
              {groups.data?.items.map((group, index) => (
                <Row
                  key={group.id}
                  first={index === 0}
                  title={group.name}
                  subtitle={`${group.type} · ${group.memberCount} ${t(
                    "members",
                  )} · ${group.owner.name}`}
                  onPress={() => {
                    setSelectedId(group.id);
                    setReason("");
                  }}
                  trailing={
                    <Text
                      style={[
                        type.footnote,
                        {
                          color:
                            group.state === "frozen"
                              ? palette.negative
                              : palette.textMuted,
                        },
                      ]}
                    >
                      {group.state}
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
                  !groups.data ||
                  groups.data.offset + groups.data.limit >= groups.data.total
                }
                onPress={() => setOffset(offset + 25)}
              />
            </View>
          </View>
        </Section>

        {selected ? (
          <Section title={t("Moderate {name}", { name: selected.name })}>
            <Card padded={false}>
              <Row
                first
                title={t("Owner")}
                subtitle={`${selected.owner.name} · ${selected.owner.email}`}
              />
              <Row
                title={t("Policy version")}
                subtitle={String(selected.currentPolicyVersion)}
              />
              <Row
                title={t("Members")}
                subtitle={String(selected.memberCount)}
              />
            </Card>
            <TextField
              label={t("Required audit reason")}
              value={reason}
              onChangeText={setReason}
              multiline
              placeholder={t("At least 10 characters")}
            />
            <Button
              label={
                selected.state === "frozen"
                  ? t("Unfreeze group")
                  : t("Freeze group sharing")
              }
              variant={
                selected.state === "frozen" ? "secondary" : "destructive"
              }
              disabled={
                selected.state === "archived" ||
                reason.trim().length < 10 ||
                freeze.isPending
              }
              loading={freeze.isPending}
              onPress={confirm}
            />
            {selected.state === "archived" ? (
              <Note>{t("Archived groups cannot be unfrozen.")}</Note>
            ) : null}
            {freeze.isError ? (
              <Problem>
                {t("The group changed elsewhere. Refresh before trying again.")}
              </Problem>
            ) : null}
          </Section>
        ) : null}
      </Screen>
    </AdminGate>
  );
}

export function AdminSocialAuditScreen() {
  const palette = usePalette();
  const [action, setAction] = useState("");
  const [entityType, setEntityType] = useState("");
  const [offset, setOffset] = useState(0);
  const audit = useQuery(
    orpc.admin.socialAudit.queryOptions({
      input: {
        action: action.trim(),
        entityType: entityType.trim(),
        limit: 50,
        offset,
      },
    }),
  );

  return (
    <AdminGate>
      <Stack.Screen options={{ title: t("Social audit") }} />
      <Screen>
        <Note>
          {t(
            "This timeline is read-only. Reasons are represented by opaque digests; invitation secrets and academic data are excluded.",
          )}
        </Note>
        <Section title={t("Filters")}>
          <TextField
            label={t("Exact action")}
            value={action}
            onChangeText={(value) => {
              setAction(value);
              setOffset(0);
            }}
            autoCapitalize="none"
          />
          <TextField
            label={t("Exact entity type")}
            value={entityType}
            onChangeText={(value) => {
              setEntityType(value);
              setOffset(0);
            }}
            autoCapitalize="none"
          />
        </Section>
        {audit.isLoading ? <Loading /> : null}
        {audit.isError ? (
          <Problem>{t("The social audit could not be loaded.")}</Problem>
        ) : null}
        <Section title={t("{count} events", { count: audit.data?.total ?? 0 })}>
          <Card padded={false}>
            {audit.data?.items.map((event, index) => (
              <Row
                key={event.id}
                first={index === 0}
                title={event.action}
                subtitle={`${event.entityType} · ${event.changedKeys.join(", ")} · ${new Date(
                  event.occurredAt,
                ).toLocaleString()}`}
                trailing={
                  <Text style={[type.footnote, { color: palette.textMuted }]}>
                    {event.requestId
                      ? t("reason recorded")
                      : t("no reason digest")}
                  </Text>
                }
              />
            ))}
          </Card>
          <View style={{ flexDirection: "row", gap: space.sm }}>
            <View style={{ flex: 1 }}>
              <Button
                label={t("Previous")}
                variant="ghost"
                disabled={offset === 0}
                onPress={() => setOffset(Math.max(0, offset - 50))}
              />
            </View>
            <View style={{ flex: 1 }}>
              <Button
                label={t("Next")}
                variant="ghost"
                disabled={
                  !audit.data ||
                  audit.data.offset + audit.data.limit >= audit.data.total
                }
                onPress={() => setOffset(offset + 50)}
              />
            </View>
          </View>
        </Section>
      </Screen>
    </AdminGate>
  );
}
