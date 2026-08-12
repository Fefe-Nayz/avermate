import { useState } from "react";
import { Alert, Pressable, StyleSheet, Text, View } from "react-native";
import { Icon } from "@/components/icon";
import { Stack } from "expo-router";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Button, Card, Loading, Note, Screen, Section } from "@/components/ui";
import { useYear } from "@/components/year-provider";
import { client, orpc, queryClient } from "@/lib/orpc";
import { haptic } from "@/lib/haptics";
import { t } from "@/lib/i18n";
import { radius, space, type, usePalette } from "@/lib/theme";

export default function PresetSettings() {
  const palette = usePalette();
  const { year } = useYear();
  const [selectedPresetId, setSelectedPresetId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const yearId = year?.id ?? "";
  const status = useQuery({
    ...orpc.presets.status.queryOptions({ input: { yearId } }),
    enabled: Boolean(year),
  });
  const presets = useQuery(orpc.presets.list.queryOptions());
  const preview = useQuery({
    ...orpc.presets.previewApply.queryOptions({
      input: { yearId, presetId: selectedPresetId ?? "" },
    }),
    enabled: Boolean(year && selectedPresetId),
  });

  const refresh = () =>
    Promise.all([
      queryClient.invalidateQueries({
        queryKey: orpc.presets.status.queryKey({ input: { yearId } }),
      }),
      queryClient.invalidateQueries({
        queryKey: orpc.snapshot.get.queryKey({ input: { yearId } }),
      }),
      queryClient.invalidateQueries({ queryKey: orpc.years.list.key() }),
      queryClient.invalidateQueries({
        queryKey: orpc.announcements.active.key(),
      }),
      queryClient.invalidateQueries({
        queryKey: orpc.announcements.history.key(),
      }),
    ]);

  const synchronize = useMutation({
    mutationFn: () => client.presets.synchronize({ yearId }),
    onSuccess: async () => {
      haptic("success");
      setError(null);
      await refresh();
    },
    onError: (cause: Error) => {
      haptic("error");
      setError(cause.message);
    },
  });
  const detach = useMutation({
    mutationFn: () => client.presets.detach({ yearId }),
    onSuccess: async () => {
      haptic("warning");
      setError(null);
      await refresh();
    },
    onError: (cause: Error) => setError(cause.message),
  });
  const apply = useMutation({
    mutationFn: async () => {
      if (!selectedPresetId || !preview.data) return;
      const empty =
        preview.data.existing.subjects === 0 &&
        preview.data.existing.averages === 0;
      return empty
        ? client.presets.apply({
            yearId,
            presetId: selectedPresetId,
            replaceExisting: false,
          })
        : client.presets.reapply({
            yearId,
            presetId: selectedPresetId,
            acknowledgeReplacement: true,
          });
    },
    onSuccess: async () => {
      haptic("success");
      setError(null);
      setSelectedPresetId(null);
      await refresh();
    },
    onError: (cause: Error) => {
      haptic("error");
      setError(cause.message);
    },
  });

  if (!year || status.isLoading) return <Loading />;
  const data = status.data;
  const state = data?.state ?? "none";
  const statePresentation = {
    current: {
      icon: "checkmark-circle" as const,
      color: palette.positive,
      title: t("Preset up to date"),
      body: t("This year follows version {version} of {name}.", {
        version: data?.membership?.appliedVersion ?? "",
        name: data?.preset?.name ?? "",
      }),
    },
    update_available: {
      icon: "refresh-circle" as const,
      color: palette.accent,
      title: t("Preset update available"),
      body: t("Review the official changes before updating."),
    },
    customized: {
      icon: "unlink" as const,
      color: palette.accent,
      title: t("Customized year"),
      body: t(
        "Your configuration is protected. Official preset updates will not overwrite it.",
      ),
    },
    action_required: {
      icon: "warning" as const,
      color: palette.negative,
      title: t("Update needs your decision"),
      body: t(
        "The update would remove subjects that already contain grades, so nothing was changed.",
      ),
    },
    none: {
      icon: "sparkles" as const,
      color: palette.textMuted,
      title: t("No linked preset"),
      body: t(
        "Choose a curriculum below, or keep managing this year yourself.",
      ),
    },
  }[state];

  const confirmDetach = () =>
    Alert.alert(
      t("Customize this year?"),
      t(
        "Nothing is deleted. This year simply stops receiving official preset updates until you reapply one.",
      ),
      [
        { text: t("Cancel"), style: "cancel" },
        {
          text: t("Customize"),
          onPress: () => detach.mutate(),
        },
      ],
    );

  const confirmApply = () => {
    if (!preview.data) return;
    const empty =
      preview.data.existing.subjects === 0 &&
      preview.data.existing.averages === 0;
    if (empty) return apply.mutate();
    Alert.alert(
      t("Replace this configuration?"),
      t(
        "This replaces {subjects} subjects and {averages} averages. Avermate blocks the operation if any grade could be deleted.",
        {
          subjects: preview.data.existing.subjects,
          averages: preview.data.existing.averages,
        },
      ),
      [
        { text: t("Cancel"), style: "cancel" },
        {
          text: t("Replace and link"),
          style: "destructive",
          onPress: () => apply.mutate(),
        },
      ],
    );
  };

  return (
    <>
      <Stack.Screen options={{ title: t("Year preset") }} />
      <Screen>
        <Card
          style={{
            borderColor: statePresentation.color,
            backgroundColor: `${statePresentation.color}10`,
          }}
        >
          <View style={{ flexDirection: "row", gap: space.md }}>
            <Icon
              name={statePresentation.icon}
              size={24}
              color={statePresentation.color}
            />
            <View style={{ flex: 1, gap: space.xs }}>
              <Text selectable style={[type.heading, { color: palette.text }]}>
                {statePresentation.title}
              </Text>
              <Text
                selectable
                style={[type.footnote, { color: palette.textMuted }]}
              >
                {statePresentation.body}
              </Text>
              {data?.preset ? (
                <Text
                  selectable
                  style={[type.label, { color: palette.textFaint }]}
                >
                  {data.preset.name} · v{data.membership?.appliedVersion}
                </Text>
              ) : null}
            </View>
          </View>

          {data?.changes ? (
            <View
              style={{
                marginTop: space.md,
                flexDirection: "row",
                flexWrap: "wrap",
                gap: space.sm,
              }}
            >
              {[
                [
                  t("Added"),
                  data.changes.subjectsAdded + data.changes.averagesAdded,
                ],
                [
                  t("Changed"),
                  data.changes.subjectsChanged + data.changes.averagesChanged,
                ],
                [
                  t("Removed"),
                  data.changes.subjectsRemoved + data.changes.averagesRemoved,
                ],
              ].map(([label, count]) => (
                <View
                  key={String(label)}
                  style={{
                    flexGrow: 1,
                    minWidth: 80,
                    borderRadius: radius.md,
                    backgroundColor: palette.background,
                    padding: space.sm,
                  }}
                >
                  <Text
                    selectable
                    style={[
                      type.heading,
                      { color: palette.text, fontVariant: ["tabular-nums"] },
                    ]}
                  >
                    {count}
                  </Text>
                  <Text
                    selectable
                    style={[type.footnote, { color: palette.textMuted }]}
                  >
                    {label}
                  </Text>
                </View>
              ))}
            </View>
          ) : null}

          {data?.blockers.map((blocker) => (
            <Text
              key={blocker.subjectId}
              selectable
              style={[
                type.footnote,
                { color: palette.negative, paddingTop: space.sm },
              ]}
            >
              {t("{name}: {count} grades would be affected", {
                name: blocker.subjectName,
                count: blocker.gradeCount,
              })}
            </Text>
          ))}

          {state === "update_available" ? (
            <View style={{ paddingTop: space.md }}>
              <Button
                label={t("Update to version {version}", {
                  version: data?.preset?.currentVersion ?? "",
                })}
                icon="refresh"
                loading={synchronize.isPending}
                onPress={() => synchronize.mutate()}
              />
            </View>
          ) : null}
          {state === "current" ||
          state === "update_available" ||
          state === "action_required" ? (
            <View style={{ paddingTop: space.sm }}>
              <Button
                label={t("Customize this year")}
                variant="secondary"
                icon="unlink"
                loading={detach.isPending}
                onPress={confirmDetach}
              />
            </View>
          ) : null}
        </Card>

        <Section
          title={
            data?.preset ? t("Choose another preset") : t("Choose a preset")
          }
        >
          <View style={{ gap: space.sm }}>
            {presets.data?.map((preset) => {
              const selected = preset.id === selectedPresetId;
              return (
                <Pressable
                  key={preset.id}
                  accessibilityRole="radio"
                  accessibilityState={{ checked: selected }}
                  onPress={() => {
                    haptic("selection");
                    setSelectedPresetId(preset.id);
                  }}
                  style={({ pressed }) => ({
                    padding: space.md,
                    gap: space.xs,
                    borderRadius: radius.lg,
                    borderCurve: "continuous",
                    borderWidth: selected ? 2 : StyleSheet.hairlineWidth,
                    borderColor: selected ? palette.accent : palette.border,
                    backgroundColor: pressed
                      ? palette.accentSoft
                      : selected
                        ? `${palette.accent}10`
                        : palette.surface,
                  })}
                >
                  <View
                    style={{
                      flexDirection: "row",
                      alignItems: "center",
                      gap: space.sm,
                    }}
                  >
                    <Text
                      selectable
                      style={[type.heading, { color: palette.text, flex: 1 }]}
                    >
                      {preset.name}
                    </Text>
                    <Text
                      selectable
                      style={[type.label, { color: palette.textFaint }]}
                    >
                      v{preset.version}
                    </Text>
                    {selected ? (
                      <Icon
                        name="checkmark-circle"
                        size={20}
                        color={palette.accent}
                      />
                    ) : null}
                  </View>
                  <Text
                    selectable
                    style={[type.footnote, { color: palette.textMuted }]}
                  >
                    {preset.description}
                  </Text>
                  <Text
                    selectable
                    style={[type.label, { color: palette.textFaint }]}
                  >
                    {t("{subjects} subjects · {averages} averages", {
                      subjects: preset.subjectCount,
                      averages: preset.averageCount,
                    })}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </Section>

        {selectedPresetId && preview.data ? (
          <Card>
            <Text
              selectable
              style={[type.footnote, { color: palette.textMuted }]}
            >
              {preview.data.existing.subjects > 0 ||
              preview.data.existing.averages > 0
                ? t(
                    "This replaces {subjects} current subjects and {averages} current averages.",
                    {
                      subjects: preview.data.existing.subjects,
                      averages: preview.data.existing.averages,
                    },
                  )
                : t("This year is empty, so the preset can be linked safely.")}
            </Text>
            <View style={{ paddingTop: space.md }}>
              <Button
                label={data?.preset ? t("Reapply preset") : t("Apply preset")}
                icon="sparkles"
                loading={apply.isPending}
                disabled={!preview.data.canReplace}
                onPress={confirmApply}
              />
            </View>
            {!preview.data.canReplace ? (
              <View style={{ paddingTop: space.sm }}>
                <Note>
                  {t(
                    "This year contains {count} grades. Avermate will not replace subjects that carry student data.",
                    { count: preview.data.gradeCount },
                  )}
                </Note>
              </View>
            ) : null}
          </Card>
        ) : null}

        {error ? (
          <Card style={{ borderColor: palette.negative }}>
            <Text
              selectable
              style={[type.footnote, { color: palette.negative }]}
            >
              {error}
            </Text>
          </Card>
        ) : null}
      </Screen>
    </>
  );
}
