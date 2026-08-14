import { useEffect, useMemo, useRef, useState } from "react";
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  View,
} from "react-native";
import { Stack, useRouter } from "expo-router";
import { useMutation, useQuery } from "@tanstack/react-query";
import * as Crypto from "expo-crypto";
import { PresetConfigurationEditor } from "@/components/admin/preset-configuration-editor";
import {
  presetConfigurationProblems,
  type ManagedPresetConfiguration,
} from "@/components/admin/admin-preset-model";
import { DateField } from "@/components/date-field";
import {
  ChoiceField,
  FieldGroup,
  SwitchField,
  TextField,
} from "@/components/field";
import { parseNumber } from "@/components/format";
import { Icon } from "@/components/icon";
import {
  Button,
  Card,
  Empty,
  Loading,
  Note,
  Problem,
  Screen,
  Section,
} from "@/components/ui";
import { useYear } from "@/components/year-provider";
import { haptic } from "@/lib/haptics";
import { t } from "@/lib/i18n";
import { orpc, queryClient } from "@/lib/orpc";
import { space, usePalette } from "@/lib/theme";
import {
  nativeSchoolYearSuggestion,
  periodDraftsForTemplate,
  periodNamesForTemplate,
  validPeriodDrafts,
  type NativePeriodDraft,
  type PeriodTemplateChoice,
} from "@/lib/year-setup";

type TemplateMode = "year" | "builder";
type PeriodMode = PeriodTemplateChoice | "custom";

function blankConfiguration(): ManagedPresetConfiguration {
  return {
    subjects: [
      {
        key: `subject:${Crypto.randomUUID()}`,
        name: t("First subject"),
        kind: "subject",
        isMain: true,
        coefficient: 1,
        children: [],
      },
    ],
    averages: [],
  };
}

function copyConfiguration(
  configuration: ManagedPresetConfiguration,
): ManagedPresetConfiguration {
  return JSON.parse(JSON.stringify(configuration)) as ManagedPresetConfiguration;
}

function shortMonth(date: Date): string {
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    year: "numeric",
  }).format(date);
}

