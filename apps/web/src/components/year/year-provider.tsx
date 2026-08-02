"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  type ReactNode,
} from "react";
import { useQuery } from "@tanstack/react-query";
import { useExtracted } from "next-intl";
import {
  FULL_YEAR_PERIOD_ID,
  SubjectGraph,
  fullYearPeriod,
  resolveCustomAverage,
  restrictToPeriod,
  type CustomAverage,
  type Goal,
  type Period,
  type Scope,
  type Subject,
  type Year,
} from "@avermate/core";
import { orpc } from "@/lib/orpc";
import { useStickyState } from "@/hooks/use-sticky-state";

/**
 * The year in scope, and everything derived from it.
 *
 * One request brings down the whole year; every average, chart and impact is
 * then computed here, in the browser. That is what lets a coefficient slider
 * update the general average sixty times a second, and it means the app keeps
 * working while the network does not.
 */

export type CardSurface = "overview" | "subject" | "grade";

export interface DashboardCardRow {
  id: string;
  surface: string;
  metric: string;
  targetKind: string;
  targetId: string | null;
  goalId: string | null;
  display: string;
  span: number;
  title: string | null;
  accent: string | null;
  sortOrder: number;
  hidden: boolean;
}

export interface YearContextValue {
  isLoading: boolean;
  /** Years the account owns, newest first. */
  years: Year[];
  year: Year | null;
  yearId: string | null;
  selectYear: (yearId: string) => void;

  /** Real periods plus the implicit "whole year" one, in display order. */
  periods: Period[];
  period: Period;
  periodId: string;
  selectPeriod: (periodId: string) => void;

  subjects: Subject[];
  /** Restricted to the active period. */
  graph: SubjectGraph;
  /** The whole year, still subject to time travel. */
  yearGraph: SubjectGraph;

  /**
   * An ISO day the app is pretending it is. `null` means today. Everything
   * recorded later is hidden, so averages, charts and goals all read as they
   * did back then.
   */
  timelineDate: string | null;
  setTimelineDate: (date: string | null) => void;

  customAverages: CustomAverage[];
  goals: Goal[];
  cards: DashboardCardRow[];

  /** Resolves an average target to the graph and scope that compute it. */
  resolve: (target: {
    kind: "general" | "subject" | "custom";
    referenceId: string | null;
  }) => { graph: SubjectGraph; scope: Scope | null; subjectId: string | null } | null;

  scale: number;
  decimals: number;
  passingRatio: number;
  refresh: () => void;
}

const YearContext = createContext<YearContextValue | null>(null);

const ACTIVE_YEAR_KEY = "avermate:year";
const ACTIVE_PERIOD_KEY = "avermate:period";
const TIMELINE_KEY = "avermate:timeline";

