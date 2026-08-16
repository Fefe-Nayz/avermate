import { useEffect, useMemo, useState } from "react";
import { StyleSheet, View } from "react-native";
import Animated from "react-native-reanimated";
import { Stack, useRouter } from "expo-router";
import { useMutation } from "@tanstack/react-query";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { resolveCustomAverage, type CustomAverage } from "@avermate/core";
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
import {
  SortableHandle,
  SortableList,
  useSortableScroll,
} from "@/components/sortable-list";
import { AverageValue } from "@/components/value";
import { useYear } from "@/components/year-provider";
import { client, orpc, queryClient } from "@/lib/orpc";
import { haptic } from "@/lib/haptics";
import { t } from "@/lib/i18n";
import { useInteractionPreferences } from "@/lib/interaction-preferences";
import { space, usePalette } from "@/lib/theme";

/**
 * Custom averages.
 *
 * The escape hatch for every school that does not fit the tree: a "scientific
 * average" that pulls maths, physics and biology out of wherever they sit, or
 * a mock-exam average that weights three subjects the way the real exam does.
 * They are computed from the same graph as everything else, so they inherit
 * period filtering and goal planning for free.
 *
 * Their order is the account's own too — each row carries a grip, exactly
 * like the web list, and dragging persists through the same mutation. The
 * screen brings its own scroll view so the list can drive it near the edges.
 */
export default function Averages() {
  const router = useRouter();
  const palette = usePalette();
  const insets = useSafeAreaInsets();
  const { compactMode } = useInteractionPreferences();
  const { customAverages, graph, yearId } = useYear();
  const scroll = useSortableScroll();
  const [orderedIds, setOrderedIds] = useState<string[] | null>(null);
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // A fresh snapshot is authoritative: the optimistic order has either been
  // written and comes back identical, or it failed and this discards it.
  useEffect(() => setOrderedIds(null), [customAverages]);

  const reorder = useMutation({
    mutationFn: (input: Parameters<typeof client.averages.reorder>[0]) =>
      client.averages.reorder(input),
    onSuccess: () => {
      haptic("success");
      void queryClient.invalidateQueries({
        queryKey: orpc.snapshot.get.queryKey({
          input: { yearId: yearId ?? "" },
        }),
      });
    },
    onError: () => {
      haptic("error");
      setOrderedIds(null);
      setError(t("The averages could not be reordered."));
    },
  });

  const displayed = useMemo(() => {
    if (!orderedIds) return customAverages;
    const byId = new Map(
      customAverages.map((average) => [average.id, average]),
    );
    const known = new Set(orderedIds);
    return [
      ...orderedIds
        .map((id) => byId.get(id))
        .filter((average): average is CustomAverage => Boolean(average)),
      ...customAverages.filter((average) => !known.has(average.id)),
    ];
  }, [customAverages, orderedIds]);

  const reorderAverages = (averageIds: string[]) => {
    if (reorder.isPending) return;
    setError(null);
    setOrderedIds(averageIds);
    reorder.mutate({ averageIds });
  };

  return (
    <>
      <Stack.Screen options={{ title: t("Custom averages") }} />
      <Screen
        scroll={false}
        footer={
          <Button
            label={t("New custom average")}
            onPress={() => router.push("/settings/average-edit")}
          />
        }
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
        >
          {customAverages.length === 0 ? (
            <Section>
              <Empty
                icon="cube-outline"
                title={t("No custom averages yet")}
                body={t(
                  "Pick a handful of subjects and weigh them your own way — useful when the official average is not the one you care about.",
                )}
              />
            </Section>
          ) : (
            <Section title={t("Yours")}>
              <Card padded={false}>
                <SortableList
                  ids={displayed.map((average) => average.id)}
                  disabled={reorder.isPending}
                  scroll={scroll}
                  onDragStateChange={setDragging}
                  onReorder={reorderAverages}
                  renderItem={(_id, index) => {
                    const average = displayed[index];
                    if (!average) return null;
                    const resolved = resolveCustomAverage(graph, average);
                    return (
                      <View
                        style={{
                          flexDirection: "row",
                          alignItems: "center",
                          // The separator belongs to the row so it travels
                          // with it during a drag, like the web's border-t.
                          borderTopWidth:
                            index > 0 ? StyleSheet.hairlineWidth : 0,
                          borderTopColor: palette.hairline,
                        }}
                      >
                        <SortableHandle style={{ marginLeft: space.xs }} />
                        <View style={{ flex: 1 }}>
                          <Row
                            first
                            title={average.name}
                            subtitle={
                              average.entries.length === 1
                                ? t("1 subject")
                                : t("{count} subjects", {
                                    count: average.entries.length,
                                  })
                            }
                            onPress={() =>
                              router.push(
                                `/settings/average-edit?id=${average.id}`,
                              )
                            }
                            trailing={
                              <AverageValue
                                ratio={resolved.graph.ratio(
                                  null,
                                  resolved.scope,
                                )}
                                size="callout"
                                colored
                              />
                            }
                          />
                        </View>
                      </View>
                    );
                  }}
                />
              </Card>
              {error ? <Problem>{error}</Problem> : null}
            </Section>
          )}

          <Section>
            <Note>
              {t(
                "A custom average can be the target of a goal, so this is also how you track something the school does not compute.",
              )}
            </Note>
          </Section>
        </Animated.ScrollView>
      </Screen>
    </>
  );
}
