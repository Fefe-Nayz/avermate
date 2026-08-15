import { useMemo, useState } from "react";
import { Alert } from "react-native";
import { Stack, useRouter } from "expo-router";
import { useMutation } from "@tanstack/react-query";
import { FULL_YEAR_PERIOD_ID } from "@avermate/core";
import {
  Button,
  Card,
  Empty,
  Note,
  Row,
  Screen,
  Section,
} from "@/components/ui";
import { SwitchField, TextField } from "@/components/field";
import { DateField } from "@/components/date-field";
import { formatDate } from "@/components/format";
import { useYear } from "@/components/year-provider";
import { client, queryClient } from "@/lib/orpc";
import { haptic } from "@/lib/haptics";
import { t } from "@/lib/i18n";

/**
 * Terms and semesters.
 *
 * Editing happens in place, one period at a time, because the thing people
 * actually come here to do is nudge a date by a week — not redesign the year.
 * The cumulative switch is the one option worth explaining: a cumulative
 * period counts everything since the start of the year, not just its own span.
 */
export default function Periods() {
  const router = useRouter();
  const { periods, yearId } = useYear();
  const [editing, setEditing] = useState<string | null>(null);

  const real = useMemo(
    () => periods.filter((period) => period.id !== FULL_YEAR_PERIOD_ID),
    [periods],
  );

  const update = useMutation({
    mutationFn: (input: Parameters<typeof client.periods.update>[0]) =>
      client.periods.update(input),
    onSuccess: () => {
      haptic("success");
      void queryClient.invalidateQueries();
      setEditing(null);
    },
  });

  const create = useMutation({
    mutationFn: (input: Parameters<typeof client.periods.create>[0]) =>
      client.periods.create(input),
    onSuccess: () => {
      haptic("success");
      void queryClient.invalidateQueries();
    },
  });

  const remove = useMutation({
    mutationFn: (input: Parameters<typeof client.periods.delete>[0]) =>
      client.periods.delete(input),
    onSuccess: () => {
      haptic("success");
      void queryClient.invalidateQueries();
      setEditing(null);
    },
  });

  const addPeriod = () => {
    if (!yearId) return;
    haptic("light");
    const last = real.at(-1);
    const startAt = last ? new Date(last.endAt) : new Date();
    const endAt = new Date(startAt);
    endAt.setMonth(endAt.getMonth() + 3);
    create.mutate({
      yearId,
      name: t("Period {number}", { number: real.length + 1 }),
      startAt,
      endAt,
      isCumulative: false,
    });
  };

  return (
    <>
      <Stack.Screen options={{ title: t("Periods") }} />
      <Screen footer={<Button label={t("Add a period")} onPress={addPeriod} />}>
        {real.length === 0 ? (
          <Section>
            <Empty
              icon="cube-outline"
              title={t("No split")}
              body={t(
                "One average for the whole year. Add a period to change that.",
              )}
            />
          </Section>
        ) : (
          real.map((period) =>
            editing === period.id ? (
              <PeriodEditor
                key={period.id}
                period={period}
                busy={update.isPending}
                onCancel={() => setEditing(null)}
                onSave={(patch) =>
                  update.mutate({ periodId: period.id, ...patch })
                }
                onDelete={() =>
                  Alert.alert(
                    t("Delete {name}?", { name: period.name }),
                    t("The grades stay; they just stop belonging to a period."),
                    [
                      { text: t("Cancel"), style: "cancel" },
                      {
                        text: t("Delete"),
                        style: "destructive",
                        onPress: () => remove.mutate({ periodId: period.id }),
                      },
                    ],
                  )
                }
              />
            ) : (
              <Section key={period.id}>
                <Card padded={false}>
                  <Row
                    title={period.name}
                    subtitle={`${formatDate(period.startAt, "short")} → ${formatDate(period.endAt, "short")}`}
                    onPress={() => setEditing(period.id)}
                    trailing={
                      period.isCumulative ? (
                        <Note>{t("Cumulative")}</Note>
                      ) : undefined
                    }
                  />
                </Card>
              </Section>
            ),
          )
        )}

        <Section>
          <Card padded={false}>
            <Row title={t("Back to the year")} onPress={() => router.back()} />
          </Card>
        </Section>
      </Screen>
    </>
  );
}

function PeriodEditor({
  period,
  busy,
  onSave,
  onCancel,
  onDelete,
}: {
  period: {
    id: string;
    name: string;
    startAt: Date;
    endAt: Date;
    isCumulative: boolean;
  };
  busy: boolean;
  onSave: (patch: {
    name: string;
    startAt: Date;
    endAt: Date;
    isCumulative: boolean;
  }) => void;
  onCancel: () => void;
  onDelete: () => void;
}) {
  const [name, setName] = useState(period.name);
  const [startAt, setStartAt] = useState(new Date(period.startAt));
  const [endAt, setEndAt] = useState(new Date(period.endAt));
  const [cumulative, setCumulative] = useState(period.isCumulative);

  return (
    <Section title={t("Editing")}>
      <Card padded={false}>
        <TextField
          label={t("Name")}
          value={name}
          onChangeText={setName}
          autoFocus
        />
        <DateField label={t("Starts")} value={startAt} onChange={setStartAt} />
        <DateField
          label={t("Ends")}
          value={endAt}
          onChange={setEndAt}
          min={startAt}
        />
        <SwitchField
          label={t("Cumulative")}
          hint={t(
            "Counts everything since the start of the year, not just this span.",
          )}
          value={cumulative}
          onValueChange={setCumulative}
        />
        <Row
          title={busy ? t("Saving…") : t("Save")}
          onPress={() =>
            onSave({
              name: name.trim(),
              startAt,
              endAt,
              isCumulative: cumulative,
            })
          }
        />
        <Row leading="close" title={t("Cancel")} onPress={onCancel} />
        <Row title={t("Delete this period")} destructive onPress={onDelete} />
      </Card>
    </Section>
  );
}