export function YearProvider({ children }: { children: ReactNode }) {
  const t = useExtracted();
  const [storedYearId, setStoredYearId] = useStickyState<string | null>(
    ACTIVE_YEAR_KEY,
    null,
  );
  const [storedPeriodId, setStoredPeriodId] = useStickyState<string | null>(
    ACTIVE_PERIOD_KEY,
    null,
  );
  // Time travel: an ISO day that hides everything recorded after it, so the
  // whole app answers "where was I in November?" without a second code path.
  const [timelineDate, setTimelineDate] = useStickyState<string | null>(
    TIMELINE_KEY,
    null,
  );

  const yearsQuery = useQuery(orpc.years.list.queryOptions());
  const years = useMemo(
    () => (yearsQuery.data ?? []) as unknown as Year[],
    [yearsQuery.data],
  );

  // Falling back to the year that contains today beats falling back to the
  // most recent one: in September the new year exists but the old one is still
  // the freshest thing in the list.
  const resolvedYearId = useMemo(() => {
    if (years.length === 0) return null;
    if (storedYearId && years.some((year) => year.id === storedYearId)) {
      return storedYearId;
    }
    const now = Date.now();
    const current = years.find(
      (year) =>
        new Date(year.startsAt).getTime() <= now &&
        new Date(year.endsAt).getTime() >= now,
    );
    return current?.id ?? years[0]?.id ?? null;
  }, [years, storedYearId]);

  const snapshotQuery = useQuery({
    ...orpc.snapshot.get.queryOptions({
      input: { yearId: resolvedYearId ?? "" },
    }),
    enabled: Boolean(resolvedYearId),
  });

  const snapshot = snapshotQuery.data as
    | {
        year: Year;
        subjects: Subject[];
        periods: Period[];
        customAverages: CustomAverage[];
        goals: Goal[];
        cards: DashboardCardRow[];
      }
    | undefined;

  const year = snapshot?.year ?? null;
  const subjects = useMemo(() => snapshot?.subjects ?? [], [snapshot]);

  const periods = useMemo(() => {
    const real = snapshot?.periods ?? [];
    if (!year) return real;
    return [...real, fullYearPeriod(year, t("Whole year"))];
  }, [snapshot, year, t]);

  const period = useMemo(() => {
    if (periods.length === 0) {
      const now = new Date();
      return fullYearPeriod(
        { startsAt: now, endsAt: now },
        t("Whole year"),
      );
    }
    const stored = periods.find((item) => item.id === storedPeriodId);
    if (stored) return stored;

    // Default to whichever period today falls into — the one whose average the
    // user is actually living in.
    const now = Date.now();
    const current = periods.find(
      (item) =>
        item.id !== FULL_YEAR_PERIOD_ID &&
        now >= item.startAt.getTime() &&
        now <= item.endAt.getTime(),
    );
    return current ?? (periods.at(-1) as Period);
  }, [periods, storedPeriodId, t]);

  const visibleSubjects = useMemo(() => {
    if (!timelineDate) return subjects;
    const cutoff = new Date(`${timelineDate}T23:59:59`).getTime();
    return subjects.map((subject) => ({
      ...subject,
      grades: subject.grades.filter(
        (grade) => grade.passedAt.getTime() <= cutoff,
      ),
    }));
  }, [subjects, timelineDate]);

  const yearGraph = useMemo(
    () => new SubjectGraph(visibleSubjects),
    [visibleSubjects],
  );

  const graph = useMemo(
    () => new SubjectGraph(restrictToPeriod(visibleSubjects, period, year)),
    [visibleSubjects, period, year],
  );

  const customAverages = useMemo(
    () => snapshot?.customAverages ?? [],
    [snapshot],
  );

  const resolve = useCallback<YearContextValue["resolve"]>(
    (target) => {
      if (target.kind === "general") {
        return { graph, scope: null, subjectId: null };
      }
      if (target.kind === "subject") {
        if (!target.referenceId || !graph.has(target.referenceId)) return null;
        return { graph, scope: null, subjectId: target.referenceId };
      }
      const custom = customAverages.find(
        (average) => average.id === target.referenceId,
      );
      if (!custom) return null;
      const resolved = resolveCustomAverage(graph, custom);
      return { graph: resolved.graph, scope: resolved.scope, subjectId: null };
    },
    [graph, customAverages],
  );

  const value = useMemo<YearContextValue>(
    () => ({
      isLoading: yearsQuery.isLoading || snapshotQuery.isLoading,
      years,
      year,
      yearId: resolvedYearId,
      selectYear: (id: string) => {
        setStoredYearId(id);
        setStoredPeriodId(null);
      },
      periods,
      period,
      periodId: period.id,
      selectPeriod: setStoredPeriodId,
      subjects: visibleSubjects,
      graph,
      yearGraph,
      timelineDate,
      setTimelineDate,
      customAverages,
      goals: snapshot?.goals ?? [],
      cards: snapshot?.cards ?? [],
      resolve,
      scale: year?.scale ?? 20,
      decimals: year?.decimals ?? 2,
      passingRatio: year?.passingRatio ?? 0.5,
      refresh: () => {
        void snapshotQuery.refetch();
      },
    }),
    [
      yearsQuery.isLoading,
      snapshotQuery,
      years,
      year,
      resolvedYearId,
      setStoredYearId,
      setStoredPeriodId,
      periods,
      period,
      visibleSubjects,
      graph,
      yearGraph,
      timelineDate,
      setTimelineDate,
      customAverages,
      snapshot,
      resolve,
    ],
  );

  return <YearContext.Provider value={value}>{children}</YearContext.Provider>;
}

export function useYear(): YearContextValue {
  const context = useContext(YearContext);
  if (!context) {
    throw new Error("useYear must be used inside a YearProvider");
  }
  return context;
}

/** Optional variant for components that also render outside the app shell. */
export function useMaybeYear(): YearContextValue | null {
  return useContext(YearContext);
}
