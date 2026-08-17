import { and, asc, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db";
import {
  customAverageEntries,
  customAverages,
  dashboardCards,
  goals,
  gradeComponents,
  grades,
  periods,
  subjects,
} from "../db/schema";
import { protectedProcedure } from "../lib/orpc";
import { requireYear } from "../lib/ownership";

/**
 * One request per year, not one per collection.
 *
 * The client computes every average locally — that is what makes coefficient
 * sliders and "what if" simulations instant — so it needs the whole year
 * anyway. Seven round trips to assemble it was the old design's tax; this is
 * a single query fan-out returning a shape the engine consumes directly.
 */
export const snapshotRouter = {
  get: protectedProcedure
    .input(z.object({ yearId: z.string() }))
    .handler(async ({ context, input }) => {
      const userId = context.session.user.id;
      const year = await requireYear(userId, input.yearId);

      const [
        subjectRows,
        gradeRows,
        componentRows,
        periodRows,
        averageRows,
        entryRows,
        goalRows,
        cardRows,
      ] = await Promise.all([
        db
          .select()
          .from(subjects)
          .where(eq(subjects.yearId, year.id))
          .orderBy(asc(subjects.sortOrder), asc(subjects.name)),
        db
          .select()
          .from(grades)
          .where(eq(grades.yearId, year.id))
          .orderBy(asc(grades.passedAt)),
        db
          .select({
            id: gradeComponents.id,
            gradeId: gradeComponents.gradeId,
            name: gradeComponents.name,
            value: gradeComponents.value,
            outOf: gradeComponents.outOf,
            coefficient: gradeComponents.coefficient,
            sortOrder: gradeComponents.sortOrder,
          })
          .from(gradeComponents)
          .innerJoin(grades, eq(gradeComponents.gradeId, grades.id))
          .where(and(eq(grades.yearId, year.id), eq(grades.userId, userId)))
          .orderBy(asc(gradeComponents.sortOrder)),
        db
          .select({
            id: periods.id,
            name: periods.name,
            startAt: periods.startAt,
            endAt: periods.endAt,
            isCumulative: periods.isCumulative,
            sortOrder: periods.sortOrder,
          })
          .from(periods)
          .where(eq(periods.yearId, year.id))
          .orderBy(asc(periods.sortOrder), asc(periods.startAt)),
        db
          .select()
          .from(customAverages)
          .where(eq(customAverages.yearId, year.id))
          .orderBy(asc(customAverages.sortOrder)),
        db
          .select()
          .from(customAverageEntries)
          .innerJoin(
            customAverages,
            eq(customAverageEntries.averageId, customAverages.id),
          )
          .where(eq(customAverages.yearId, year.id)),
        db
          .select()
          .from(goals)
          .where(eq(goals.yearId, year.id))
          .orderBy(asc(goals.sortOrder)),
        db
          .select({
            id: dashboardCards.id,
            surface: dashboardCards.surface,
            // No `metric` / `targetKind` / `targetId` / `display`: the clients read
            // those off the definition with `cardSemanticsFromDefinition`, and
            // sending a second copy invited one of them to trust the stale half.
            goalId: dashboardCards.goalId,
            span: dashboardCards.span,
            title: dashboardCards.title,
            accent: dashboardCards.accent,
            sortOrder: dashboardCards.sortOrder,
            hidden: dashboardCards.hidden,
            definitionVersion: dashboardCards.definitionVersion,
            definitionJson: dashboardCards.definitionJson,
          })
          .from(dashboardCards)
          .where(eq(dashboardCards.yearId, year.id))
          .orderBy(asc(dashboardCards.sortOrder)),
      ]);

      const componentsByGrade = new Map<string, typeof componentRows>();
      for (const component of componentRows) {
        const list = componentsByGrade.get(component.gradeId);
        if (list) list.push(component);
        else componentsByGrade.set(component.gradeId, [component]);
      }

      const gradesBySubject = new Map<string, typeof gradeRows>();
      for (const grade of gradeRows) {
        const list = gradesBySubject.get(grade.subjectId);
        if (list) list.push(grade);
        else gradesBySubject.set(grade.subjectId, [grade]);
      }

      const entriesByAverage = new Map<
        string,
        Array<{
          subjectId: string;
          coefficient: number | null;
          includeChildren: boolean;
        }>
      >();
      for (const row of entryRows) {
        const entry = row.custom_average_entries;
        const list = entriesByAverage.get(entry.averageId);
        const value = {
          subjectId: entry.subjectId,
          coefficient: entry.coefficient,
          includeChildren: entry.includeChildren,
        };
        if (list) list.push(value);
        else entriesByAverage.set(entry.averageId, [value]);
      }

      return {
        year: {
          id: year.id,
          name: year.name,
          startsAt: year.startsAt,
          endsAt: year.endsAt,
          scale: year.scale,
          defaultOutOf: year.defaultOutOf,
          passingRatio: year.passingRatio,
          decimals: year.decimals,
          sortOrder: year.sortOrder,
          archivedAt: year.archivedAt,
        },
        subjects: subjectRows.map((subject) => ({
          id: subject.id,
          name: subject.name,
          shortName: subject.shortName,
          parentId: subject.parentId,
          coefficient: subject.coefficient,
          kind: subject.kind as "subject" | "category",
          isMain: subject.isMain,
          sortOrder: subject.sortOrder,
          grades: (gradesBySubject.get(subject.id) ?? []).map((grade) => ({
            id: grade.id,
            name: grade.name,
            value: grade.value,
            outOf: grade.outOf,
            coefficient: grade.coefficient,
            isComposite: grade.isComposite,
            note: grade.note,
            passedAt: grade.passedAt,
            createdAt: grade.createdAt,
            subjectId: grade.subjectId,
            periodId: grade.periodId,
            components: (componentsByGrade.get(grade.id) ?? []).map(
              (component) => ({
                id: component.id,
                name: component.name,
                value: component.value,
                outOf: component.outOf,
                coefficient: component.coefficient,
                sortOrder: component.sortOrder,
              }),
            ),
          })),
        })),
        periods: periodRows,
        customAverages: averageRows.map((average) => ({
          id: average.id,
          name: average.name,
          // Historical rows can still carry this bit; it has no product
          // meaning now and must never alter the general average.
          isMain: false,
          sortOrder: average.sortOrder,
          entries: entriesByAverage.get(average.id) ?? [],
        })),
        goals: goalRows.map((goal) => ({
          id: goal.id,
          name: goal.name,
          kind: goal.kind as "general" | "subject" | "custom",
          referenceId: goal.referenceId,
          targetRatio: goal.targetRatio,
          periodId: goal.periodId,
          dueAt: goal.dueAt,
          achievedAt: goal.achievedAt,
          isPinned: goal.isPinned,
          sortOrder: goal.sortOrder,
          createdAt: goal.createdAt,
        })),
        cards: cardRows,
      };
    }),
};
