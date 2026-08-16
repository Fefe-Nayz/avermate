import { useCallback, useEffect, useMemo, useState } from "react";
import { Pressable, RefreshControl, StyleSheet, View } from "react-native";
import Animated from "react-native-reanimated";
import { useRouter } from "expo-router";
import { useMutation } from "@tanstack/react-query";
import { Icon } from "@/components/icon";
import { resolveCustomAverage, type Subject } from "@avermate/core";
import {
  Heading,
  Button,
  Card,
  Empty,
  Loading,
  Problem,
  Row,
  Section,
} from "@/components/ui";
import {
  SortableHandle,
  SortableList,
  useSortableScroll,
  type SortableScroll,
} from "@/components/sortable-list";
import { AverageValue, CoefficientTag } from "@/components/value";
import { ScopeBar } from "@/components/scope-bar";
import { useYear } from "@/components/year-provider";
import { client, orpc, queryClient } from "@/lib/orpc";
import { haptic } from "@/lib/haptics";
import { t } from "@/lib/i18n";
import { radius, space, usePalette } from "@/lib/theme";
import { yearSetupHref } from "@/lib/year-setup";

/**
 * The subject tree, flattened for a phone.
 *
 * Indentation carries the hierarchy rather than nested cards: a card inside a
 * card inside a card is unreadable at 375pt, and the useful information — the
 * average and the weight — has to stay on one line to be comparable down the
 * column.
 *
 * The order is the account's own, arranged the way the web does it: a
 * "Reorder" toggle swaps the list for one with grips, and each level of the
 * tree is its own sortable group, because an order is only meaningful among
 * siblings — dropping Maths between two of English's children would be asking
 * to change the hierarchy, which is what the edit screen is for.
 */
