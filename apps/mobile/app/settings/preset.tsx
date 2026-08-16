import { useState } from "react";
import { Alert, Pressable, StyleSheet, Text, View } from "react-native";
import { Icon, type IconName } from "@/components/icon";
import { Stack } from "expo-router";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  Badge,
  Button,
  Card,
  Confirmation,
  Loading,
  Note,
  Screen,
  Section,
} from "@/components/ui";
import { useYear } from "@/components/year-provider";
import { client, orpc, queryClient } from "@/lib/orpc";
import { haptic } from "@/lib/haptics";
import { t } from "@/lib/i18n";
import { radius, space, type, usePalette } from "@/lib/theme";

type PresetLinkState =
  "none" | "current" | "update_available" | "customized" | "action_required";

interface ChangeCount {
  label: string;
  value: number;
  /** `add` and `remove` are signed and coloured; `edit` is neutral. */
  kind: "add" | "edit" | "remove";
}

/**
 * What a version does to a year. Only the non-zero lines survive, so the
 * summary is a sentence about the update rather than a scoreboard of zeros.
 */
function ChangeSummary({
  counts,
  emptyLabel,
}: {
  counts: readonly ChangeCount[];
  emptyLabel: string;
}) {
  const palette = usePalette();
  const meaningful = counts.filter((count) => count.value !== 0);

  if (meaningful.length === 0) {
    return (
      <Text style={[type.footnote, { color: palette.textMuted }]}>
        {emptyLabel}
      </Text>
    );
  }

  return (
    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.sm }}>
      {meaningful.map((count) => {
        const color =
          count.kind === "add"
            ? palette.positive
            : count.kind === "remove"
              ? palette.negative
              : palette.text;
        return (
          <View
            key={`${count.kind}:${count.label}`}
            style={{
              flexDirection: "row",
              alignItems: "baseline",
              gap: space.xs,
              borderRadius: radius.md,
              borderCurve: "continuous",
              backgroundColor:
                count.kind === "edit" ? palette.accentSoft : `${color}18`,
              paddingHorizontal: space.sm,
              paddingVertical: space.xs,
            }}
          >
            <Text
              selectable
              style={[
                type.callout,
                {
                  color,
                  fontWeight: "600",
                  fontVariant: ["tabular-nums"],
                },
              ]}
            >
              {count.kind === "add" ? "+" : count.kind === "remove" ? "−" : ""}
              {Math.abs(count.value)}
            </Text>
            <Text style={[type.label, { color, textTransform: "none" }]}>
              {count.label}
            </Text>
          </View>
        );
      })}
    </View>
  );
}

/**
 * Whether this year still follows an official curriculum.
 *
 * The state comes first — the page answers "is anything about to change under
 * me" — and choosing a preset second, because it is the rarer act.
 */
