import { useState } from "react";
import { Alert, Share, Text, View } from "react-native";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Icon } from "@/components/icon";
import {
  SharedAverageText,
  comparisonLabel,
  comparisonUnit,
  formatSharedAverage,
  serverMessage,
} from "@/components/social/social-ui";
import { ChoiceField, SwitchField, TextField } from "@/components/field";
import {
  Badge,
  Button,
  Card,
  ChipRail,
  Empty,
  Loading,
  Note,
  Row,
  Screen,
  Section,
  StatTile,
} from "@/components/ui";
import { useYear } from "@/components/year-provider";
import { env } from "@/lib/env";
import { haptic } from "@/lib/haptics";
import { t } from "@/lib/i18n";
import { orpc, queryClient } from "@/lib/orpc";
import { numeric, space, type, usePalette } from "@/lib/theme";

type ComparisonKind = "general" | "subject";

/**
 * One class: the common template and the viewer's linked year are explicit
 * before any figures can be shared or compared.
 */
export default function GroupDetail() {
  const palette = usePalette();
  const router = useRouter();
  const {
    years,
    allYears,
    year: activeYear,
    selectYear: selectActiveYear,
    refresh: refreshYears,
  } = useYear();
  const { groupId } = useLocalSearchParams<{ groupId: string }>();
  const detail = useQuery({
    ...orpc.social.groups.get.queryOptions({
      input: { groupId: groupId ?? "" },
    }),
    enabled: Boolean(groupId),
  });
  const invitations = useQuery({
    ...orpc.social.groups.invitations.list.queryOptions({
      input: { groupId: groupId ?? "" },
    }),
    enabled: Boolean(groupId) && detail.data?.viewer.role === "owner",
  });

  const refresh = () =>
    Promise.all([
      queryClient.invalidateQueries({
        queryKey: orpc.social.groups.get.queryKey({
          input: { groupId: groupId ?? "" },
        }),
      }),
      queryClient.invalidateQueries({
        queryKey: orpc.social.groups.list.queryKey(),
      }),
    ]);
  const complain = (error: unknown) => {
    haptic("error");
    Alert.alert(serverMessage(error, t("The change could not be saved.")));
  };

  const setSharing = useMutation({
    ...orpc.social.groups.setSharing.mutationOptions(),
    onSuccess: refresh,
    onError: complain,
  });
  const invite = useMutation({
    ...orpc.social.groups.invitations.create.mutationOptions(),
    onSuccess: async (invitation) => {
      haptic("success");
      await queryClient.invalidateQueries({
        queryKey: orpc.social.groups.invitations.list.queryKey({
          input: { groupId: groupId ?? "" },
        }),
      });
      await Share.share({
        message: `${env.webUrl}/social/invitations/${invitation.token}`,
      });
    },
  });
  const revokeInvite = useMutation({
    ...orpc.social.groups.invitations.revoke.mutationOptions(),
    onSuccess: () =>
      queryClient.invalidateQueries({
        queryKey: orpc.social.groups.invitations.list.queryKey({
          input: { groupId: groupId ?? "" },
        }),
      }),
  });
  const removeMember = useMutation({
    ...orpc.social.groups.removeMember.mutationOptions(),
    onSuccess: refresh,
  });
  const leave = useMutation({
    ...orpc.social.groups.leave.mutationOptions(),
    onSuccess: async () => {
      haptic("success");
      await queryClient.invalidateQueries({
        queryKey: orpc.social.groups.list.queryKey(),
      });
      router.back();
    },
    onError: () =>
      Alert.alert(
        t("You still own this class"),
        t("Remove the other members first, or delete the class."),
      ),
  });
  const destroy = useMutation({
    ...orpc.social.groups.delete.mutationOptions(),
    onSuccess: async () => {
      haptic("success");
      await queryClient.invalidateQueries({
        queryKey: orpc.social.groups.list.queryKey(),
      });
      router.back();
    },
    onError: complain,
  });
  const adopt = useMutation({
    ...orpc.social.groups.adoptSetup.mutationOptions(),
    onSuccess: async (result) => {
      haptic("success");
      setCopyOpen(false);
      refreshYears();
      selectActiveYear(result.yearId);
      await queryClient.invalidateQueries({
        queryKey: orpc.years.list.queryKey(),
      });
      await refresh();
      Alert.alert(t("A new year was created and connected to this class."));
    },
    onError: complain,
  });
  const selectYear = useMutation({
    ...orpc.social.groups.selectYear.mutationOptions(),
    onSuccess: async () => {
      haptic("success");
      await refresh();
      Alert.alert(t("Year connected. Sharing remains off."));
    },
    onError: complain,
  });
  const configureClass = useMutation({
    ...orpc.social.groups.configureClass.mutationOptions(),
    onSuccess: async () => {
      haptic("success");
      await refresh();
    },
    onError: complain,
  });
  const update = useMutation({
    ...orpc.social.groups.update.mutationOptions(),
    onSuccess: async () => {
      haptic("success");
      await refresh();
    },
    onError: complain,
  });
  const addComparison = useMutation({
    ...orpc.social.groups.comparisons.add.mutationOptions(),
    onSuccess: async () => {
      haptic("success");
      setAddSubject("");
      await refresh();
    },
    onError: () => Alert.alert(t("That comparison already exists."), undefined),
  });
  const removeComparison = useMutation({
    ...orpc.social.groups.comparisons.remove.mutationOptions(),
    onSuccess: refresh,
  });

  const [editing, setEditing] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [activeId, setActiveId] = useState<string | null>(null);
  const [addKind, setAddKind] = useState<ComparisonKind>("subject");
  const [addSubject, setAddSubject] = useState("");
  const [yearChoice, setYearChoice] = useState<string | null>(null);
  const [templateYearChoice, setTemplateYearChoice] = useState<string | null>(
    null,
  );
  const [copyOpen, setCopyOpen] = useState(false);
  const [copyName, setCopyName] = useState("");

  const group = detail.data;

  if (detail.isLoading) {
    return (
      <>
        <Stack.Screen options={{ title: t("Class") }} />
        <Loading />
      </>
    );
  }
  if (detail.isError || !group) {
    return (
      <>
        <Stack.Screen options={{ title: t("Class") }} />
        <Screen>
          <Empty
            icon="people-circle-outline"
            title={t("This class could not be found")}
            body={t("It may have been deleted, or you were removed.")}
          />
        </Screen>
      </>
    );
  }

  const isOwner = group.viewer.role === "owner";
  const frozen = group.state === "frozen";
  const template = group.classTemplate;
  const comparisons = group.comparisons;
  const active =
    comparisons.find((entry) => entry.id === activeId) ?? comparisons[0];
  const activeUnit = active ? comparisonUnit(active.kind) : "scale";

  const figureOf = (member: (typeof group.members)[number]) =>
    active
      ? (member.figures.find((figure) => figure.scopeId === active.id) ?? null)
      : null;
  const sharers = group.members
    .filter((member) => figureOf(member)?.average != null)
    .sort(
      (left, right) =>
        (figureOf(right)?.average ?? 0) - (figureOf(left)?.average ?? 0),
    );
  const silent = group.members.filter(
    (member) => figureOf(member)?.average == null,
  );
  const ratios = sharers
    .map((member) => figureOf(member)?.average as number)
    .sort((left, right) => left - right);
  const mean =
    ratios.length === 0
      ? null
      : ratios.reduce((total, value) => total + value, 0) / ratios.length;
  const statScale = sharers[0]?.scale ?? 20;
  const statDecimals = sharers[0]?.decimals ?? 2;
  const viewerYear = allYears.find((year) => year.id === group.viewer.yearId);
  const selectedCompatibleYearId =
    yearChoice ??
    group.compatibleYears.find((year) => year.id === group.viewer.yearId)?.id ??
    group.compatibleYears[0]?.id ??
    null;
  const selectedTemplateYearId =
    templateYearChoice ?? activeYear?.id ?? years[0]?.id ?? null;

  return (
    <>
      <Stack.Screen options={{ title: group.name }} />
      <Screen>
        {group.description ? <Note>{group.description}</Note> : null}

        {frozen ? (
          <Section title={t("This class is on hold")}>
            <Card>
              <Note>
                {t(
                  "A moderator paused this class after a report. Figures are hidden until the hold is lifted; nothing has been deleted.",
                )}
              </Note>
            </Card>
          </Section>
        ) : null}

        <Section
          title={t("Class model")}
          description={t(
            "The shared subjects, periods and grading scale are fixed for this class.",
          )}
        >
          {template ? (
            <Card padded={false}>
              <Row
                first
                title={template.yearName}
                subtitle={t("{start} to {end}", {
                  start: new Intl.DateTimeFormat(undefined, {
                    month: "short",
                    year: "numeric",
                  }).format(new Date(template.startsAt)),
                  end: new Intl.DateTimeFormat(undefined, {
                    month: "short",
                    year: "numeric",
                  }).format(new Date(template.endsAt)),
                })}
                trailing={
                  <Badge
                    label={t("Grades out of {scale}", {
                      scale: template.scale,
                    })}
                    toneColor="accent"
                  />
                }
              />
              <Row
                title={t("Academic structure")}
                subtitle={t(
                  "{subjects} subjects · {averages} custom averages · {periods} periods",
                  {
                    subjects: template.subjectCount,
                    averages: template.averageCount,
                    periods: template.periodCount,
                  },
                )}
                trailing={
                  <Badge
                    label={
                      template.source === "preset"
                        ? t("Preset model")
                        : t("Custom model")
                    }
                  />
                }
              />
            </Card>
          ) : isOwner ? (
            <Card style={{ gap: space.md }}>
              <Note>
                {t(
                  "This class must be connected to one of your years before it can be used. The choice cannot be changed later.",
                )}
              </Note>
              {years.length > 0 ? (
                <>
                  <ChoiceField
                    label={t("Model year")}
                    value={selectedTemplateYearId}
                    onChange={setTemplateYearChoice}
                    choices={years.map((year) => ({
                      value: year.id,
                      label: year.name,
                    }))}
                  />
                  <Button
                    label={t("Configure class")}
                    disabled={!selectedTemplateYearId}
                    loading={configureClass.isPending}
                    onPress={() =>
                      selectedTemplateYearId &&
                      configureClass.mutate({
                        groupId: groupId ?? "",
                        templateYearId: selectedTemplateYearId,
                      })
                    }
                  />
                </>
              ) : (
                <Button
                  label={t("Create a year")}
                  variant="secondary"
                  onPress={() => router.push("/year/new")}
                />
              )}
            </Card>
          ) : (
            <Note>
              {t(
                "The owner must choose a model year before the class can be used.",
              )}
            </Note>
          )}
        </Section>

        {template ? (
          <Section
            title={t("Your year in this class")}
            description={t(
              "Only the year connected here is used for class comparisons.",
            )}
          >
            <Card style={{ gap: space.md }}>
              {group.viewer.yearStatus === "connected" ? (
                <Row
                  first
                  title={viewerYear?.name ?? template.yearName}
                  trailing={
                    <Badge
                      label={t("Year connected")}
                      icon="checkmark-circle-outline"
                      toneColor="positive"
                    />
                  }
                />
              ) : (
                <Note>
                  {group.viewer.yearStatus === "incompatible"
                    ? t(
                        "Your previously connected year no longer matches this class. Choose another one or create a fresh copy.",
                      )
                    : t(
                        "Connect a compatible year before sharing results with the class.",
                      )}
                </Note>
              )}
              {group.compatibleYears.length > 0 ? (
                <>
                  <ChoiceField
                    label={t("Compatible year")}
                    value={selectedCompatibleYearId}
                    onChange={setYearChoice}
                    choices={group.compatibleYears.map((year) => ({
                      value: year.id,
                      label: year.name,
                    }))}
                  />
                  <Button
                    label={t("Connect year")}
                    variant={
                      group.viewer.yearStatus === "connected"
                        ? "secondary"
                        : "primary"
                    }
                    disabled={
                      !selectedCompatibleYearId ||
                      selectedCompatibleYearId === group.viewer.yearId
                    }
                    loading={selectYear.isPending}
                    onPress={() =>
                      selectedCompatibleYearId &&
                      selectYear.mutate({
                        groupId: groupId ?? "",
                        yearId: selectedCompatibleYearId,
                      })
                    }
                  />
                </>
              ) : group.viewer.yearStatus !== "connected" ? (
                <Note>
                  {t(
                    "None of your existing years matches this class template.",
                  )}
                </Note>
              ) : null}
              {copyOpen ? (
                <>
                  <TextField
                    label={t("New year name")}
                    value={copyName}
                    onChangeText={setCopyName}
                    maxLength={100}
                  />
                  <Note>
                    {t(
                      "A separate empty year is created and connected. Existing years and grades are never changed.",
                    )}
                  </Note>
                  <Button
                    label={t("Create and connect")}
                    icon="copy-outline"
                    disabled={!copyName.trim()}
                    loading={adopt.isPending}
                    onPress={() =>
                      adopt.mutate({
                        groupId: groupId ?? "",
                        name: copyName.trim(),
                      })
                    }
                  />
                  <Button
                    label={t("Cancel")}
                    variant="ghost"
                    onPress={() => setCopyOpen(false)}
                  />
                </>
              ) : (
                <Button
                  label={t("Create a new year")}
                  variant={
                    group.compatibleYears.length > 0 ||
                    group.viewer.yearStatus === "connected"
                      ? "secondary"
                      : "primary"
                  }
                  icon="copy-outline"
                  onPress={() => {
                    setCopyName(template.yearName);
                    setCopyOpen(true);
                  }}
                />
              )}
            </Card>
          </Section>
        ) : null}

        {template && !frozen ? (
          <Section
            title={t("Share in class comparisons")}
            description={t(
              "Sharing is optional and only uses the compatible year connected above.",
            )}
          >
            <Card style={{ gap: space.md }}>
              <SwitchField
                label={t("Share my figures with this class")}
                hint={
                  group.viewer.yearStatus !== "connected"
                    ? t("Connect a compatible year to enable sharing.")
                    : group.viewer.shareAverage
                      ? t("Your figures are visible to this class.")
                      : t("Your figures are hidden from this class.")
                }
                value={group.viewer.shareAverage}
                disabled={
                  setSharing.isPending ||
                  group.viewer.yearStatus !== "connected"
                }
                onValueChange={(value) =>
                  setSharing.mutate({
                    groupId: groupId ?? "",
                    shareAverage: value,
                  })
                }
              />
            </Card>
          </Section>
        ) : null}

        {template ? (
          <Section
            title={t("Comparisons")}
            description={t(
              "Compare the general average or a subject from the shared class model.",
            )}
          >
            <ChipRail
              items={comparisons.map((entry) => ({
                id: entry.id,
                label: comparisonLabel(entry.kind, entry.subjectName),
              }))}
              activeId={active?.id ?? ""}
              onSelect={setActiveId}
            />
            {isOwner && !frozen ? (
              <Card style={{ gap: space.md }}>
                <ChoiceField
                  label={t("Add a comparison")}
                  value={addKind}
                  onChange={setAddKind}
                  columns={2}
                  choices={[
                    { value: "subject", label: t("A subject") },
                    { value: "general", label: t("General average") },
                  ]}
                />
                {addKind === "subject" ? (
                  <ChoiceField
                    label={t("Subject")}
                    value={addSubject || null}
                    onChange={setAddSubject}
                    columns={2}
                    choices={group.availableSubjectOptions.map((subject) => ({
                      value: subject.key,
                      label: subject.name,
                    }))}
                  />
                ) : null}
                <Button
                  label={t("Add")}
                  variant="secondary"
                  icon="add"
                  disabled={addKind === "subject" && !addSubject}
                  loading={addComparison.isPending}
                  onPress={() =>
                    addComparison.mutate({
                      groupId: groupId ?? "",
                      kind: addKind,
                      subjectKey:
                        addKind === "subject" ? addSubject : undefined,
                    })
                  }
                />
                {comparisons.length > 1 && active ? (
                  <Button
                    label={t("Remove this comparison")}
                    variant="ghost"
                    disabled={removeComparison.isPending}
                    onPress={() =>
                      Alert.alert(
                        comparisonLabel(active.kind, active.subjectName),
                        undefined,
                        [
                          { text: t("Cancel"), style: "cancel" },
                          {
                            text: t("Remove this comparison"),
                            style: "destructive",
                            onPress: () => {
                              setActiveId(null);
                              removeComparison.mutate({
                                groupId: groupId ?? "",
                                comparisonId: active.id,
                              });
                            },
                          },
                        ],
                      )
                    }
                  />
                ) : null}
              </Card>
            ) : null}
          </Section>
        ) : null}

        {template && !frozen && active && ratios.length > 0 ? (
          <View style={{ flexDirection: "row", gap: space.sm }}>
            <StatTile
              label={t("Class average")}
              value={formatSharedAverage(
                mean ?? 0,
                statScale,
                statDecimals,
                activeUnit,
              )}
            />
            <StatTile
              label={t("Participation")}
              value={t("{count} of {total}", {
                count: ratios.length,
                total: group.members.length,
              })}
            />
          </View>
        ) : null}

        {template ? (
          <Section
            title={
              active
                ? t("Class leaderboard — {name}", {
                    name: comparisonLabel(active.kind, active.subjectName),
                  })
                : t("Class members")
            }
            description={
              ratios.length
                ? t("Only members who opted in appear with a figure.")
                : t("No class figures are shared yet.")
            }
          >
            <Card padded={false}>
              {[...sharers, ...silent].map((member, index) => {
                const figure = figureOf(member);
                const unavailable =
                  member.yearStatus === "not_connected"
                    ? t("No year connected")
                    : member.yearStatus === "incompatible"
                      ? t("Year incompatible")
                      : t("Not shared");
                return (
                  <Row
                    key={member.membershipId}
                    first={index === 0}
                    title={member.name}
                    subtitle={
                      [
                        member.role === "owner" ? t("Owner") : null,
                        figure?.gradeCount != null
                          ? figure.gradeCount === 1
                            ? t("1 grade")
                            : t("{count} grades", { count: figure.gradeCount })
                          : null,
                      ]
                        .filter(Boolean)
                        .join(" · ") || undefined
                    }
                    leading={
                      figure?.average != null ? (
                        <Text
                          style={[
                            type.callout,
                            numeric,
                            {
                              color: palette.textFaint,
                              width: 22,
                              textAlign: "center",
                            },
                          ]}
                        >
                          {index + 1}
                        </Text>
                      ) : (
                        <View style={{ width: 22 }} />
                      )
                    }
                    trailing={
                      figure?.average != null ? (
                        <View
                          style={{
                            flexDirection: "row",
                            alignItems: "center",
                            gap: space.sm,
                          }}
                        >
                          {figure.trend ? (
                            <Icon
                              name={
                                figure.trend === "up"
                                  ? "trending-up-outline"
                                  : figure.trend === "down"
                                    ? "trending-down-outline"
                                    : "remove-outline"
                              }
                              size={16}
                              color={
                                figure.trend === "up"
                                  ? palette.positive
                                  : figure.trend === "down"
                                    ? palette.negative
                                    : palette.textFaint
                              }
                            />
                          ) : null}
                          <SharedAverageText
                            ratio={figure.average}
                            scale={member.scale}
                            decimals={member.decimals}
                            unit={activeUnit}
                          />
                        </View>
                      ) : (
                        <Text
                          style={[type.footnote, { color: palette.textFaint }]}
                        >
                          {unavailable}
                        </Text>
                      )
                    }
                    onPress={
                      isOwner && member.role !== "owner" && !frozen
                        ? () =>
                            Alert.alert(member.name, undefined, [
                              { text: t("Cancel"), style: "cancel" },
                              {
                                text: t("Remove from class"),
                                style: "destructive",
                                onPress: () =>
                                  removeMember.mutate({
                                    groupId: groupId ?? "",
                                    membershipId: member.membershipId,
                                  }),
                              },
                            ])
                        : undefined
                    }
                  />
                );
              })}
            </Card>
          </Section>
        ) : null}

        {isOwner && template && !frozen ? (
          <Section
            title={t("Invite classmates")}
            description={t(
              "The invitation shows the class model before the person chooses or creates a compatible year.",
            )}
          >
            <Card style={{ gap: space.md }}>
              <Button
                label={t("Share an invitation link")}
                variant="secondary"
                icon="link-outline"
                loading={invite.isPending}
                onPress={() => invite.mutate({ groupId: groupId ?? "" })}
              />
            </Card>
            {invitations.data?.length ? (
              <Card padded={false}>
                {invitations.data.map((invitation, index) => (
                  <Row
                    key={invitation.id}
                    first={index === 0}
                    title={`${invitation.tokenPrefix}…`}
                    subtitle={t("{count} joins · by {name}", {
                      count: invitation.useCount,
                      name: invitation.createdBy,
                    })}
                    trailing={
                      <Button
                        label={t("Revoke")}
                        variant="ghost"
                        size="sm"
                        disabled={revokeInvite.isPending}
                        onPress={() =>
                          revokeInvite.mutate({
                            groupId: groupId ?? "",
                            invitationId: invitation.id,
                          })
                        }
                      />
                    }
                  />
                ))}
              </Card>
            ) : null}
          </Section>
        ) : null}

        {isOwner && !frozen ? (
          <Section title={t("Class settings")}>
            {editing ? (
              <Card style={{ gap: space.md }}>
                <TextField
                  label={t("Class name")}
                  value={name}
                  onChangeText={setName}
                  maxLength={100}
                />
                <TextField
                  label={t("Description (optional)")}
                  value={description}
                  onChangeText={setDescription}
                  multiline
                  maxLength={500}
                />
                <SwitchField
                  label={t("Show each member's 30-day trend")}
                  value={group.showTrend}
                  disabled={update.isPending}
                  onValueChange={(value) =>
                    update.mutate({ groupId: groupId ?? "", showTrend: value })
                  }
                />
                <SwitchField
                  label={t("Show grade counts")}
                  value={group.showGradeCount}
                  disabled={update.isPending}
                  onValueChange={(value) =>
                    update.mutate({
                      groupId: groupId ?? "",
                      showGradeCount: value,
                    })
                  }
                />
                <Button
                  label={t("Save")}
                  disabled={name.trim().length < 2}
                  loading={update.isPending}
                  onPress={() =>
                    update.mutate(
                      {
                        groupId: groupId ?? "",
                        name: name.trim(),
                        description: description.trim(),
                      },
                      { onSuccess: () => setEditing(false) },
                    )
                  }
                />
                <Button
                  label={t("Cancel")}
                  variant="ghost"
                  onPress={() => setEditing(false)}
                />
              </Card>
            ) : (
              <Button
                label={t("Edit name and description")}
                variant="secondary"
                onPress={() => {
                  setName(group.name);
                  setDescription(group.description);
                  setEditing(true);
                }}
              />
            )}
          </Section>
        ) : null}

        <Section title={t("Actions")}>
          <Card style={{ gap: space.sm }}>
            {isOwner ? (
              <Button
                label={t("Delete class")}
                variant="destructive"
                disabled={destroy.isPending}
                onPress={() =>
                  Alert.alert(
                    t("Delete this class?"),
                    t(
                      "The class and its memberships disappear for everyone. Nobody's years or grades are affected.",
                    ),
                    [
                      { text: t("Cancel"), style: "cancel" },
                      {
                        text: t("Delete class"),
                        style: "destructive",
                        onPress: () =>
                          destroy.mutate({ groupId: groupId ?? "" }),
                      },
                    ],
                  )
                }
              />
            ) : (
              <Button
                label={t("Leave class")}
                variant="secondary"
                disabled={leave.isPending}
                onPress={() => leave.mutate({ groupId: groupId ?? "" })}
              />
            )}
            <Button
              label={t("Report a safety concern")}
              variant="ghost"
              onPress={() =>
                router.push({
                  pathname: "/social/report",
                  params: { groupId: groupId ?? "" },
                })
              }
            />
          </Card>
          {isOwner ? <Note>{t("You own this class.")}</Note> : null}
        </Section>
      </Screen>
    </>
  );
}
