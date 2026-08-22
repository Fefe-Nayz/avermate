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
  gradeTypes,
  periodGeneralAdjustments,
  periods,
  subjectPeriodAdjustments,
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
        generalAdjustmentRows,
        subjectAdjustmentRows,
        averageRows,
        entryRows,
        goalRows,
        cardRows,
        typeRows,
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
          .select({
            periodId: periodGeneralAdjustments.periodId,
            points: periodGeneralAdjustments.points,
          })
          .from(periodGeneralAdjustments)
          .where(
            and(
              eq(periodGeneralAdjustments.userId, userId),
              eq(periodGeneralAdjustments.yearId, year.id),
            ),
          ),
        db
          .select({
            periodId: subjectPeriodAdjustments.periodId,
            subjectId: subjectPeriodAdjustments.subjectId,
            points: subjectPeriodAdjustments.points,
          })
          .from(subjectPeriodAdjustments)
          .where(
            and(
              eq(subjectPeriodAdjustments.userId, userId),
              eq(subjectPeriodAdjustments.yearId, year.id),
            ),
          ),
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
        db
          .select({
            id: gradeTypes.id,
            name: gradeTypes.name,
            titlePrefix: gradeTypes.titlePrefix,
            coefficient: gradeTypes.coefficient,
            outOf: gradeTypes.outOf,
            accent: gradeTypes.accent,
            sortOrder: gradeTypes.sortOrder,
          })
          .from(gradeTypes)
          .where(eq(gradeTypes.yearId, year.id))
          .orderBy(asc(gradeTypes.sortOrder), asc(gradeTypes.name)),
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

      const generalAdjustmentByPeriod = new Map(
        generalAdjustmentRows.map((row) => [row.periodId, row.points]),
      );
      const subjectAdjustments = new Map<string, Record<string, number>>();
      for (const row of subjectAdjustmentRows) {
        const current = subjectAdjustments.get(row.subjectId) ?? {};
        current[row.periodId] = row.points;
        subjectAdjustments.set(row.subjectId, current);
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
          /**
           * The average this year reads as its general one, and the points added to it.
           *
           * Both belong to the year rather than to the reading, because the client
           * builds one graph for the whole year and hands it the arrangement once — see
           * `SubjectGraphOptions`. A nomination naming an average that no longer exists
           * is simply not found there, and the general average is the whole year again.
           */
          mainAverageId: year.mainAverageId,
          generalBonus: year.generalBonus,
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
          bonus: subject.bonus,
          periodBonuses: subjectAdjustments.get(subject.id) ?? {},
          sortOrder: subject.sortOrder,
          grades: (gradesBySubject.get(subject.id) ?? []).map((grade) => ({
            id: grade.id,
            name: grade.name,
            value: grade.value,
            outOf: grade.outOf,
            coefficient: grade.coefficient,
            excludedFromAverage: grade.excludedFromAverage,
            syncExcludedFromAverage: grade.syncExcludedFromAverage,
            // Extra points on this result's own scale, kept apart from the mark itself.
            bonus: grade.bonus,
            isComposite: grade.isComposite,
            note: grade.note,
            passedAt: grade.passedAt,
            createdAt: grade.createdAt,
            subjectId: grade.subjectId,
            periodId: grade.periodId,
            // The kind of assessment, where the year defines any. `null` on every result
            // written before types existed, and on any whose type was deleted — a result
            // outlives its template.
            typeId: grade.typeId,
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
        periods: periodRows.map((period) => ({
          ...period,
          generalBonus: generalAdjustmentByPeriod.get(period.id) ?? 0,
        })),
        gradeTypes: typeRows,
        customAverages: averageRows.map((average) => ({
          id: average.id,
          name: average.name,
          // Historical rows can still carry this bit; it has no product
          // meaning now and must never alter the general average.
          isMain: false,
          bonus: average.bonus,
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
