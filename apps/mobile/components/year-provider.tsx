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
import { t } from "@/lib/i18n";

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
  years: Year[];
  year: Year | null;
  yearId: string | null;
  selectYear: (id: string) => void;

  periods: Period[];
  period: Period;
  selectPeriod: (id: string) => void;

  subjects: Subject[];
  graph: SubjectGraph;
  yearGraph: SubjectGraph;

  customAverages: CustomAverage[];
  goals: Goal[];

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

const YEAR_KEY = "avermate.year";
const PERIOD_KEY = "avermate.period";

/** SecureStore is async, so a stored choice arrives one render after mount. */
function useStoredChoice(key: string) {
  const [value, setValue] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
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
  const [storedYearId, setStoredYearId] = useStoredChoice(YEAR_KEY);
  const [storedPeriodId, setStoredPeriodId] = useStoredChoice(PERIOD_KEY);

  const yearsQuery = useQuery(orpc.years.list.queryOptions());
  const years = useMemo(
    () => (yearsQuery.data ?? []) as unknown as Year[],
    [yearsQuery.data],
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
  const subjects = useMemo(() => snapshot?.subjects ?? [], [snapshot]);

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
      customAverages,
      goals: snapshot?.goals ?? [],
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
      subjects,
      graph,
      yearGraph,
      customAverages,
      snapshot,
      resolve,
    ],
  );

  return <YearContext.Provider value={value}>{children}</YearContext.Provider>;
}

export function useYear(): YearContextValue {
  const context = useContext(YearContext);
  if (!context) throw new Error("useYear must be used inside a YearProvider");
  return context;
}
