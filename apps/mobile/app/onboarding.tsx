import { useMemo, useState } from "react";
import { View } from "react-native";
import { useRouter } from "expo-router";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Column, Spacer } from "@expo/ui";
import {
  Button,
  FromReactNative,
  Grouped,
  Line,
  Section,
  Title,
} from "@/components/native";
import { ChoiceField, DateField, TextField } from "@/components/controls";
import { Wordmark } from "@/components/wordmark";
import { client, orpc, queryClient } from "@/lib/orpc";
import { haptic } from "@/lib/haptics";
import { t } from "@/lib/i18n";
import { radius, space, usePalette } from "@/lib/theme";

/**
 * First run.
 *
 * Three questions, in the order someone can actually answer them: when is your
 * year, how is it cut up, and what do you study. Each one has a defensible
 * default, so the fastest path through is three taps — and everything picked
 * here is editable afterwards, which the subtitle says out loud.
 */

const STEPS = 3;

/** Template period keys → the names a French school actually uses. */
function periodNames(templateId: string): string[] {
  switch (templateId) {
    case "trimesters":
      return [t("Term 1"), t("Term 2"), t("Term 3")];
    case "semesters":
    case "semesters-cumulative":
      return [t("Semester 1"), t("Semester 2")];
    case "quarters":
      return [t("Quarter 1"), t("Quarter 2"), t("Quarter 3"), t("Quarter 4")];
    default:
      return [];
  }
}

/** September to July of the school year today falls in. */
function defaultRange(): { startsAt: Date; endsAt: Date; name: string } {
  const now = new Date();
  const startYear =
    now.getMonth() >= 7 ? now.getFullYear() : now.getFullYear() - 1;
  return {
    startsAt: new Date(startYear, 8, 1),
    endsAt: new Date(startYear + 1, 6, 5),
    name: `${startYear} – ${startYear + 1}`,
  };
}

export default function Onboarding() {
  const router = useRouter();

  const initial = useMemo(defaultRange, []);
  const [step, setStep] = useState(0);
  const [name, setName] = useState(initial.name);
  const [startsAt, setStartsAt] = useState(initial.startsAt);
  const [endsAt, setEndsAt] = useState(initial.endsAt);
  const [scale, setScale] = useState("20");
  const [template, setTemplate] = useState("trimesters");
  const [presetId, setPresetId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const presets = useQuery(orpc.presets.list.queryOptions());

  const create = useMutation({
    mutationFn: async () => {
      const numericScale = Number(scale) || 20;
      const year = await client.years.create({
        name: name.trim(),
        startsAt,
        endsAt,
        scale: numericScale,
        defaultOutOf: numericScale,
        passingRatio: 0.5,
        decimals: 2,
      });

      // Periods before subjects: a grade added straight after onboarding then
      // lands in the right term without anyone choosing one.
      if (template !== "none") {
        await client.presets.applyPeriods({
          yearId: year.id,
          templateId: template,
          names: periodNames(template),
        });
      }
      if (presetId) {
        await client.presets.apply({ yearId: year.id, presetId });
      }
      return year;
    },
    onSuccess: () => {
      haptic("success");
      void queryClient.invalidateQueries();
      router.replace("/(tabs)");
    },
    onError: () => {
      haptic("error");
      setError(t("The year could not be created."));
    },
  });

  const next = () => {
    haptic("light");
    if (step < STEPS - 1) setStep(step + 1);
    else create.mutate();
  };

  const canContinue =
    step !== 0 || (name.trim().length > 0 && endsAt > startsAt);

  return (
    <Grouped
      footer={
        <Column spacing={space.sm}>
          <Button
            label={step === STEPS - 1 ? t("Create year") : t("Continue")}
            onPress={next}
            disabled={!canContinue || create.isPending}
          />
          {step > 0 ? (
            <Button
              label={t("Back")}
              variant="quiet"
              onPress={() => {
                haptic("light");
                setStep(Math.max(0, step - 1));
              }}
            />
          ) : null}
        </Column>
      }
    >
      <Section>
        <Column spacing={space.lg}>
          <FromReactNative height={30}>
            <Wordmark />
          </FromReactNative>
          <FromReactNative height={3}>
            <Dots count={STEPS} active={step} />
          </FromReactNative>
        </Column>
      </Section>

      {step === 0 ? (
        <>
          <Section>
            <Title subtitle={t("You can change all of this later.")}>
              {t("Set up your year")}
            </Title>
          </Section>
          <Section>
            <TextField
              label={t("Year name")}
              value={name}
              onChangeText={setName}
              placeholder={initial.name}
            />
            <DateField label={t("Starts")} value={startsAt} onChange={setStartsAt} />
            <DateField
              label={t("Ends")}
              value={endsAt}
              onChange={setEndsAt}
              min={startsAt}
            />
          </Section>
          <ChoiceField
            title={t("Grades are out of")}
            value={scale}
            onChange={setScale}
            choices={[
              { value: "20", label: "20", hint: t("France") },
              { value: "100", label: "100", hint: t("Percentage") },
              { value: "6", label: "6", hint: t("Germany") },
              { value: "4", label: "4", hint: t("GPA") },
            ]}
          />
        </>
      ) : null}

      {step === 1 ? (
        <>
          <Section>
            <Title
              subtitle={t("Grades will fall into the right one on their own.")}
            >
              {t("How is your year split?")}
            </Title>
          </Section>
          <ChoiceField
            value={template}
            onChange={setTemplate}
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
            ]}
          />
        </>
      ) : null}

      {step === 2 ? (
        <>
          <Section>
            <Title
              subtitle={t(
                "Pick the closest one — you can rename and reweigh everything after.",
              )}
            >
              {t("What do you study?")}
            </Title>
          </Section>
          <ChoiceField
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
        </>
      ) : null}

      {error ? (
        <Section>
          <Line title={error} destructive />
        </Section>
      ) : null}

      <Spacer size={space.xl} />
    </Grouped>
  );
}

function Dots({ count, active }: { count: number; active: number }) {
  const palette = usePalette();
  return (
    <View style={{ flexDirection: "row", gap: space.xs }}>
      {Array.from({ length: count }, (_, index) => (
        <View
          key={index}
          style={{
            height: 3,
            flex: index === active ? 2 : 1,
            borderRadius: radius.pill,
            backgroundColor:
              index <= active ? palette.accent : palette.accentSoft,
          }}
        />
      ))}
    </View>
  );
}
