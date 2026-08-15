import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { useQuery } from "@tanstack/react-query";
import * as SecureStore from "expo-secure-store";
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
import { useSession } from "@/lib/auth-client";
import { t } from "@/lib/i18n";
import { localUserKey } from "@/lib/local-settings";
import { clampTimelineDay, subjectsAtTimelineDay } from "@/lib/timeline";

/**
 * The year in scope, and everything derived from it.
 *
 * Identical in shape to the web provider, and for the same reason: one request
 * brings the whole year down, and every average, impact and goal plan is then
 * computed on the device. That is what makes a slider feel instant, and it
 * means the app keeps working on a train.
 */

interface YearContextValue {
  isLoading: boolean;
  /** Active years shown in everyday pickers. */
  years: Year[];
  /** Includes archived years for the dedicated management screen. */
  allYears: Year[];
  year: Year | null;
  yearId: string | null;
  selectYear: (id: string) => void;

  periods: Period[];
  period: Period;
  selectPeriod: (id: string) => void;

  subjects: Subject[];
  graph: SubjectGraph;
  yearGraph: SubjectGraph;

  /** ISO calendar day used as a global historical cutoff; null means today. */
  timelineDate: string | null;
  setTimelineDate: (value: string | null) => void;

  customAverages: CustomAverage[];
  goals: Goal[];

  resolve: (target: {
    kind: "general" | "subject" | "custom";
    referenceId: string | null;
  }) => {
    graph: SubjectGraph;
    scope: Scope | null;
    subjectId: string | null;
  } | null;

  scale: number;
  decimals: number;
  passingRatio: number;
  now: number;
  refresh: () => void;
}

const YearContext = createContext<YearContextValue | null>(null);

/** SecureStore is async, so a stored choice arrives one render after mount. */
function useStoredChoice(key: string) {
  const [value, setValue] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setValue(null);
    void SecureStore.getItemAsync(key).then((stored) => {
      if (alive && stored) setValue(stored);
    });
    return () => {
      alive = false;
    };
  }, [key]);

  const update = useCallback(
    (next: string | null) => {
      setValue(next);
      if (next === null) void SecureStore.deleteItemAsync(key);
      else void SecureStore.setItemAsync(key, next);
    },
    [key],
  );

  return [value, update] as const;
}

export function YearProvider({ children }: { children: ReactNode }) {
  const session = useSession();
  const [now, setNow] = useState(() => Date.now());
  const storageOwner = session.data?.user.id ?? "anonymous";
  const [storedYearId, setStoredYearId] = useStoredChoice(
    localUserKey(storageOwner, "year"),
  );
  const [storedPeriodId, setStoredPeriodId] = useStoredChoice(
    localUserKey(storageOwner, "period"),
  );

  const yearsQuery = useQuery({
    ...orpc.years.list.queryOptions(),
    // Auth routes share the root layout. Waiting for an authenticated session
    // avoids a guaranteed 401 (and retry) on every cold sign-in screen.
    enabled: Boolean(session.data?.user),
  });
  const allYears = useMemo(
    () => (yearsQuery.data ?? []) as unknown as Year[],
    [yearsQuery.data],
  );
  const years = useMemo(
    () => allYears.filter((item) => !item.archivedAt),
    [allYears],
  );

  // Falling back to the year containing today beats the most recent one: in
  // September the new year exists but the old one is still the freshest row.
  const resolvedYearId = useMemo(() => {
    if (years.length === 0) return null;
    if (storedYearId && years.some((item) => item.id === storedYearId)) {
      return storedYearId;
    }
    const now = Date.now();
    const current = years.find(
      (item) =>
        new Date(item.startsAt).getTime() <= now &&
        new Date(item.endsAt).getTime() >= now,
    );
    return current?.id ?? years[0]?.id ?? null;
  }, [years, storedYearId]);

  const [storedTimelineDate, setStoredTimelineDate] = useStoredChoice(
    localUserKey(storageOwner, `timeline.${resolvedYearId ?? "none"}`),
  );

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(timer);
  }, []);

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
      }
    | undefined;

  const year = snapshot?.year ?? null;
  const timelineDate = useMemo(
    () => clampTimelineDay(storedTimelineDate, year, now),
    [now, storedTimelineDate, year],
  );
  const subjects = useMemo(
    () => subjectsAtTimelineDay(snapshot?.subjects ?? [], timelineDate),
    [snapshot, timelineDate],
  );

  const periods = useMemo(() => {
    const real = snapshot?.periods ?? [];
    if (!year) return real;
    return [...real, fullYearPeriod(year, t("Whole year"))];
  }, [snapshot, year]);

  const period = useMemo(() => {
    if (periods.length === 0) {
      const now = new Date();
      return fullYearPeriod({ startsAt: now, endsAt: now }, t("Whole year"));
    }
    const stored = periods.find((item) => item.id === storedPeriodId);
    if (stored) return stored;

    const now = Date.now();
    const current = periods.find(
      (item) =>
        item.id !== FULL_YEAR_PERIOD_ID &&
        now >= item.startAt.getTime() &&
        now <= item.endAt.getTime(),
    );
    return current ?? (periods.at(-1) as Period);
  }, [periods, storedPeriodId]);

  const yearGraph = useMemo(() => new SubjectGraph(subjects), [subjects]);
  const graph = useMemo(
    () => new SubjectGraph(restrictToPeriod(subjects, period, year)),
    [subjects, period, year],
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
        (item) => item.id === target.referenceId,
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
      allYears,
      year,
      yearId: resolvedYearId,
      selectYear: (id) => {
        setStoredYearId(id);
        setStoredPeriodId(null);
      },
      periods,
      period,
      selectPeriod: setStoredPeriodId,
      subjects,
      graph,
      yearGraph,
      timelineDate,
      setTimelineDate: (value) =>
        setStoredTimelineDate(clampTimelineDay(value, year, now)),
      customAverages,
      goals: snapshot?.goals ?? [],
      resolve,
      scale: year?.scale ?? 20,
      decimals: year?.decimals ?? 2,
      passingRatio: year?.passingRatio ?? 0.5,
      now,
      refresh: () => {
        void snapshotQuery.refetch();
      },
    }),
    [
      yearsQuery.isLoading,
      snapshotQuery,
      years,
      allYears,
      year,
      resolvedYearId,
      setStoredYearId,
      setStoredPeriodId,
      periods,
      period,
      subjects,
      graph,
      yearGraph,
      timelineDate,
      setStoredTimelineDate,
      customAverages,
      snapshot,
      resolve,
      now,
    ],
  );

  return <YearContext.Provider value={value}>{children}</YearContext.Provider>;
}

export function useYear(): YearContextValue {
  const context = useContext(YearContext);
  if (!context) throw new Error("useYear must be used inside a YearProvider");
  return context;
}
