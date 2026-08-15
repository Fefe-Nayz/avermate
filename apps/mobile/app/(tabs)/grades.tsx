import { useMemo, useState } from "react";
import { Pressable, RefreshControl, ScrollView, View } from "react-native";
import { useRouter } from "expo-router";
import { Icon } from "@/components/icon";
import { gradeRatio, type Grade } from "@avermate/core";
import {
  Button,
  Card,
  ChipRail,
  Empty,
  Heading,
  Label,
  Loading,
  Row,
} from "@/components/ui";
import { PointsValue, ResultBadge } from "@/components/value";
import { ScopeBar } from "@/components/scope-bar";
import { TextField } from "@/components/field";
import { formatDay, formatMonth } from "@/components/date-field";
import { useYear } from "@/components/year-provider";
import { haptic } from "@/lib/haptics";
import { t } from "@/lib/i18n";
import { radius, space, usePalette } from "@/lib/theme";

type SortKey = "date" | "best" | "subject";

/**
 * Every result — newest first, best first, or gathered by subject.
 *
 * Grouped by month rather than paginated: a school year has months, not pages,
 * and "October was rough" is a thing people actually think. The month headers
 * only appear in date order — sorted any other way they would interleave and
 * the labels would lie. Search is plain substring matching over the name and
 * the subject — enough for a list this size, and it never surprises anyone.
 */
export default function Grades() {
  const palette = usePalette();
  const router = useRouter();
  const { isLoading, graph, refresh } = useYear();
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<SortKey>("date");

  const grades = useMemo(() => {
    const needle = query.trim().toLowerCase();
    let matching = graph.allGrades();

    if (needle) {
      matching = matching.filter((grade) =>
        `${grade.name} ${graph.byId(grade.subjectId)?.name ?? ""}`
          .toLowerCase()
          .includes(needle),
      );
    }

    if (sort === "best") {
      return [...matching].sort(
        (a, b) => (gradeRatio(b) ?? -1) - (gradeRatio(a) ?? -1),
      );
    }
    if (sort === "subject") {
      return [...matching].sort((a, b) =>
        (graph.byId(a.subjectId)?.name ?? "").localeCompare(
          graph.byId(b.subjectId)?.name ?? "",
        ),
      );
    }
    return [...matching].sort(
      (a, b) => b.passedAt.getTime() - a.passedAt.getTime(),
    );
  }, [graph, query, sort]);

  const groups = useMemo<
    Array<{ key: string; label: string | null; grades: Grade[] }>
  >(() => {
    if (sort !== "date") return [{ key: "all", label: null, grades }];

    const buckets = new Map<string, Grade[]>();
    for (const grade of grades) {
      const key = `${grade.passedAt.getFullYear()}-${grade.passedAt.getMonth()}`;
      const bucket = buckets.get(key);
      if (bucket) bucket.push(grade);
      else buckets.set(key, [grade]);
    }

    return [...buckets.entries()].map(([key, list]) => ({
      key,
      label: formatMonth(list[0]?.passedAt ?? new Date()),
      grades: list,
    }));
  }, [grades, sort]);

  if (isLoading) return <Loading />;

  const total = graph.allGrades().length;

  return (
    <ScrollView
      contentInsetAdjustmentBehavior="never"
      style={{ flex: 1, backgroundColor: palette.background }}
      contentContainerStyle={{
        paddingTop: space.md,
        paddingHorizontal: space.lg,
        paddingBottom: space.xxxl,
        gap: space.lg,
      }}
      showsVerticalScrollIndicator={false}
      keyboardDismissMode="on-drag"
      refreshControl={
        <RefreshControl
          refreshing={false}
          onRefresh={refresh}
          tintColor={palette.textFaint}
        />
      }
    >
      <Heading
        icon="list-checks"
        title={t("Grades")}
        action={
          <Pressable
            onPress={() => {
              haptic("light");
              router.push("/grade/new");
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

      {total > 6 ? (
        <View style={{ gap: space.md }}>
          <TextField
            label={t("Search")}
            value={query}
            onChangeText={setQuery}
            placeholder={t("Name or subject")}
            autoCapitalize="none"
          />
          <View style={{ gap: space.sm }}>
            <Label>{t("Sort")}</Label>
            <ChipRail
              items={[
                { id: "date", label: t("Most recent") },
                { id: "best", label: t("Best result") },
                { id: "subject", label: t("Subject") },
              ]}
              activeId={sort}
              onSelect={(id) => setSort(id as SortKey)}
            />
          </View>
        </View>
      ) : null}

      {grades.length === 0 ? (
        <Empty
          icon={total === 0 ? "document-text-outline" : "search-outline"}
          title={
            total === 0 ? t("Nothing recorded yet.") : t("No grade matches.")
          }
          body={
            total === 0
              ? t("Add your first grade and the year starts drawing itself.")
              : undefined
          }
          action={
            total === 0 ? (
              <Button
                label={t("Add grade")}
                onPress={() => router.push("/grade/new")}
                variant="secondary"
              />
            ) : null
          }
        />
      ) : (
        groups.map((group) => (
          <View key={group.key} style={{ gap: space.sm }}>
            {group.label ? (
              <View style={{ paddingHorizontal: space.xs }}>
                <Label>{group.label}</Label>
              </View>
            ) : null}
            <Card padded={false}>
              {group.grades.map((grade, index) => {
                const subject = graph.byId(grade.subjectId);
                return (
                  <Row
                    key={grade.id}
                    first={index === 0}
                    title={grade.name}
                    subtitle={`${subject?.name ?? ""} · ${formatDay(grade.passedAt)}`}
                    onPress={() => router.push(`/grade/${grade.id}`)}
                    trailing={
                      <View style={{ alignItems: "flex-end", gap: 2 }}>
                        <ResultBadge ratio={gradeRatio(grade)} />
                        <PointsValue value={grade.value} outOf={grade.outOf} />
                      </View>
                    }
                  />
                );
              })}
            </Card>
          </View>
        ))
      )}
    </ScrollView>
  );
}
