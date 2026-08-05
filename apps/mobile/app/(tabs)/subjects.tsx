import { useMemo } from "react";
import { useRouter } from "expo-router";
import { Spacer } from "@expo/ui";
import type { Subject, SubjectGraph } from "@avermate/core";
import {
  Button,
  Empty,
  Grouped,
  Line,
  Loading,
  Row,
  Section,
  Text,
} from "@/components/native";
import { AverageValue, CoefficientTag } from "@/components/value";
import { ScopeBar } from "@/components/scope-bar";
import { useYear } from "@/components/year-provider";
import { t } from "@/lib/i18n";
import { space } from "@/lib/theme";

/**
 * The subject tree, flattened for a phone.
 *
 * Indentation carries the hierarchy rather than nested cards: a card inside a
 * card inside a card is unreadable at 375pt, and the useful information — the
 * average and the weight — has to stay on one line to be comparable down the
 * column.
 */
export default function Subjects() {
  const router = useRouter();
  const { isLoading, graph, yearId } = useYear();

  const rows = useMemo(() => flatten(graph, graph.roots, 0), [graph]);

  if (isLoading) return <Loading />;

  return (
    <Grouped
      footer={
        yearId ? (
          <Button
            label={t("Add a subject")}
            onPress={() => router.push("/subject/new")}
          />
        ) : undefined
      }
    >
      <ScopeBar />

      {rows.length === 0 ? (
        <Section>
          <Empty
            glyph="subjects"
            title={t("This year has no subjects yet.")}
            body={t("Add them one by one, or start from a template on the web.")}
          />
        </Section>
      ) : (
        <Section title={t("{count} subjects", { count: rows.length })}>
          {rows.map((entry) => (
            <Line
              key={entry.subject.id}
              title={`${"    ".repeat(entry.depth)}${entry.subject.name}`}
              detail={
                entry.count > 0
                  ? entry.count === 1
                    ? t("1 grade")
                    : t("{count} grades", { count: entry.count })
                  : undefined
              }
              onPress={() => router.push(`/subject/${entry.subject.id}`)}
              trailing={
                <Row spacing={space.sm}>
                  {entry.subject.kind === "subject" ? (
                    <CoefficientTag coefficient={entry.subject.coefficient} />
                  ) : (
                    <Text size="footnote" tone="faint">
                      {t("Category")}
                    </Text>
                  )}
                  <AverageValue
                    ratio={graph.ratio(entry.subject.id)}
                    size="callout"
                    colored
                  />
                </Row>
              }
            />
          ))}
        </Section>
      )}

      <Section>
        <Line
          leading="reorder"
          title={t("Reorder and move")}
          onPress={() => router.push("/subject/arrange")}
        />
      </Section>

      <Spacer size={space.xxl} />
    </Grouped>
  );
}

interface FlatEntry {
  subject: Subject;
  depth: number;
  count: number;
}

function flatten(
  graph: SubjectGraph,
  subjects: readonly Subject[],
  depth: number,
): FlatEntry[] {
  return [...subjects]
    .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name))
    .flatMap((subject) => [
      { subject, depth, count: graph.allGrades(subject.id).length },
      ...flatten(graph, graph.childrenOf(subject.id), depth + 1),
    ]);
}
