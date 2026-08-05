import { useMemo, useState } from "react";
import { useRouter } from "expo-router";
import type { Grade } from "@avermate/core";
import { gradeRatio } from "@avermate/core";
import {
  Button,
  Empty,
  Grouped,
  Line,
  Loading,
  Row,
  Section,
} from "@/components/native";
import { TextField } from "@/components/controls";
import { PointsValue, ResultBadge } from "@/components/value";
import { ScopeBar } from "@/components/scope-bar";
import { formatDay, formatMonth } from "@/components/format";
import { useYear } from "@/components/year-provider";
import { t } from "@/lib/i18n";
import { space } from "@/lib/theme";

/**
 * Every result, newest first.
 *
 * Grouped by month rather than paginated: a school year has months, not pages,
 * and "October was rough" is a thing people actually think. Search is plain
 * substring matching over the name and the subject — enough for a list this
 * size, and it never surprises anyone.
 */
export default function Grades() {
  const router = useRouter();
  const { isLoading, graph } = useYear();
  const [query, setQuery] = useState("");

  const groups = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const matching = graph.allGrades().filter((grade) => {
      if (!needle) return true;
      const subject = graph.byId(grade.subjectId);
      return (
        grade.name.toLowerCase().includes(needle) ||
        (subject?.name.toLowerCase().includes(needle) ?? false)
      );
    });

    matching.sort((a, b) => b.passedAt.getTime() - a.passedAt.getTime());

    const buckets = new Map<string, { label: string; grades: Grade[] }>();
    for (const grade of matching) {
      const key = `${grade.passedAt.getFullYear()}-${grade.passedAt.getMonth()}`;
      const bucket = buckets.get(key);
      if (bucket) bucket.grades.push(grade);
      else {
        buckets.set(key, {
          label: formatMonth(grade.passedAt),
          grades: [grade],
        });
      }
    }
    return [...buckets.values()];
  }, [graph, query]);

  if (isLoading) return <Loading />;

  const total = graph.allGrades().length;

  return (
    <Grouped
      footer={
        <Button label={t("Add grade")} onPress={() => router.push("/grade/new")} />
      }
    >
      <ScopeBar />

      {total > 6 ? (
        <Section>
          <TextField
            label={t("Search")}
            value={query}
            onChangeText={setQuery}
            placeholder={t("Name or subject")}
            autoCapitalize="none"
          />
        </Section>
      ) : null}

      {groups.length === 0 ? (
        <Section>
          <Empty
            glyph="grade"
            title={total === 0 ? t("Nothing recorded yet.") : t("Nothing matches.")}
            body={
              total === 0
                ? t("Add your first grade and the year starts drawing itself.")
                : undefined
            }
          />
        </Section>
      ) : (
        groups.map((group) => (
          <Section key={group.label} title={group.label}>
            {group.grades.map((grade) => {
              const subject = graph.byId(grade.subjectId);
              return (
                <Line
                  key={grade.id}
                  title={grade.name}
                  detail={`${subject?.name ?? ""} · ${formatDay(grade.passedAt)}`}
                  onPress={() => router.push(`/grade/${grade.id}`)}
                  trailing={
                    <Row spacing={space.sm}>
                      <PointsValue value={grade.value} outOf={grade.outOf} />
                      <ResultBadge ratio={gradeRatio(grade)} />
                    </Row>
                  }
                />
              );
            })}
          </Section>
        ))
      )}
    </Grouped>
  );
}
