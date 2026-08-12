import { useMemo, useState } from "react";
import { Alert, View } from "react-native";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useMutation } from "@tanstack/react-query";
import type { CustomAverageEntry, Subject } from "@avermate/core";
import {
  Button,
  Card,
  Note,
  Problem,
  Row,
  Screen,
  Section,
} from "@/components/ui";
import { SwitchField, TextField } from "@/components/field";
import { parseNumber } from "@/components/format";
import { useYear } from "@/components/year-provider";
import { client, queryClient } from "@/lib/orpc";
import { haptic } from "@/lib/haptics";
import { t } from "@/lib/i18n";

/**
 * Building a custom average.
 *
 * Every subject in the year is listed with a switch, because "which subjects"
 * is the question and a picker would hide the answer. A subject that is in
 * keeps its own coefficient unless you type another one — the common case is
 * "these five, as they are", and it should cost nothing.
 */
export default function AverageEdit() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id?: string }>();
  const { customAverages, yearGraph, yearId } = useYear();

  const existing = customAverages.find((average) => average.id === id);

  const [name, setName] = useState(existing?.name ?? "");
  const [isMain, setIsMain] = useState(existing?.isMain ?? false);
  const [entries, setEntries] = useState<CustomAverageEntry[]>(
    existing?.entries ?? [],
  );
  const [error, setError] = useState<string | null>(null);

  const flat = useMemo(() => {
    const walk = (nodes: readonly Subject[], depth: number): Array<{ subject: Subject; depth: number }> =>
      [...nodes]
        .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name))
        .flatMap((subject) => [
          { subject, depth },
          ...walk(yearGraph.childrenOf(subject.id), depth + 1),
        ]);
    return walk(yearGraph.roots, 0);
  }, [yearGraph]);

  const entryFor = (subjectId: string) =>
    entries.find((entry) => entry.subjectId === subjectId);

  // Subjects swept in by an ancestor's "include nested subjects": their
  // switch must read as on — greyed, because their inclusion is decided by
  // the parent, not here.
  const impliedBy = useMemo(() => {
    const map = new Map<string, string>();
    for (const entry of entries) {
      if (!entry.includeChildren) continue;
      const parent = yearGraph.byId(entry.subjectId);
      if (!parent) continue;
      for (const descendant of yearGraph.descendantsOf(entry.subjectId)) {
        if (!map.has(descendant.id)) map.set(descendant.id, parent.name);
      }
    }
    return map;
  }, [entries, yearGraph]);

  const toggle = (subjectId: string, on: boolean) => {
    haptic("selection");
    setEntries((current) =>
      on
        ? [...current, { subjectId, coefficient: null, includeChildren: false }]
        : current.filter((entry) => entry.subjectId !== subjectId),
    );
  };

  const patchEntry = (subjectId: string, patch: Partial<CustomAverageEntry>) =>
    setEntries((current) =>
      current.map((entry) =>
        entry.subjectId === subjectId ? { ...entry, ...patch } : entry,
      ),
    );

  const save = useMutation({
    mutationFn: async () => {
      const payload = {
        name: name.trim(),
        isMain,
        entries: entries.map((entry) => ({
          subjectId: entry.subjectId,
          coefficient: entry.coefficient,
          includeChildren: entry.includeChildren,
        })),
      };
      return existing
        ? client.averages.update({ averageId: existing.id, ...payload })
        : client.averages.create({ yearId: yearId ?? "", ...payload });
    },
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
    mutationFn: (input: Parameters<typeof client.averages.delete>[0]) =>
      client.averages.delete(input),
    onSuccess: () => {
      haptic("success");
      void queryClient.invalidateQueries();
      router.back();
    },
  });

  const ready = name.trim().length > 0 && entries.length > 0;

  return (
    <>
      <Stack.Screen
        options={{
          title: existing ? t("Edit custom average") : t("New custom average"),
        }}
      />
      <Screen
        footer={
          <Button
            label={t("Save")}
            onPress={() => save.mutate()}
            disabled={!ready || save.isPending}
          />
        }
      >
        <Section>
          <TextField
            label={t("Name")}
            value={name}
            onChangeText={setName}
            placeholder={t("Science average, mock exams…")}
            autoFocus
          />
          <SwitchField
            label={t("Show on the dashboard")}
            value={isMain}
            onValueChange={setIsMain}
          />
        </Section>

        <Section title={t("What goes in")}>
          {flat.map(({ subject, depth }) => {
            const entry = entryFor(subject.id);
            const impliedParent = impliedBy.get(subject.id);
            return (
              <SwitchField
                key={subject.id}
                label={`${"    ".repeat(depth)}${subject.name}`}
                hint={
                  entry
                    ? entry.coefficient === null
                      ? t("Its own weight, ×{value}", {
                          value: subject.coefficient,
                        })
                      : t("Weighted ×{value} here", { value: entry.coefficient })
                    : impliedParent
                      ? t("included with {name}", { name: impliedParent })
                      : undefined
                }
                value={Boolean(entry) || Boolean(impliedParent)}
                disabled={Boolean(impliedParent) && !entry}
                onValueChange={(on) => toggle(subject.id, on)}
              />
            );
          })}
        </Section>

        {entries.length > 0 ? (
          <Section title={t("Fine tuning")}>
            {entries.map((entry) => {
              const subject = yearGraph.byId(entry.subjectId);
              if (!subject) return null;
              return (
                <View key={entry.subjectId} style={{ gap: 12 }}>
                  <TextField
                  key={entry.subjectId}
                  label={subject.name}
                  value={
                    entry.coefficient === null ? "" : String(entry.coefficient)
                  }
                  placeholder={String(subject.coefficient)}
                  onChangeText={(next) =>
                    patchEntry(entry.subjectId, {
                      coefficient: next.trim() === "" ? null : parseNumber(next),
                    })
                  }
                  keyboardType="decimal-pad"
                  />
                  {yearGraph.childrenOf(subject.id).length > 0 ? (
                    <SwitchField
                      label={t("Include nested subjects")}
                      hint={t("Use the results inside this group as well")}
                      value={entry.includeChildren}
                      onValueChange={(includeChildren) =>
                        patchEntry(entry.subjectId, { includeChildren })
                      }
                    />
                  ) : null}
                </View>
              );
            })}
            <Note>{t("Leave one empty to keep the subject's own coefficient.")}</Note>
          </Section>
        ) : null}

        {existing ? (
          <Section>
          <Card padded={false}>
              <Row
                title={t("Delete this average")}
                destructive
                onPress={() =>
                  Alert.alert(
                    t("Delete {name}?", { name: existing.name }),
                    t("The subjects are untouched. This cannot be undone."),
                    [
                      { text: t("Cancel"), style: "cancel" },
                      {
                        text: t("Delete"),
                        style: "destructive",
                        onPress: () =>
                          remove.mutate({ averageId: existing.id }),
                      },
                    ],
                  )
                }
              />
          </Card>
        </Section>
        ) : null}

        {error ? (
          <Section>
            <Problem>{error}</Problem>
          </Section>
        ) : null}
      </Screen>
    </>
  );
}
