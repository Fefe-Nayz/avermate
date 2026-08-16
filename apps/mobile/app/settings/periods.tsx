import { useEffect, useMemo, useState } from "react";
import { Alert, StyleSheet, View } from "react-native";
import Animated from "react-native-reanimated";
import { Stack, useRouter } from "expo-router";
import { useMutation } from "@tanstack/react-query";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { FULL_YEAR_PERIOD_ID } from "@avermate/core";
import {
  Button,
  Card,
  Empty,
  Note,
  Problem,
  Row,
  Screen,
  Section,
} from "@/components/ui";
import { SwitchField, TextField } from "@/components/field";
import { DateField } from "@/components/date-field";
import { formatDate } from "@/components/format";
import {
  SortableHandle,
  SortableList,
  useSortableScroll,
} from "@/components/sortable-list";
import { useYear } from "@/components/year-provider";
import { client, queryClient } from "@/lib/orpc";
import { haptic } from "@/lib/haptics";
import { t } from "@/lib/i18n";
import { useInteractionPreferences } from "@/lib/interaction-preferences";
import { space, usePalette } from "@/lib/theme";

/**
 * Terms and semesters.
 *
 * Editing happens in place, one period at a time, because the thing people
 * actually come here to do is nudge a date by a week — not redesign the year.
 * The cumulative switch is the one option worth explaining: a cumulative
 * period counts everything since the start of the year, not just its own span.
 *
 * The order is the account's own too — each card carries a grip, exactly like
 * the web's period editor, and dragging persists through the same reorder
 * mutation. The screen brings its own scroll view so the list can drive it
 * near the edges.
 */
export default function Periods() {
  const router = useRouter();
  const palette = usePalette();
  const insets = useSafeAreaInsets();
  const { compactMode } = useInteractionPreferences();
  const { periods, yearId } = useYear();
  const scroll = useSortableScroll();
  const [editing, setEditing] = useState<string | null>(null);
  const [orderedIds, setOrderedIds] = useState<string[] | null>(null);
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const real = useMemo(
    () => periods.filter((period) => period.id !== FULL_YEAR_PERIOD_ID),
    [periods],
  );

  // A fresh snapshot is authoritative: the optimistic order has either been
  // written and comes back identical, or it failed and this discards it.
  useEffect(() => setOrderedIds(null), [periods]);

  const displayed = useMemo(() => {
    if (!orderedIds) return real;
    const byId = new Map(real.map((period) => [period.id, period]));
    const known = new Set(orderedIds);
    return [
      ...orderedIds.flatMap((id) => {
        const period = byId.get(id);
        return period ? [period] : [];
      }),
      ...real.filter((period) => !known.has(period.id)),
    ];
  }, [real, orderedIds]);

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

  const reorder = useMutation({
    mutationFn: (input: Parameters<typeof client.periods.reorder>[0]) =>
      client.periods.reorder(input),
    onSuccess: () => {
      haptic("success");
      void queryClient.invalidateQueries();
    },
    onError: () => {
      haptic("error");
      setOrderedIds(null);
      setError(t("The periods could not be reordered."));
    },
  });

  const reorderPeriods = (periodIds: string[]) => {
    if (reorder.isPending) return;
    setError(null);
    setOrderedIds(periodIds);
    reorder.mutate({ periodIds });
  };

  const addPeriod = () => {
    if (!yearId) return;
    haptic("light");
    const last = displayed.at(-1);
    const startAt = last ? new Date(last.endAt) : new Date();
    const endAt = new Date(startAt);
    endAt.setMonth(endAt.getMonth() + 3);
    create.mutate({
      yearId,
      name: t("Period {number}", { number: displayed.length + 1 }),
      startAt,
      endAt,
      isCumulative: false,
    });
  };

  return (
    <>
      <Stack.Screen options={{ title: t("Periods") }} />
      <Screen
        scroll={false}
        footer={<Button label={t("Add a period")} onPress={addPeriod} />}
      >
        <Animated.ScrollView
          ref={scroll.ref}
          onContentSizeChange={scroll.onContentSizeChange}
          scrollEnabled={!dragging}
          contentInsetAdjustmentBehavior="automatic"
          style={{ flex: 1 }}
          contentContainerStyle={{
            gap: compactMode ? space.md : space.lg,
            paddingBottom: insets.bottom + space.xxxl * 2,
          }}
          showsVerticalScrollIndicator={false}
          keyboardDismissMode="on-drag"
          keyboardShouldPersistTaps="handled"
        >
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
            <SortableList
              ids={displayed.map((period) => period.id)}
              disabled={reorder.isPending}
              gap={compactMode ? space.md : space.lg}
              scroll={scroll}
              onDragStateChange={setDragging}
              onReorder={reorderPeriods}
              renderItem={(_id, index) => {
                const period = displayed[index];
                if (!period) return null;
                return editing === period.id ? (
                  <PeriodEditor
                    period={period}
                    busy={update.isPending}
                    onCancel={() => setEditing(null)}
                    onSave={(patch) =>
                      update.mutate({ periodId: period.id, ...patch })
                    }
                    onDelete={() =>
                      Alert.alert(
                        t("Delete {name}?", { name: period.name }),
                        t(
                          "The grades stay; they just stop belonging to a period.",
                        ),
                        [
                          { text: t("Cancel"), style: "cancel" },
                          {
                            text: t("Delete"),
                            style: "destructive",
                            onPress: () =>
                              remove.mutate({ periodId: period.id }),
                          },
                        ],
                      )
                    }
                  />
                ) : (
                  <Card padded={false}>
                    <View
                      style={{
                        flexDirection: "row",
                        alignItems: "center",
                        // The hairline the plain row drew, kept at full width
                        // so it travels with the card during a drag.
                        borderTopWidth: StyleSheet.hairlineWidth,
                        borderTopColor: palette.hairline,
                      }}
                    >
                      <SortableHandle style={{ marginLeft: space.xs }} />
                      <View style={{ flex: 1 }}>
                        <Row
                          first
                          title={period.name}
                          subtitle={`${formatDate(period.startAt, "short")} → ${formatDate(period.endAt, "short")}`}
                          onPress={() => setEditing(period.id)}
                          trailing={
                            period.isCumulative ? (
                              <Note>{t("Cumulative")}</Note>
                            ) : undefined
                          }
                        />
                      </View>
                    </View>
                  </Card>
                );
              }}
            />
          )}

          {error ? <Problem>{error}</Problem> : null}

          <Section>
            <Card padded={false}>
              <Row
                title={t("Back to the year")}
                onPress={() => router.back()}
              />
            </Card>
          </Section>
        </Animated.ScrollView>
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
