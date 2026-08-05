import { useMemo, useState } from "react";
import { Stack, useRouter } from "expo-router";
import { useMutation } from "@tanstack/react-query";
import { Spacer } from "@expo/ui";
import { Button, Grouped, Section, Text } from "@/components/native";
import { ChoiceField, DateField, TextField } from "@/components/controls";
import { useYear } from "@/components/year-provider";
import { client, queryClient } from "@/lib/orpc";
import { haptic } from "@/lib/haptics";
import { t } from "@/lib/i18n";
import { space } from "@/lib/theme";

/**
 * A second year, a third, a fourth.
 *
 * Defaults follow the most recent year rather than the calendar: someone adding
 * a year in March is almost certainly setting up next September, and copying
 * the scale they already use saves the one setting people get wrong.
 */
export default function NewYear() {
  const router = useRouter();
  const { years, selectYear, scale: currentScale } = useYear();

  const suggested = useMemo(() => {
    const latest = [...years].sort(
      (a, b) => new Date(b.startsAt).getTime() - new Date(a.startsAt).getTime(),
    )[0];

    if (!latest) {
      const now = new Date();
      const start =
        now.getMonth() >= 7 ? now.getFullYear() : now.getFullYear() - 1;
      return {
        name: `${start} – ${start + 1}`,
        startsAt: new Date(start, 8, 1),
        endsAt: new Date(start + 1, 6, 5),
      };
    }

    const start = new Date(latest.startsAt);
    const end = new Date(latest.endsAt);
    const next = new Date(start);
    next.setFullYear(start.getFullYear() + 1);
    const nextEnd = new Date(end);
    nextEnd.setFullYear(end.getFullYear() + 1);

    return {
      name: `${next.getFullYear()} – ${next.getFullYear() + 1}`,
      startsAt: next,
      endsAt: nextEnd,
    };
  }, [years]);

  const [name, setName] = useState(suggested.name);
  const [startsAt, setStartsAt] = useState(suggested.startsAt);
  const [endsAt, setEndsAt] = useState(suggested.endsAt);
  const [scale, setScale] = useState(String(currentScale));
  const [template, setTemplate] = useState("trimesters");
  const [error, setError] = useState<string | null>(null);

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

      if (template !== "none") {
        await client.presets.applyPeriods({
          yearId: year.id,
          templateId: template,
          names:
            template === "quarters"
              ? [t("Quarter 1"), t("Quarter 2"), t("Quarter 3"), t("Quarter 4")]
              : template === "trimesters"
                ? [t("Term 1"), t("Term 2"), t("Term 3")]
                : [t("Semester 1"), t("Semester 2")],
        });
      }
      return year;
    },
    onSuccess: (year) => {
      haptic("success");
      void queryClient.invalidateQueries();
      selectYear(year.id);
      router.back();
    },
    onError: () => {
      haptic("error");
      setError(t("The year could not be created."));
    },
  });

  const ready = name.trim().length > 0 && endsAt > startsAt;

  return (
    <>
      <Stack.Screen options={{ title: t("New school year") }} />
      <Grouped
        footer={
          <Button
            label={t("Create year")}
            onPress={() => create.mutate()}
            disabled={!ready || create.isPending}
          />
        }
      >
        <Section>
          <TextField
            label={t("Year name")}
            value={name}
            onChangeText={setName}
            autoFocus
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

        <ChoiceField
          title={t("How is your year split?")}
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
