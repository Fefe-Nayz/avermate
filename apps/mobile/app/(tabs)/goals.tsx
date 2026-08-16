import { useMemo, useState } from "react";
import {
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from "react-native";
import Animated from "react-native-reanimated";
import { useRouter } from "expo-router";
import { useMutation } from "@tanstack/react-query";
import { Icon } from "@/components/icon";
import {
  Heading,
  Button,
  Card,
  Empty,
  Loading,
  ProgressBar,
} from "@/components/ui";
import {
  SortableHandle,
  SortableList,
  useSortableScroll,
} from "@/components/sortable-list";
import { AverageValue } from "@/components/value";
import { StatusPill } from "@/components/goal-status";
import { ScopeBar } from "@/components/scope-bar";
import { useGoalPlans } from "@/components/use-goal-plans";
import { useYear } from "@/components/year-provider";
import { client, orpc, queryClient } from "@/lib/orpc";
import { haptic } from "@/lib/haptics";
import { t } from "@/lib/i18n";
import { radius, space, type, usePalette } from "@/lib/theme";

/**
 * Goals, each one showing the only two numbers that matter at a glance: where
 * you are and where you said you would be. The plan — what to do about the gap
 * — is one tap deeper, because advice you have already read is clutter.
 *
 * The order is the account's own, arranged the way the web does it: a
 * "Reorder" toggle swaps navigation for grips, cards are dragged into place,
 * and the order persists through the same mutation.
 */
export default function Goals() {
  const palette = usePalette();
  const router = useRouter();
  const { isLoading, refresh, yearId } = useYear();
  const plans = useGoalPlans();
  const scroll = useSortableScroll();
  const [orderedIds, setOrderedIds] = useState<string[] | null>(null);
  const [dragging, setDragging] = useState(false);

  const reorder = useMutation({
    mutationFn: (input: Parameters<typeof client.goals.reorder>[0]) =>
      client.goals.reorder(input),
    onSuccess: () =>
      queryClient.invalidateQueries({
        queryKey: orpc.snapshot.get.queryKey({
          input: { yearId: yearId ?? "" },
        }),
      }),
  });

  const displayedPlans = useMemo(() => {
    if (!orderedIds) return plans;
    const byId = new Map(plans.map((plan) => [plan.goal.id, plan]));
    return orderedIds
      .map((id) => byId.get(id))
      .filter((plan): plan is (typeof plans)[number] => Boolean(plan));
  }, [plans, orderedIds]);

  const reorderGoals = (next: string[]) => {
    if (reorder.isPending) return;
    setOrderedIds(next);
    reorder.mutate({ goalIds: next });
  };

  if (isLoading) return <Loading />;

  const reordering = orderedIds !== null;

  return (
    <Animated.ScrollView
      ref={scroll.ref}
      onContentSizeChange={scroll.onContentSizeChange}
      scrollEnabled={!dragging}
      contentInsetAdjustmentBehavior="never"
      style={{ flex: 1, backgroundColor: palette.background }}
      contentContainerStyle={{
        paddingTop: space.md,
        paddingHorizontal: space.lg,
        paddingBottom: space.xxxl,
        gap: space.lg,
      }}
      showsVerticalScrollIndicator={false}
      refreshControl={
        <RefreshControl
          refreshing={false}
          onRefresh={refresh}
          tintColor={palette.textFaint}
        />
      }
    >
      <Heading
        icon="target"
        title={t("Goals")}
        action={
          <Pressable
            onPress={() => {
              haptic("light");
              router.push("/goal/new");
            }}
            hitSlop={10}
            style={{
              width: 34,
              height: 34,
              borderRadius: radius.pill,
              alignItems: "center",
              justifyContent: "center",
              backgroundColor: palette.accent,
            }}
          >
            <Icon name="add" size={18} color={palette.accentText} />
          </Pressable>
        }
      />

      <ScopeBar />

      {plans.length > 1 ? (
        <View style={{ flexDirection: "row", justifyContent: "flex-end" }}>
          <Button
            label={reordering ? t("Done") : t("Reorder")}
            icon={reordering ? "checkmark" : "list-outline"}
            variant="ghost"
            size="sm"
            onPress={() =>
              setOrderedIds((current) =>
                current ? null : plans.map((plan) => plan.goal.id),
              )
            }
          />
        </View>
      ) : null}

      {plans.length === 0 ? (
        <Empty
          icon="flag-outline"
          title={t("No goals yet")}
          body={t("Set a target and Avermate works out what it takes.")}
          action={
            <Button
              label={t("New goal")}
              onPress={() => router.push("/goal/new")}
              variant="secondary"
            />
          }
        />
      ) : (
        <SortableList
          ids={displayedPlans.map((plan) => plan.goal.id)}
          gap={space.lg}
          disabled={!reordering}
          scroll={scroll}
          onDragStateChange={setDragging}
          onReorder={reorderGoals}
          renderItem={(_id, index) => {
            const plan = displayedPlans[index];
            if (!plan) return null;
            return (
              <>
                <Pressable
                  disabled={reordering}
                  onPress={() => {
                    haptic("selection");
                    router.push(`/goal/${plan.goal.id}`);
                  }}
                >
                  <Card>
                    <View
                      style={{
                        gap: space.md,
                        // Room for the grip, the web's pr-14 while reordering.
                        paddingRight: reordering ? 40 : 0,
                      }}
                    >
                      <View
                        style={{
                          flexDirection: "row",
                          alignItems: "flex-start",
                          gap: space.sm,
                        }}
                      >
                        <Text
                          style={[
                            type.heading,
                            { flex: 1, color: palette.text },
                          ]}
                        >
                          {plan.goal.name}
                        </Text>
                        <StatusPill status={plan.status} />
                      </View>

                      <View
                        style={{
                          flexDirection: "row",
                          alignItems: "flex-end",
                          gap: space.sm,
                        }}
                      >
                        <AverageValue
                          ratio={plan.current}
                          size="display"
                          colored
                        />
                        <Text
                          style={[
                            type.footnote,
                            { color: palette.textFaint, paddingBottom: 6 },
                          ]}
                        >
                          {t("of")}
                        </Text>
                        <View style={{ paddingBottom: 4 }}>
                          <AverageValue ratio={plan.target} size="heading" />
                        </View>
                      </View>

                      <ProgressBar
                        value={
                          plan.current === null || plan.target === 0
                            ? 0
                            : plan.current / plan.target
                        }
                        done={
                          plan.status === "achieved" ||
                          plan.status === "secured"
                        }
                      />
                    </View>
                  </Card>
                </Pressable>
                {reordering ? (
                  <SortableHandle
                    style={{
                      position: "absolute",
                      top: space.md,
                      right: space.md,
                      backgroundColor: palette.background,
                      borderWidth: StyleSheet.hairlineWidth,
                      borderColor: palette.border,
                      borderRadius: radius.md,
                    }}
                  />
                ) : null}
              </>
            );
          }}
        />
      )}
    </Animated.ScrollView>
  );
}