export default function NewClass() {
  const router = useRouter();
  const { years, allYears, year } = useYear();
  const suggestion = useMemo(
    () => nativeSchoolYearSuggestion(new Date(), allYears),
    [allYears],
  );
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [mode, setMode] = useState<TemplateMode>(
    years.length > 0 ? "year" : "builder",
  );
  const [templateYearId, setTemplateYearId] = useState<string | null>(
    year?.id ?? years[0]?.id ?? null,
  );
  const [yearName, setYearName] = useState(suggestion.name);
  const [startsAt, setStartsAt] = useState(suggestion.startsAt);
  const [endsAt, setEndsAt] = useState(suggestion.endsAt);
  const [scale, setScale] = useState(String(suggestion.scale));
  const [passingGrade, setPassingGrade] = useState(
    String(suggestion.scale / 2),
  );
  const [periodMode, setPeriodMode] = useState<PeriodMode>("trimesters");
  const [customPeriods, setCustomPeriods] = useState<NativePeriodDraft[]>([]);
  const customPeriodsStarted = useRef(false);
  const [presetId, setPresetId] = useState<string | null>(null);
  const [appliedPresetId, setAppliedPresetId] = useState<string | null>(null);
  const [configuration, setConfiguration] = useState(blankConfiguration);
  const appliedPresetRef = useRef<string | null>(null);

  useEffect(() => {
    if (!templateYearId && years.length > 0) {
      setTemplateYearId(year?.id ?? years[0]!.id);
    }
  }, [templateYearId, year?.id, years]);

  const presets = useQuery({
    ...orpc.presets.list.queryOptions(),
    enabled: mode === "builder",
  });
  const preset = useQuery({
    ...orpc.presets.get.queryOptions({
      input: { presetId: presetId ?? "" },
    }),
    enabled: mode === "builder" && Boolean(presetId),
  });

  useEffect(() => {
    if (
      !presetId ||
      preset.data?.id !== presetId ||
      appliedPresetRef.current === presetId
    ) {
      return;
    }
    setConfiguration(
      copyConfiguration(
        preset.data.configuration as ManagedPresetConfiguration,
      ),
    );
    appliedPresetRef.current = presetId;
    setAppliedPresetId(presetId);
  }, [preset.data, presetId]);

  const numericScale = parseNumber(scale);
  const numericPassingGrade = parseNumber(passingGrade);
  const configurationValid =
    presetConfigurationProblems(configuration).length === 0;
  const yearValid =
    yearName.trim().length > 0 &&
    endsAt > startsAt &&
    numericScale !== null &&
    numericScale > 0 &&
    numericScale <= 1000 &&
    numericPassingGrade !== null &&
    numericPassingGrade >= 0 &&
    numericPassingGrade <= numericScale;
  const presetReady =
    !presetId ||
    (appliedPresetId === presetId && !preset.isLoading && !preset.isError);
  const periodsValid =
    periodMode !== "custom" ||
    (customPeriods.length <= 12 &&
      validPeriodDrafts(customPeriods, { startsAt, endsAt }));
  const canCreate =
    name.trim().length >= 2 &&
    (mode === "year"
      ? Boolean(templateYearId)
      : yearValid && configurationValid && presetReady && periodsValid);

  const create = useMutation({
    ...orpc.social.groups.create.mutationOptions(),
    onSuccess: async (result) => {
      haptic("success");
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: orpc.social.groups.list.queryKey(),
        }),
        queryClient.invalidateQueries({
          queryKey: orpc.years.list.queryKey(),
        }),
      ]);
      router.replace(`/social/groups/${result.id}`);
    },
  });

  const submit = () => {
    if (!canCreate) return;
    create.mutate({
      name: name.trim(),
      description: description.trim(),
      template:
        mode === "year"
          ? { mode: "year", yearId: templateYearId! }
          : {
              mode: "builder",
              year: {
                name: yearName.trim(),
                startsAt,
                endsAt,
                scale: numericScale!,
                defaultOutOf: numericScale!,
                passingRatio: numericPassingGrade! / numericScale!,
                decimals: 2,
              },
              presetId,
              configuration,
              periods:
                periodMode === "custom"
                  ? {
                      mode: "custom",
                      items: customPeriods.map((period) => ({
                        name: period.name.trim(),
                        startsAt: new Date(period.startsAt),
                        endsAt: new Date(period.endsAt),
                        isCumulative: period.isCumulative,
                      })),
                    }
                  : {
                      mode: "template",
                      templateId: periodMode,
                      names: periodNamesForTemplate(periodMode),
                    },
            },
    });
  };

  return (
    <>
      <Stack.Screen options={{ title: t("New class") }} />
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        style={{ flex: 1 }}
      >
        <Screen
          footer={
            <Button
              label={t("Create class")}
              onPress={submit}
              disabled={!canCreate}
              loading={create.isPending}
            />
          }
        >
          <Section title={t("Class details")}>
            <FieldGroup>
              <TextField
                label={t("Class name")}
                value={name}
                onChangeText={setName}
                maxLength={100}
                autoFocus
              />
              <TextField
                label={t("Description (optional)")}
                value={description}
                onChangeText={setDescription}
                multiline
                maxLength={500}
              />
            </FieldGroup>
          </Section>

          <Section title={t("Class template")}>
            <ChoiceField
              value={mode}
              onChange={setMode}
              choices={[
                {
                  value: "year",
                  label: t("Use an existing year"),
                  hint: t("Keep its subjects, periods and grading scale."),
                  disabled: years.length === 0,
                },
                {
                  value: "builder",
                  label: t("Build a new year"),
                  hint: t("Start from a preset or configure it yourself."),
                },
              ]}
            />
          </Section>

          {mode === "year" ? (
            <Section title={t("School year")}>
              {years.length > 0 ? (
                <>
                  <ChoiceField
                    value={templateYearId}
                    onChange={setTemplateYearId}
                    choices={years.map((item) => ({
                      value: item.id,
                      label: item.name,
                      hint: t("{start} to {end}", {
                        start: shortMonth(new Date(item.startsAt)),
                        end: shortMonth(new Date(item.endsAt)),
                      }),
                    }))}
                  />
                  <Note>
                    {t(
                      "The class uses this structure. Your existing grades stay private and are never copied.",
                    )}
                  </Note>
                </>
              ) : (
                <Empty
                  icon="albums-outline"
                  title={t("No active school years")}
                  body={t("Build a new year for this class instead.")}
                  action={
                    <Button
                      label={t("Build a new year")}
                      variant="secondary"
                      onPress={() => setMode("builder")}
                    />
                  }
                />
              )}
            </Section>
          ) : (
            <>
              <Section title={t("School year")}>
                <FieldGroup>
                  <TextField
                    label={t("Year name")}
                    value={yearName}
                    onChangeText={setYearName}
                    maxLength={64}
                  />
                  <DateField
                    label={t("Starts")}
                    value={startsAt}
                    onChange={setStartsAt}
                    max={endsAt}
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
                    onChange={(value) => {
                      setScale(value);
                      setPassingGrade(String(Number(value) / 2));
                    }}
                    choices={[
                      { value: "20", label: "20", hint: t("France") },
                      { value: "100", label: "100", hint: t("Percentage") },
                      { value: "6", label: "6", hint: t("Germany") },
                      { value: "4", label: "4", hint: t("GPA") },
                    ]}
                  />
                  <TextField
                    label={t("Passing grade")}
                    value={passingGrade}
                    onChangeText={setPassingGrade}
                    keyboardType="decimal-pad"
                    suffix={`/ ${scale}`}
                    error={
                      numericPassingGrade !== null &&
                      numericScale !== null &&
                      numericPassingGrade > numericScale
                        ? t("The passing grade cannot exceed the scale.")
                        : undefined
                    }
                  />
                </FieldGroup>
              </Section>

              <Section title={t("Periods")}>
                <ChoiceField
                  value={periodMode}
                  onChange={(next) => {
                    if (next === "custom" && !customPeriodsStarted.current) {
                      const seed =
                        periodMode === "custom" ? "none" : periodMode;
                      setCustomPeriods(
                        periodDraftsForTemplate(seed, startsAt, endsAt),
                      );
                      customPeriodsStarted.current = true;
                    }
                    setPeriodMode(next);
                  }}
                  choices={[
                    {
                      value: "trimesters",
                      label: t("Three terms"),
                      hint: t("The usual French layout"),
                    },
                    { value: "semesters", label: t("Two semesters") },
                    {
                      value: "semesters-cumulative",
                      label: t("Two semesters, cumulative"),
                      hint: t("The second one includes the first"),
                    },
                    { value: "quarters", label: t("Four quarters") },
                    {
                      value: "none",
                      label: t("No split"),
                      hint: t("One average for the whole year"),
                    },
                    {
                      value: "custom",
                      label: t("Custom periods"),
                      hint: t("Choose every name and date."),
                    },
                  ]}
                />
              </Section>

              {periodMode === "custom" ? (
                <CustomPeriodsEditor
                  periods={customPeriods}
                  yearStartsAt={startsAt}
                  yearEndsAt={endsAt}
                  onChange={setCustomPeriods}
                />
              ) : null}

              <Section title={t("Starting subjects")}>
                {presets.isLoading ? (
                  <Loading />
                ) : presets.isError ? (
                  <Problem>{t("Presets could not be loaded.")}</Problem>
                ) : (
                  <ChoiceField
                    value={presetId ?? "__scratch__"}
                    onChange={(value) => {
                      if (value === "__scratch__") {
                        if (presetId === null) return;
                        setPresetId(null);
                        appliedPresetRef.current = null;
                        setAppliedPresetId(null);
                        setConfiguration(blankConfiguration());
                        return;
                      }
                      if (value === presetId) return;
                      appliedPresetRef.current = null;
                      setAppliedPresetId(null);
                      setPresetId(value);
                    }}
                    choices={[
                      {
                        value: "__scratch__",
                        label: t("Start from scratch"),
                        hint: t("Add your own subjects"),
                      },
                      ...(presets.data ?? []).map((item) => ({
                        value: item.id,
                        label: item.name,
                        hint: t("{count} subjects", {
                          count: item.subjectCount,
                        }),
                      })),
                    ]}
                  />
                )}
                {preset.isLoading && presetId ? <Loading /> : null}
                {preset.isError && presetId ? (
                  <>
                    <Problem>{t("The preset could not be loaded.")}</Problem>
                    <Button
                      label={t("Try again")}
                      variant="secondary"
                      onPress={() => void preset.refetch()}
                    />
                  </>
                ) : null}
              </Section>

              {presetReady ? (
                <View style={{ gap: space.lg }}>
                  <PresetConfigurationEditor
                    key={presetId ?? "scratch"}
                    value={configuration}
                    onChange={setConfiguration}
                    technical={false}
                  />
                </View>
              ) : null}
            </>
          )}

          {mode === "builder" && !yearValid ? (
            <Problem>
              {t("Check the year dates, scale and passing grade.")}
            </Problem>
          ) : null}
          {mode === "builder" && !periodsValid ? (
            <Problem>
              {t("Periods must stay inside the year and cannot overlap.")}
            </Problem>
          ) : null}
          {create.isError ? (
            <Problem>{t("The class could not be created.")}</Problem>
          ) : null}
        </Screen>
      </KeyboardAvoidingView>
    </>
  );
}

