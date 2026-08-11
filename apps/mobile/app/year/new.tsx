import { useMemo, useRef, useState } from "react";
import { KeyboardAvoidingView, Platform, Text } from "react-native";
import { Stack, useRouter } from "expo-router";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Button, Screen } from "@/components/ui";
import { ChoiceField, FieldGroup, TextField } from "@/components/field";
import { DateField } from "@/components/date-field";
import { useYear } from "@/components/year-provider";
import { client, orpc, queryClient } from "@/lib/orpc";
import { haptic } from "@/lib/haptics";
import { t } from "@/lib/i18n";
import { type, usePalette } from "@/lib/theme";
import {
  isValidYearSetup,
  nativeSchoolYearSuggestion,
  periodNamesForTemplate,
  type PeriodTemplateChoice,
} from "@/lib/year-setup";

/**
 * A second year, a third, a fourth.
 *
 * Defaults follow the most recent year rather than the calendar: someone adding
 * a year in March is almost certainly setting up next September, and copying
 * the scale they already use saves the one setting people get wrong.
 */
export default function NewYear() {
  const palette = usePalette();
  const router = useRouter();
  const { allYears, selectYear } = useYear();

  const suggested = useMemo(
    () => nativeSchoolYearSuggestion(new Date(), allYears),
    [allYears],
  );

  const [name, setName] = useState(suggested.name);
  const [startsAt, setStartsAt] = useState(suggested.startsAt);
  const [endsAt, setEndsAt] = useState(suggested.endsAt);
  const [scale, setScale] = useState(String(suggested.scale));
  const [template, setTemplate] = useState<PeriodTemplateChoice>("trimesters");
  const [presetId, setPresetId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const presets = useQuery(orpc.presets.list.queryOptions());
  const setupKey = useRef(
    `mobile-new-year-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );

  const create = useMutation({
    mutationFn: async () => {
      const numericScale = Number(scale) || 20;
      return client.presets.setupYear({
        idempotencyKey: setupKey.current,
        year: {
          name: name.trim(),
          startsAt,
          endsAt,
          scale: numericScale,
          defaultOutOf: numericScale,
          passingRatio: 0.5,
          decimals: 2,
        },
        presetId,
        periodTemplateId: template,
        periodNames: periodNamesForTemplate(template),
      });
    },
    onSuccess: (year) => {
      haptic("success");
      queryClient.setQueryData(
        orpc.years.list.queryKey(),
        (
          current: Awaited<ReturnType<typeof client.years.list>> | undefined,
        ) => [year, ...(current ?? []).filter((item) => item.id !== year.id)],
      );
      selectYear(year.id);
      router.back();
    },
    onError: () => {
      haptic("error");
      setError(t("The year could not be created."));
    },
  });

  const ready = isValidYearSetup(name, startsAt, endsAt, scale);

  return (
    <>
      <Stack.Screen options={{ title: t("New school year") }} />
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        style={{ flex: 1 }}
      >
        <Screen
          footer={
            <Button
              label={t("Create year")}
              onPress={() => create.mutate()}
              disabled={!ready}
              loading={create.isPending}
            />
          }
        >
          <FieldGroup>
            <TextField
              label={t("Year name")}
              value={name}
              onChangeText={setName}
              autoFocus
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
            <ChoiceField
              label={t("Grades are out of")}
              columns={2}
              value={scale}
              onChange={setScale}
              choices={[
                { value: "20", label: "20" },
                { value: "100", label: "100" },
                { value: "6", label: "6" },
                { value: "4", label: "4" },
              ]}
            />
            <ChoiceField
              label={t("How is your year split?")}
              value={template}
              onChange={setTemplate}
              choices={[
                { value: "trimesters", label: t("Three terms") },
                { value: "semesters", label: t("Two semesters") },
                {
                  value: "semesters-cumulative",
                  label: t("Two semesters, cumulative"),
                },
                { value: "quarters", label: t("Four quarters") },
                { value: "none", label: t("No split") },
              ]}
            />
            <ChoiceField
              label={t("What do you study?")}
              value={presetId ?? "__none__"}
              onChange={(value) =>
                setPresetId(value === "__none__" ? null : value)
              }
              choices={[
                {
                  value: "__none__",
                  label: t("Start from scratch"),
                  hint: t("Add your own subjects"),
                },
                ...(presets.data ?? []).map((preset) => ({
                  value: preset.id,
                  label: preset.name,
                  hint: t("{count} subjects", { count: preset.subjectCount }),
                })),
              ]}
            />
          </FieldGroup>

          {error ? (
            <Text style={[type.footnote, { color: palette.negative }]}>
              {error}
            </Text>
          ) : null}
        </Screen>
      </KeyboardAvoidingView>
    </>
  );
}