export default function PresetSettings() {
  const palette = usePalette();
  const { year } = useYear();
  const [selectedPresetId, setSelectedPresetId] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const yearId = year?.id ?? "";
  const presetStatus = useQuery({
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

  const say = (message: string) => {
    setError(null);
    setStatus(message);
  };

  const synchronize = useMutation({
    mutationFn: () => client.presets.synchronize({ yearId }),
    onSuccess: async () => {
      haptic("success");
      say(t("Preset updated."));
      await refresh();
    },
    onError: (cause: Error) => {
      haptic("error");
      setStatus(null);
      setError(cause.message);
    },
  });
  const detach = useMutation({
    mutationFn: () => client.presets.detach({ yearId }),
    onSuccess: async () => {
      haptic("warning");
      say(t("This year is now customized."));
      await refresh();
    },
    onError: (cause: Error) => {
      setStatus(null);
      setError(cause.message);
    },
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
      say(t("Preset applied."));
      setSelectedPresetId(null);
      await refresh();
    },
    onError: (cause: Error) => {
      haptic("error");
      setStatus(null);
      setError(cause.message);
    },
  });

  if (!year || presetStatus.isLoading) return <Loading />;
  const data = presetStatus.data;
  const state: PresetLinkState = data?.state ?? "none";
  const linked = state !== "none" && data?.preset ? data.preset : null;

  // The web's stateCopy, verbatim: the state first, in plain words.
  const statePresentation: Record<
    PresetLinkState,
    { icon: IconName; color: string; title: string; body: string }
  > = {
    none: {
      icon: "sparkles",
      color: palette.textMuted,
      title: t("This year follows no preset"),
      body: t(
        "Its subjects are entirely your own. Linking one brings a ready-made structure and keeps it updated.",
      ),
    },
    current: {
      icon: "checkmark-circle",
      color: palette.positive,
      title: t("Up to date"),
      body: t("Nothing will change unless you choose to change it."),
    },
    update_available: {
      icon: "refresh-circle",
      color: palette.accent,
      title: t("An update is ready"),
      body: t("Read what it does below, then apply it when you want to."),
    },
    customized: {
      icon: "unlink",
      color: palette.accent,
      title: t("This year is yours"),
      body: t(
        "Your subjects and averages differ from the preset. Official updates will never overwrite them.",
      ),
    },
    action_required: {
      icon: "warning",
      color: palette.negative,
      title: t("This update needs a decision"),
      body: t(
        "It removes subjects that already hold grades, so nothing has been changed.",
      ),
    },
  };
  const presentation = statePresentation[state];

  const confirmDetach = () =>
    Alert.alert(
      t("Customize this year?"),
      t(
        "Nothing is deleted. This year simply stops receiving official preset updates until you explicitly reapply one.",
      ),
      [
        { text: t("Cancel"), style: "cancel" },
        {
          text: t("Customize"),
          onPress: () => detach.mutate(),
        },
      ],
    );

  const replacing =
    (preview.data?.existing.subjects ?? 0) > 0 ||
    (preview.data?.existing.averages ?? 0) > 0;

  const confirmApply = () => {
    if (!preview.data) return;
    if (!replacing) return apply.mutate();
    Alert.alert(
      t("Replace this configuration?"),
      t(
        "This replaces {subjects} subjects and {averages} averages. The operation is blocked if any grade could be deleted.",
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
            borderColor: presentation.color,
            backgroundColor: `${presentation.color}10`,
          }}
        >
          <View style={{ flexDirection: "row", gap: space.md }}>
            <Icon
              name={presentation.icon}
              size={24}
              color={presentation.color}
            />
            <View style={{ flex: 1, gap: space.xs }}>
              <View
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  flexWrap: "wrap",
                  gap: space.sm,
                }}
              >
                <Text
                  selectable
                  style={[type.heading, { color: palette.text }]}
                >
                  {presentation.title}
                </Text>
                {linked ? (
                  <Badge
                    label={`${linked.name} · v${data?.membership?.appliedVersion ?? ""}`}
                  />
                ) : null}
              </View>
              <Text
                selectable
                style={[type.footnote, { color: palette.textMuted }]}
              >
                {presentation.body}
              </Text>
            </View>
          </View>

          {data?.changes ? (
            <View style={{ marginTop: space.md }}>
              <ChangeSummary
                emptyLabel={t("This update changes nothing in your year.")}
                counts={[
                  {
                    label: t("subjects"),
                    value: data.changes.subjectsAdded,
                    kind: "add",
                  },
                  {
                    label: t("subjects changed"),
                    value: data.changes.subjectsChanged,
                    kind: "edit",
                  },
                  {
                    label: t("subjects"),
                    value: data.changes.subjectsRemoved,
                    kind: "remove",
                  },
                  {
                    label: t("averages"),
                    value: data.changes.averagesAdded,
                    kind: "add",
                  },
                  {
                    label: t("averages changed"),
                    value: data.changes.averagesChanged,
                    kind: "edit",
                  },
                  {
                    label: t("averages"),
                    value: data.changes.averagesRemoved,
                    kind: "remove",
                  },
                ]}
              />
            </View>
          ) : null}

          {data?.blockers.length ? (
            <View
              style={{
                marginTop: space.md,
                gap: space.xs,
                borderRadius: radius.md,
                borderCurve: "continuous",
                borderWidth: StyleSheet.hairlineWidth,
                borderColor: `${palette.negative}40`,
                backgroundColor: palette.background,
                paddingHorizontal: space.md,
                paddingVertical: space.sm,
              }}
            >
              {data.blockers.map((blocker) => (
                <Text
                  key={blocker.subjectId}
                  selectable
                  style={[type.footnote, { color: palette.text }]}
                >
                  {t("{name}: {count} grades would be affected", {
                    name: blocker.subjectName,
                    count: blocker.gradeCount,
                  })}
                </Text>
              ))}
            </View>
          ) : null}

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
          {state !== "customized" && state !== "none" ? (
            <View
              style={{
                paddingTop: state === "update_available" ? space.sm : space.md,
              }}
            >
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
          icon="sparkles"
          title={linked ? t("Switch to another preset") : t("Choose a preset")}
          description={t(
            "A preset brings subjects, coefficients, hierarchy and useful custom averages.",
          )}
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
                    setSelectedPresetId((current) =>
                      current === preset.id ? null : preset.id,
                    );
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
                    {preset.featured ? (
                      <Icon name="sparkles" size={15} color={palette.accent} />
                    ) : null}
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
                  {preset.description ? (
                    <Text
                      selectable
                      style={[type.footnote, { color: palette.textMuted }]}
                    >
                      {preset.description}
                    </Text>
                  ) : null}
                  <View
                    style={{
                      flexDirection: "row",
                      flexWrap: "wrap",
                      alignItems: "center",
                      gap: space.xs,
                    }}
                  >
                    {preset.tags?.map((tag) => (
                      <Badge key={tag} label={tag} />
                    ))}
                    <Text
                      selectable
                      style={[type.label, { color: palette.textFaint }]}
                    >
                      {t("{subjects} subjects · {averages} averages", {
                        subjects: preset.subjectCount,
                        averages: preset.averageCount,
                      })}
                    </Text>
                  </View>
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
              {replacing
                ? t(
                    "This replaces {subjects} current subjects and {averages} current averages.",
                    {
                      subjects: preview.data.existing.subjects,
                      averages: preview.data.existing.averages,
                    },
                  )
                : t("This year is empty, so nothing can be lost.")}
            </Text>
            <View style={{ paddingTop: space.md }}>
              <Button
                label={linked ? t("Reapply preset") : t("Apply preset")}
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

        {status ? <Confirmation>{status}</Confirmation> : null}
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