function CustomPeriodsEditor({
  periods,
  yearStartsAt,
  yearEndsAt,
  onChange,
}: {
  periods: NativePeriodDraft[];
  yearStartsAt: Date;
  yearEndsAt: Date;
  onChange: (periods: NativePeriodDraft[]) => void;
}) {
  const palette = usePalette();
  const patch = (localId: string, values: Partial<NativePeriodDraft>) =>
    onChange(
      periods.map((period) =>
        period.localId === localId ? { ...period, ...values } : period,
      ),
    );

  const add = () => {
    if (periods.length >= 12) return;
    const previous = periods.at(-1);
    let startsAt = previous ? new Date(previous.endsAt) : yearStartsAt;
    const proposedEnd = new Date(startsAt);
    proposedEnd.setMonth(proposedEnd.getMonth() + 3);
    let existing = periods;
    let endsAt = proposedEnd > yearEndsAt ? yearEndsAt : proposedEnd;

    if (previous && startsAt >= yearEndsAt) {
      const previousStart = new Date(previous.startsAt);
      startsAt = new Date(
        previousStart.getTime() +
          (new Date(previous.endsAt).getTime() - previousStart.getTime()) / 2,
      );
      endsAt = new Date(previous.endsAt);
      existing = periods.map((period) =>
        period.localId === previous.localId
          ? { ...period, endsAt: startsAt.toISOString() }
          : period,
      );
    }

    onChange([
      ...existing,
      {
        localId: `custom-period:${Crypto.randomUUID()}`,
        name: t("Period {number}", { number: periods.length + 1 }),
        startsAt: startsAt.toISOString(),
        endsAt: endsAt.toISOString(),
        isCumulative: false,
      },
    ]);
  };

  return (
    <Section title={t("Custom periods")}>
      <Note>{t("Grades will fall into the right one on their own.")}</Note>
      {periods.length === 0 ? (
        <Empty
          icon="cube-outline"
          title={t("No split")}
          body={t("One average will cover the whole school year.")}
          action={
            <Button
              label={t("Add a period")}
              variant="secondary"
              onPress={add}
            />
          }
        />
      ) : (
        <View style={{ gap: space.lg }}>
          {periods.map((period, index) => (
            <Section
              key={period.localId}
              title={t("Period {number}", { number: index + 1 })}
              action={
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={t("Remove {name}", {
                    name: period.name,
                  })}
                  hitSlop={10}
                  onPress={() =>
                    onChange(
                      periods.filter(
                        (item) => item.localId !== period.localId,
                      ),
                    )
                  }
                >
                  <Icon
                    name="trash-outline"
                    size={19}
                    color={palette.negative}
                  />
                </Pressable>
              }
            >
              <Card style={{ gap: space.md }}>
                <TextField
                  label={t("Name")}
                  value={period.name}
                  onChangeText={(name) => patch(period.localId, { name })}
                  maxLength={64}
                />
                <DateField
                  label={t("Starts")}
                  value={new Date(period.startsAt)}
                  min={yearStartsAt}
                  max={new Date(period.endsAt)}
                  onChange={(date) =>
                    patch(period.localId, { startsAt: date.toISOString() })
                  }
                />
                <DateField
                  label={t("Ends")}
                  value={new Date(period.endsAt)}
                  min={new Date(period.startsAt)}
                  max={yearEndsAt}
                  onChange={(date) =>
                    patch(period.localId, { endsAt: date.toISOString() })
                  }
                />
                <SwitchField
                  label={t("Cumulative")}
                  hint={t(
                    "Counts everything since the start of the year, not just this span.",
                  )}
                  value={period.isCumulative}
                  onValueChange={(isCumulative) =>
                    patch(period.localId, { isCumulative })
                  }
                />
              </Card>
            </Section>
          ))}
          <Button
            label={t("Add another period")}
            icon="add"
            variant="secondary"
            disabled={periods.length >= 12}
            onPress={add}
          />
        </View>
      )}
    </Section>
  );
}