export default function Subjects() {
  const palette = usePalette();
  const router = useRouter();
  const { customAverages, isLoading, graph, subjects, yearId, refresh } =
    useYear();
  const scroll = useSortableScroll();
  const [reordering, setReordering] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [orderOverrides, setOrderOverrides] = useState<
    Record<string, string[]>
  >({});
  const [orderError, setOrderError] = useState<string | null>(null);

  // A fresh snapshot is authoritative: the optimistic order has either been
  // written and comes back identical, or it failed and this discards it.
  useEffect(() => setOrderOverrides({}), [subjects]);

  const move = useMutation({
    mutationFn: (input: Parameters<typeof client.subjects.move>[0]) =>
      client.subjects.move(input),
    onSuccess: () => {
      haptic("success");
      if (yearId) {
        void queryClient.invalidateQueries({
          queryKey: orpc.snapshot.get.queryKey({ input: { yearId } }),
        });
        void queryClient.invalidateQueries({
          queryKey: orpc.presets.status.queryKey({ input: { yearId } }),
        });
        void queryClient.invalidateQueries({
          queryKey: orpc.years.configurationStatus.queryKey({
            input: { yearId },
          }),
        });
      }
      // A move detaches the year from its preset, so keep every year-scoped
      // announcement projection honest immediately, the way the web does.
      void queryClient.invalidateQueries({
        queryKey: orpc.announcements.active.key(),
      });
      void queryClient.invalidateQueries({
        queryKey: orpc.announcements.history.key(),
      });
    },
    onError: () => {
      haptic("error");
      setOrderOverrides({});
      setOrderError(t("The subject could not be saved."));
    },
  });

  /** One sibling group, ordered: the server's order, then any optimistic one. */
  const siblingsOf = useCallback(
    (parentId: string | null): readonly Subject[] => {
      const siblings = graph.childrenOf(parentId);
      const override = orderOverrides[parentId ?? ""];
      if (!override) return siblings;
      const byId = new Map(siblings.map((subject) => [subject.id, subject]));
      const known = new Set(override);
      return [
        ...override
          .map((id) => byId.get(id))
          .filter((subject): subject is Subject => Boolean(subject)),
        ...siblings.filter((subject) => !known.has(subject.id)),
      ];
    },
    [graph, orderOverrides],
  );

  const rows = useMemo(
    () => flatten(null, siblingsOf, graph, 0),
    [siblingsOf, graph],
  );
  const averageRows = useMemo(() => {
    // `slice()` rather than `[...customAverages]`: the spread goes through the
    // iterator protocol, so anything that is not a real array fails with
    // "undefined is not a function" pointing at the closing bracket — which is
    // exactly the crash this screen was throwing, and a useless message. The
    // guard turns a value of the wrong shape into an empty list instead of a
    // dead screen.
    const list = Array.isArray(customAverages) ? customAverages.slice() : [];
    list.sort(
      (left, right) =>
        left.sortOrder - right.sortOrder || left.name.localeCompare(right.name),
    );
    return list.map((average) => {
      const resolved = resolveCustomAverage(graph, average);
      return {
        ...average,
        ratio: resolved.graph.ratio(null, resolved.scope),
      };
    });
  }, [customAverages, graph]);

  if (isLoading) return <Loading />;

  /**
   * Subjects are a tree, so a drag can never leave its sibling group; the
   * primitive already guarantees that because each level is its own list.
   * `subjectId` is the subject the server reparents; the rest of the list only
   * gets a new sort order. Since a reorder never changes the parent, passing
   * any sibling would work — but naming the one that actually moved is what
   * makes the request readable in a log.
   */
  const reorderSiblings = (
    parentId: string | null,
    previous: readonly string[],
    siblingIds: string[],
  ) => {
    if (move.isPending) return;
    const subjectId = movedId(previous, siblingIds);
    if (!subjectId) return;
    setOrderError(null);
    setOrderOverrides((current) => ({
      ...current,
      [parentId ?? ""]: siblingIds,
    }));
    move.mutate({ subjectId, parentId, siblingIds });
  };

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
        icon="book-marked"
        title={t("Subjects")}
        action={
          yearId ? (
            <Pressable
              onPress={() => {
                haptic("light");
                router.push("/subject/new");
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
          ) : undefined
        }
      />

      <ScopeBar />

      <Section
        title={t("Averages")}
        action={
          <Pressable
            accessibilityLabel={t("Edit custom averages")}
            accessibilityRole="button"
            hitSlop={10}
            onPress={() => {
              haptic("light");
              router.push("/settings/averages");
            }}
          >
            <Icon name="options-outline" size={18} color={palette.textMuted} />
          </Pressable>
        }
      >
        <Card padded={false}>
          <Row
            first
            title={t("General average")}
            subtitle={t("{count} subjects", { count: graph.subjects.length })}
            leading={
              <Icon
                name="analytics-outline"
                size={19}
                color={palette.textMuted}
              />
            }
            onPress={() => router.push("/average/general")}
            trailing={
              <AverageValue
                ratio={graph.ratio(null)}
                size="heading"
                showScale
                colored
              />
            }
          />
          {averageRows.map((average) => (
            <Row
              key={average.id}
              title={average.name}
              subtitle={
                average.entries.length === 1
                  ? t("1 subject")
                  : t("{count} subjects", {
                      count: average.entries.length,
                    })
              }
              leading={
                <Icon
                  name="calculator-outline"
                  size={18}
                  color={palette.textFaint}
                />
              }
              onPress={() => router.push(`/average/${average.id}`)}
              trailing={
                <AverageValue ratio={average.ratio} size="callout" colored />
              }
            />
          ))}
        </Card>
      </Section>

      {subjects.length > 1 ? (
        <View style={{ flexDirection: "row", justifyContent: "flex-end" }}>
          <Button
            label={reordering ? t("Done") : t("Reorder")}
            icon={reordering ? "checkmark" : "list-outline"}
            variant="ghost"
            size="sm"
            onPress={() => setReordering((current) => !current)}
          />
        </View>
      ) : null}

      {rows.length === 0 ? (
        <Empty
          icon="albums-outline"
          title={t("This year has no subjects yet.")}
          body={t(
            "Continue the year setup to use a preset or add subjects yourself.",
          )}
          action={
            <View style={{ width: "100%", gap: space.sm }}>
              {yearId ? (
                <Button
                  label={t("Continue setup")}
                  onPress={() => router.push(yearSetupHref(yearId))}
                />
              ) : null}
              <Button
                label={t("Add a subject")}
                onPress={() => router.push("/subject/new")}
                variant="secondary"
              />
            </View>
          }
        />
      ) : reordering ? (
        <View style={{ gap: space.sm }}>
          <Card padded={false}>
            <SubjectOrderLevel
              parentId={null}
              depth={0}
              siblingsOf={siblingsOf}
              pending={move.isPending}
              scroll={scroll}
              onDragStateChange={setDragging}
              onReorder={reorderSiblings}
            />
          </Card>
          {orderError ? <Problem>{orderError}</Problem> : null}
        </View>
      ) : (
        <Card padded={false}>
          {rows.map((entry, index) => (
            <Row
              key={entry.subject.id}
              first={index === 0}
              indent={entry.depth}
              title={entry.subject.name}
              muted={entry.subject.kind === "category"}
              subtitle={
                entry.count > 0
                  ? entry.count === 1
                    ? t("1 grade")
                    : t("{count} grades", { count: entry.count })
                  : undefined
              }
              onPress={() => router.push(`/subject/${entry.subject.id}`)}
              trailing={
                <View
                  style={{
                    flexDirection: "row",
                    alignItems: "center",
                    gap: space.sm,
                  }}
                >
                  {entry.subject.kind === "subject" ? (
                    <CoefficientTag coefficient={entry.subject.coefficient} />
                  ) : null}
                  <AverageValue
                    ratio={graph.ratio(entry.subject.id)}
                    size="callout"
                    colored
                  />
                </View>
              }
            />
          ))}
        </Card>
      )}
    </Animated.ScrollView>
  );
}

/**
 * One level of the tree, draggable.
 *
 * Rendered recursively so a subject's children stay inside their own sortable
 * group: dragging within a level reorders it, and there is no way to express
 * "move this under a different parent" by accident. That change belongs to the
 * edit screen, where it is a deliberate choice rather than a slip of the wrist.
 */
function SubjectOrderLevel({
  parentId,
  depth,
  siblingsOf,
  pending,
  scroll,
  onDragStateChange,
  onReorder,
}: {
  parentId: string | null;
  depth: number;
  siblingsOf: (parentId: string | null) => readonly Subject[];
  pending: boolean;
  scroll: SortableScroll;
  onDragStateChange: (dragging: boolean) => void;
  onReorder: (
    parentId: string | null,
    previous: readonly string[],
    siblingIds: string[],
  ) => void;
}) {
  const palette = usePalette();
  const siblings = siblingsOf(parentId);
  if (siblings.length === 0) return null;
  const ids = siblings.map((subject) => subject.id);

  return (
    <SortableList
      ids={ids}
      disabled={pending}
      scroll={scroll}
      onDragStateChange={onDragStateChange}
      onReorder={(next) => onReorder(parentId, ids, next)}
      renderItem={(_id, index) => {
        const subject = siblings[index];
        if (!subject) return null;
        return (
          <>
            <View
              style={{
                flexDirection: "row",
                alignItems: "center",
                // The separator belongs to the row so it travels with it
                // during a drag, like the web's border-b.
                borderTopWidth:
                  depth === 0 && index === 0 ? 0 : StyleSheet.hairlineWidth,
                borderTopColor: palette.hairline,
                // Indentation carries the hierarchy, on the same scale as the
                // resting list.
                paddingLeft: depth * 14,
              }}
            >
              <SortableHandle style={{ marginLeft: space.xs }} />
              <View style={{ flex: 1 }}>
                <Row
                  first
                  title={subject.name}
                  subtitle={
                    subject.parentId ? t("Nested subject") : t("Top level")
                  }
                />
              </View>
            </View>
            <SubjectOrderLevel
              parentId={subject.id}
              depth={depth + 1}
              siblingsOf={siblingsOf}
              pending={pending}
              scroll={scroll}
              onDragStateChange={onDragStateChange}
              onReorder={onReorder}
            />
          </>
        );
      }}
    />
  );
}

interface FlatEntry {
  subject: Subject;
  depth: number;
  count: number;
}

function flatten(
  parentId: string | null,
  siblingsOf: (parentId: string | null) => readonly Subject[],
  graph: { allGrades: (id?: string) => unknown[] },
  depth: number,
): FlatEntry[] {
  return siblingsOf(parentId).flatMap((subject) => [
    { subject, depth, count: graph.allGrades(subject.id).length },
    ...flatten(subject.id, siblingsOf, graph, depth + 1),
  ]);
}

/**
 * The row whose position changed between two orders of the same ids — the
 * dragged one. The primitive hands back only the finished order, so the moved
 * row is recovered from the first point of difference: if the old leader is
 * next in the new order, the old leader was dragged away; otherwise the new
 * leader was dragged in.
 */
function movedId(
  previous: readonly string[],
  next: readonly string[],
): string | null {
  let first = 0;
  while (first < previous.length && previous[first] === next[first]) {
    first += 1;
  }
  if (first >= previous.length) return null;
  return (
    (next[first] === previous[first + 1] ? previous[first] : next[first]) ??
    null
  );
}
