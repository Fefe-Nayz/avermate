import { useState } from "react";
import { Alert, Share, Text, View } from "react-native";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Icon } from "@/components/icon";
import {
  SharedAverageText,
  comparisonLabel,
  comparisonUnit,
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

  const setSharing = useMutation({
    ...orpc.social.groups.setSharing.mutationOptions(),
    onSuccess: refresh,
  });
  const invite = useMutation({
    ...orpc.social.groups.invitations.create.mutationOptions(),
    onSuccess: async (invitation) => {
      haptic("success");
      await Share.share({
        message: `${env.webUrl}/social/invitations/${invitation.token}`,
      });
    },
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
  });
  const adopt = useMutation({
    ...orpc.social.groups.adoptSetup.mutationOptions(),
    onSuccess: async (result) => {
      haptic("success");
      refreshYears();
      selectActiveYear(result.yearId);
      await queryClient.invalidateQueries({
        queryKey: orpc.years.list.queryKey(),
      });
      await refresh();
      Alert.alert(
        t("Year created"),
        t("The new year is now connected to this class."),
      );
    },
  });
  const selectYear = useMutation({
    ...orpc.social.groups.selectYear.mutationOptions(),
    onSuccess: async () => {
      haptic("success");
      await refresh();
    },
  });
  const configureClass = useMutation({
    ...orpc.social.groups.configureClass.mutationOptions(),
    onSuccess: async () => {
      haptic("success");
      await refresh();
    },
  });
  const update = useMutation({
    ...orpc.social.groups.update.mutationOptions(),
    onSuccess: async () => {
      haptic("success");
      await refresh();
    },
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
  const median =
    ratios.length === 0
      ? null
      : ratios.length % 2 === 1
        ? (ratios[(ratios.length - 1) / 2] ?? null)
        : ((ratios[ratios.length / 2 - 1] ?? 0) +
            (ratios[ratios.length / 2] ?? 0)) /
          2;
  const statScale = sharers[0]?.scale ?? null;
  const statDecimals = sharers[0]?.decimals ?? null;
  const viewerYear = allYears.find((year) => year.id === group.viewer.yearId);
  const selectedCompatibleYearId =
    yearChoice ?? group.compatibleYears[0]?.id ?? null;
  const selectedTemplateYearId =
    templateYearChoice ?? activeYear?.id ?? years[0]?.id ?? null;

  return (
    <>
      <Stack.Screen options={{ title: group.name }} />
      <Screen>
        {group.description ? <Note>{group.description}</Note> : null}

        <Section title={t("Class template")}>
          {group.classTemplate ? (
            <Card padded={false}>
              <Row
                first
                title={group.classTemplate.yearName}
                subtitle={t("{start} to {end}", {
                  start: new Intl.DateTimeFormat(undefined, {
                    month: "short",
                    year: "numeric",
                  }).format(new Date(group.classTemplate.startsAt)),
                  end: new Intl.DateTimeFormat(undefined, {
                    month: "short",
                    year: "numeric",
                  }).format(new Date(group.classTemplate.endsAt)),
                })}
                trailing={
                  <Badge
                    label={t("Grades out of {scale}", {
                      scale: group.classTemplate.scale,
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
                    subjects: group.classTemplate.subjectCount,
                    averages: group.classTemplate.averageCount,
                    periods: group.classTemplate.periodCount,
                  },
                )}
              />
            </Card>
          ) : isOwner && !frozen ? (
            <Card style={{ gap: space.md }}>
              <Note>
                {t(
                  "Choose one of your years once to define this class template.",
                )}
              </Note>
              {years.length > 0 ? (
                <>
                  <ChoiceField
                    label={t("Class template")}
                    value={selectedTemplateYearId}
                    onChange={setTemplateYearChoice}
                    choices={years.map((year) => ({
                      value: year.id,
                      label: year.name,
                    }))}
                  />
                  <Button
                    label={t("Set class template")}
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
              {t("The owner still needs to choose the class template.")}
            </Note>
          )}
        </Section>

        {!group.setupRequired ? (
          <Section title={t("Your class year")}>
            {group.viewer.yearStatus === "connected" ? (
              <Card padded={false}>
                <Row
                  first
                  title={viewerYear?.name ?? t("Connected year")}
                  subtitle={t(
                    "Only figures from this year can appear in the class.",
                  )}
                  trailing={
                    <Badge
                      label={t("Connected")}
                      icon="checkmark-circle-outline"
                      toneColor="positive"
                    />
                  }
                />
              </Card>
            ) : (
              <Card style={{ gap: space.md }}>
                {group.viewer.yearStatus === "incompatible" ? (
                  <Note>
                    {t(
                      "Your previously selected year no longer matches this class. Nothing in it was changed.",
                    )}
                  </Note>
                ) : null}
                {group.compatibleYears.length > 0 ? (
                  <>
                    <ChoiceField
                      label={t("Use an existing year")}
                      value={selectedCompatibleYearId}
                      onChange={setYearChoice}
                      choices={group.compatibleYears.map((year) => ({
                        value: year.id,
                        label: year.name,
                      }))}
                    />
                    <Button
                      label={t("Connect this year")}
                      disabled={!selectedCompatibleYearId}
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
                ) : (
                  <Note>
                    {t(
                      "None of your existing years matches this class template.",
                    )}
                  </Note>
                )}
                <Button
                  label={t("Create a new year from the template")}
                  variant={
                    group.compatibleYears.length > 0 ? "secondary" : "primary"
                  }
                  loading={adopt.isPending}
                  onPress={() =>
                    Alert.alert(
                      t("Create a separate year?"),
                      t(
                        "Subjects, periods and custom averages are copied. None of your existing years or grades will be changed.",
                      ),
                      [
                        { text: t("Cancel"), style: "cancel" },
                        {
                          text: t("Create my year"),
                          onPress: () =>
                            adopt.mutate({ groupId: groupId ?? "" }),
                        },
                      ],
                    )
                  }
                />
              </Card>
            )}
          </Section>
        ) : null}

        {frozen ? (
          <Card>
            <Note>
              {t(
                "A moderator paused this class after a report. Figures are hidden until the hold is lifted; nothing has been deleted.",
              )}
            </Note>
          </Card>
        ) : group.viewer.yearStatus === "connected" ? (
          <Card style={{ gap: space.md }}>
            <SwitchField
              label={t("Share my figures with this class")}
              hint={t(
                "Sharing is off by default. Only figures from your connected year can appear.",
              )}
              value={group.viewer.shareAverage}
              disabled={setSharing.isPending}
              onValueChange={(value) =>
                setSharing.mutate({
                  groupId: groupId ?? "",
                  shareAverage: value,
                })
              }
            />
          </Card>
        ) : null}

        {!group.setupRequired ? (
          <Section title={t("Boards")}>
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
                  label={t("Add a board")}
                  value={addKind}
                  onChange={setAddKind}
                  columns={2}
                  choices={[
                    { value: "subject", label: t("A subject") },
                    { value: "general", label: t("General average") },
                  ]}
                />
                {addKind === "subject" ? (
                  group.availableSubjectOptions.length > 0 ? (
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
                  ) : (
                    <Note>
                      {t("Subject boards come from the common class template.")}
                    </Note>
                  )
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
                    label={t("Remove this board")}
                    variant="ghost"
                    disabled={removeComparison.isPending}
                    onPress={() =>
                      Alert.alert(
                        comparisonLabel(active.kind, active.subjectName),
                        undefined,
                        [
                          { text: t("Cancel"), style: "cancel" },
                          {
                            text: t("Remove this board"),
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

        {!group.setupRequired && !frozen && active && ratios.length > 0 ? (
          <Section title={comparisonLabel(active.kind, active.subjectName)}>
            <Card padded={false}>
              <Row
                first
                title={t("Class average")}
                trailing={
                  <SharedAverageText
                    ratio={mean}
                    scale={statScale}
                    decimals={statDecimals}
                    unit={activeUnit}
                  />
                }
              />
              <Row
                title={t("Median")}
                trailing={
                  <SharedAverageText
                    ratio={median}
                    scale={statScale}
                    decimals={statDecimals}
                    unit={activeUnit}
                  />
                }
              />
              <Row
                title={t("Range")}
                trailing={
                  <View
                    style={{
                      flexDirection: "row",
                      alignItems: "center",
                      gap: space.xs,
                    }}
                  >
                    <SharedAverageText
                      ratio={ratios[0] ?? null}
                      scale={statScale}
                      decimals={statDecimals}
                      unit={activeUnit}
                    />
                    <Text style={[type.footnote, { color: palette.textFaint }]}>
                      →
                    </Text>
                    <SharedAverageText
                      ratio={ratios.at(-1) ?? null}
                      scale={statScale}
                      decimals={statDecimals}
                      unit={activeUnit}
                    />
                  </View>
                }
              />
            </Card>
          </Section>
        ) : null}

        {!group.setupRequired ? (
          <Section title={t("Class ranking")}>
            <Card padded={false}>
              {[...sharers, ...silent].map((member, index) => {
                const figure = figureOf(member);
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
                      <View
                        style={{
                          flexDirection: "row",
                          alignItems: "center",
                          gap: space.sm,
                        }}
                      >
                        {figure?.trend ? (
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
                          ratio={figure?.average ?? null}
                          scale={member.scale}
                          decimals={member.decimals}
                          unit={activeUnit}
                        />
                      </View>
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
            {!frozen && silent.length > 0 ? (
              <Note>
                {t(
                  "Members without a figure have not connected a compatible year or shared their figures yet.",
                )}
              </Note>
            ) : null}
          </Section>
        ) : null}

        {isOwner && !frozen && !group.setupRequired ? (
          <Section title={t("Invite people")}>
            <Card style={{ gap: space.md }}>
              <Button
                label={t("Share an invitation link")}
                variant="secondary"
                icon="link-outline"
                loading={invite.isPending}
                onPress={() => invite.mutate({ groupId: groupId ?? "" })}
              />
              <Note>
                {t(
                  "The link works for a month or until revoked. Each person must connect a compatible year before joining.",
                )}
              </Note>
            </Card>
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
                      "The class and its memberships disappear for everyone. Nobody's grades are affected.",
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
        </Section>
      </Screen>
    </>
  );
}
