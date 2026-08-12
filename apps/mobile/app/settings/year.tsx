import { useState } from "react";
import { Alert, Pressable, StyleSheet, Text, View } from "react-native";
import { Icon, type IconName } from "@/components/icon";
import { Stack, useRouter } from "expo-router";
import { useMutation } from "@tanstack/react-query";
import {
  Button,
  Card,
  Note,
  Problem,
  Row,
  Screen,
  Section,
} from "@/components/ui";
import { SliderField, TextField } from "@/components/field";
import { DateField } from "@/components/date-field";
import { formatNumber, parseNumber } from "@/components/format";
import { useYear } from "@/components/year-provider";
import { client, orpc, queryClient } from "@/lib/orpc";
import { haptic } from "@/lib/haptics";
import { t } from "@/lib/i18n";
import { space, type, usePalette } from "@/lib/theme";
import { yearSetupHref } from "@/lib/year-setup";

function YearIconButton({
  icon,
  label,
  disabled,
  destructive = false,
  onPress,
}: {
  icon: IconName;
  label: string;
  disabled?: boolean;
  destructive?: boolean;
  onPress: () => void;
}) {
  const palette = usePalette();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      disabled={disabled}
      hitSlop={8}
      onPress={() => {
        haptic(destructive ? "warning" : "selection");
        onPress();
      }}
      style={({ pressed }) => ({
        width: 36,
        height: 36,
        alignItems: "center",
        justifyContent: "center",
        borderRadius: 10,
        backgroundColor: pressed ? palette.accentSoft : "transparent",
        opacity: disabled ? 0.3 : 1,
      })}
    >
      <Icon
        name={icon}
        size={19}
        color={destructive ? palette.negative : palette.textMuted}
      />
    </Pressable>
  );
}

/**
 * How this year counts.
 *
 * Four settings, and every one of them changes every number in the app — so
 * each says what it does in its own line rather than relying on a label. The
 * passing mark is a slider because it is a judgement about where "good enough"
 * sits, and it drives the colour of every result on every screen.
 */
