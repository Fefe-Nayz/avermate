import { useState } from "react";
import { Alert } from "react-native";
import { Stack, useRouter } from "expo-router";
import { useMutation } from "@tanstack/react-query";
import { Spacer } from "@expo/ui";
import { Button, Grouped, Line, Section, Text } from "@/components/native";
import { DateField, SliderField, TextField } from "@/components/controls";
import { formatNumber, parseNumber } from "@/components/format";
import { useYear } from "@/components/year-provider";
import { client, queryClient } from "@/lib/orpc";
import { haptic } from "@/lib/haptics";
import { t } from "@/lib/i18n";
import { space } from "@/lib/theme";

/**
 * How this year counts.
 *
 * Four settings, and every one of them changes every number in the app — so
 * each says what it does in its own line rather than relying on a label. The
 * passing mark is a slider because it is a judgement about where "good enough"
 * sits, and it drives the colour of every result on every screen.
 */
export default function YearSettings() {
  const router = useRouter();
  const { year, years, selectYear } = useYear();

  const [name, setName] = useState(year?.name ?? "");
  const [startsAt, setStartsAt] = useState(
    year ? new Date(year.startsAt) : new Date(),
  );
  const [endsAt, setEndsAt] = useState(year ? new Date(year.endsAt) : new Date());
  const [scale, setScale] = useState(String(year?.scale ?? 20));
  const [defaultOutOf, setDefaultOutOf] = useState(
    String(year?.defaultOutOf ?? 20),
  );
  const [decimals, setDecimals] = useState(String(year?.decimals ?? 2));
  const [passing, setPassing] = useState(year?.passingRatio ?? 0.5);
  const [error, setError] = useState<string | null>(null);

  const save = useMutation({
    mutationFn: (input: Parameters<typeof client.years.update>[0]) =>
      client.years.update(input),
    onSuccess: () => {
      haptic("success");
      void queryClient.invalidateQueries();
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
    onSuccess: () => {
      haptic("success");
      queryClient.clear();
      router.dismissTo("/(tabs)");
    },
  });

  if (!year) return null;

  const numericScale = parseNumber(scale) ?? 20;

  const confirmDelete = () => {
    Alert.alert(
      t("Delete {name}?", { name: year.name }),
      t("Every subject and grade in this year goes with it. This cannot be undone."),
      [
        { text: t("Cancel"), style: "cancel" },
        {
          text: t("Delete"),
          style: "destructive",
          onPress: () => {
            haptic("warning");
            const fallback = years.find((item) => item.id !== year.id);
            if (fallback) selectYear(fallback.id);
            remove.mutate({ yearId: year.id });
          },
        },
      ],
    );
  };

  return (
    <>
      <Stack.Screen options={{ title: t("School year") }} />
      <Grouped
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
          <TextField label={t("Year name")} value={name} onChangeText={setName} />
          <DateField label={t("Starts")} value={startsAt} onChange={setStartsAt} />
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
          <Text size="footnote" tone="muted">
            {t("This drives the colour of every result and the pass rate.")}
          </Text>
        </Section>

        <Section title={t("Structure")}>
          <Line
            leading="period"
            title={t("Periods")}
            onPress={() => router.push("/settings/periods")}
          />
        </Section>

        {years.length > 1 ? (
          <Section>
            <Line
              leading="danger"
              title={t("Delete this year")}
              destructive
              onPress={confirmDelete}
            />
          </Section>
        ) : null}

        {error ? (
          <Section>
            <Text size="footnote" tone="negative">
              {error}
            </Text>
          </Section>
        ) : null}

        <Spacer size={space.xl} />
      </Grouped>
    </>
  );
}