export default function YearSettings() {
  const palette = usePalette();
  const router = useRouter();
  const { year, years, allYears, selectYear } = useYear();

  const [name, setName] = useState(year?.name ?? "");
  const [startsAt, setStartsAt] = useState(
    year ? new Date(year.startsAt) : new Date(),
  );
  const [endsAt, setEndsAt] = useState(
    year ? new Date(year.endsAt) : new Date(),
  );
  const [scale, setScale] = useState(String(year?.scale ?? 20));
  const [defaultOutOf, setDefaultOutOf] = useState(
    String(year?.defaultOutOf ?? 20),
  );
  const [decimals, setDecimals] = useState(String(year?.decimals ?? 2));
  const [passing, setPassing] = useState(year?.passingRatio ?? 0.5);
  const [error, setError] = useState<string | null>(null);
  const activeYearCount = allYears.filter((item) => !item.archivedAt).length;
  const refreshYears = () =>
    queryClient.invalidateQueries({ queryKey: orpc.years.list.queryKey() });

  const save = useMutation({
    mutationFn: (input: Parameters<typeof client.years.update>[0]) =>
      client.years.update(input),
    onSuccess: async () => {
      haptic("success");
      await Promise.all([
        refreshYears(),
        queryClient.invalidateQueries({ queryKey: orpc.snapshot.get.key() }),
      ]);
      router.back();
    },
    onError: () => {
      haptic("error");
      setError(t("That could not be saved."));
    },
  });

  const remove = useMutation({
    mutationFn: (input: Parameters<typeof client.years.delete>[0]) =>
      client.years.delete(input),
    onSuccess: async (_result, input) => {
      haptic("success");
      if (input.yearId === year?.id) {
        const fallback = years.find((item) => item.id !== input.yearId);
        if (fallback) selectYear(fallback.id);
      }
      queryClient.removeQueries({
        queryKey: orpc.snapshot.get.queryKey({
          input: { yearId: input.yearId },
        }),
      });
      await refreshYears();
      if (input.yearId === year?.id) router.dismissTo("/(tabs)");
    },
  });

  const reorder = useMutation({
    mutationFn: (input: Parameters<typeof client.years.reorder>[0]) =>
      client.years.reorder(input),
    onSuccess: refreshYears,
    onError: () => setError(t("The school years could not be reordered.")),
  });

  const archive = useMutation({
    mutationFn: (input: Parameters<typeof client.years.archive>[0]) =>
      client.years.archive(input),
    onSuccess: async (_result, input) => {
      if (input.archived && input.yearId === year?.id) {
        const fallback = years.find((item) => item.id !== input.yearId);
        if (fallback) selectYear(fallback.id);
      }
      haptic("success");
      await refreshYears();
    },
    onError: () => setError(t("That year could not be archived.")),
  });

  if (!year) return null;

  const numericScale = parseNumber(scale) ?? 20;

  const moveYear = (index: number, direction: -1 | 1) => {
    const target = index + direction;
    if (target < 0 || target >= allYears.length) return;
    const ids = allYears.map((item) => item.id);
    [ids[index], ids[target]] = [ids[target]!, ids[index]!];
    reorder.mutate({ yearIds: ids });
  };

  const confirmDelete = async (item: (typeof allYears)[number]) => {
    let contents: Awaited<ReturnType<typeof client.years.contents>>;
    try {
      contents = await client.years.contents({ yearId: item.id });
    } catch {
      setError(t("The contents of that year could not be checked."));
      return;
    }
    Alert.alert(
      t("Delete {name}?", { name: item.name }),
      t(
        "This permanently deletes {subjects} subjects, {grades} grades and {periods} periods. This cannot be undone.",
        contents,
      ),
      [
        { text: t("Cancel"), style: "cancel" },
        {
          text: t("Delete"),
          style: "destructive",
          onPress: () => {
            haptic("warning");
            remove.mutate({ yearId: item.id });
          },
        },
      ],
    );
  };

  return (
    <>
      <Stack.Screen options={{ title: t("School year") }} />
      <Screen
        footer={
          <Button
            label={t("Save")}
            disabled={save.isPending}
            onPress={() =>
              save.mutate({
                yearId: year.id,
                name: name.trim(),
                startsAt,
                endsAt,
                scale: numericScale,
                defaultOutOf: parseNumber(defaultOutOf) ?? numericScale,
                decimals: Math.max(0, Math.min(4, parseNumber(decimals) ?? 2)),
                passingRatio: passing,
              })
            }
          />
        }
      >
        <Section title={t("The year itself")}>
          <TextField
            label={t("Year name")}
            value={name}
            onChangeText={setName}
          />
          <DateField
            label={t("Starts")}
            value={startsAt}
            onChange={setStartsAt}
          />
          <DateField
            label={t("Ends")}
            value={endsAt}
            onChange={setEndsAt}
            min={startsAt}
          />
        </Section>

        <Section title={t("How grades are written")}>
          <TextField
            label={t("Grades are out of")}
            value={scale}
            onChangeText={setScale}
            keyboardType="decimal-pad"
          />
          <TextField
            label={t("Default maximum")}
            value={defaultOutOf}
            onChangeText={setDefaultOutOf}
            keyboardType="decimal-pad"
          />
          <TextField
            label={t("Decimal places")}
            value={decimals}
            onChangeText={setDecimals}
            keyboardType="number-pad"
          />
        </Section>

        <Section title={t("What counts as a pass")}>
          <SliderField
            label={t("Passing mark")}
            value={passing}
            onValueChange={setPassing}
            min={0}
            max={1}
            step={0.01}
            display={(value) =>
              `${formatNumber(value * numericScale, 1)} / ${formatNumber(numericScale)}`
            }
          />
          <Note>
            {t("This drives the colour of every result and the pass rate.")}
          </Note>
        </Section>

        <Section title={t("Structure")}>
          <Card padded={false}>
            <Row
              title={t("Periods")}
              onPress={() => router.push("/settings/periods")}
            />
          </Card>
        </Section>

        <Section title={t("School years")}>
          <Note>
            {t(
              "Reorder the picker, archive old years, or permanently delete one.",
            )}
          </Note>
          <Button
            label={t("Add a year")}
            icon="add"
            variant="secondary"
            onPress={() => router.push("/year/new")}
          />
          <Card padded={false}>
            {allYears.map((item, index) => {
              const isArchived = Boolean(item.archivedAt);
              const isCurrent = item.id === year.id;
              const canArchive = isArchived || activeYearCount > 1;
              const canDelete =
                allYears.length > 1 && (isArchived || activeYearCount > 1);
              return (
                <View
                  key={item.id}
                  style={{
                    minHeight: 68,
                    paddingHorizontal: space.md,
                    paddingVertical: space.sm,
                    borderTopWidth: index === 0 ? 0 : StyleSheet.hairlineWidth,
                    borderTopColor: palette.hairline,
                    flexDirection: "row",
                    alignItems: "center",
                    gap: space.sm,
                  }}
                >
                  <View style={{ flex: 1, gap: 2 }}>
                    <Text
                      numberOfLines={1}
                      style={[type.body, { color: palette.text }]}
                    >
                      {item.name}
                    </Text>
                    <Text
                      numberOfLines={1}
                      style={[type.footnote, { color: palette.textMuted }]}
                    >
                      {isCurrent
                        ? t("Current")
                        : isArchived
                          ? t("Archived")
                          : `${new Date(item.startsAt).toLocaleDateString()} → ${new Date(item.endsAt).toLocaleDateString()}`}
                    </Text>
                  </View>
                  <YearIconButton
                    icon="options-outline"
                    label={t("Configure {name}", { name: item.name })}
                    onPress={() => {
                      selectYear(item.id);
                      router.push(yearSetupHref(item.id));
                    }}
                  />
                  <YearIconButton
                    icon="arrow-up-outline"
                    label={t("Move {name} up", { name: item.name })}
                    disabled={index === 0 || reorder.isPending}
                    onPress={() => moveYear(index, -1)}
                  />
                  <YearIconButton
                    icon="arrow-down-outline"
                    label={t("Move {name} down", { name: item.name })}
                    disabled={
                      index === allYears.length - 1 || reorder.isPending
                    }
                    onPress={() => moveYear(index, 1)}
                  />
                  <YearIconButton
                    icon={isArchived ? "archive-outline" : "archive"}
                    label={
                      isArchived
                        ? t("Restore {name}", { name: item.name })
                        : t("Archive {name}", { name: item.name })
                    }
                    disabled={!canArchive || archive.isPending}
                    onPress={() =>
                      archive.mutate({ yearId: item.id, archived: !isArchived })
                    }
                  />
                  <YearIconButton
                    icon="trash-outline"
                    label={t("Delete {name}", { name: item.name })}
                    disabled={!canDelete || remove.isPending}
                    destructive
                    onPress={() => void confirmDelete(item)}
                  />
                </View>
              );
            })}
          </Card>
          {activeYearCount === 1 ? (
            <Note>
              {t(
                "Restore another year before archiving or deleting the active one.",
              )}
            </Note>
          ) : null}
        </Section>

        {error ? (
          <Section>
            <Problem>{error}</Problem>
          </Section>
        ) : null}
      </Screen>
    </>
  );
}
