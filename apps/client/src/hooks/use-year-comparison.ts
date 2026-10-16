"use client";

import { useCallback, useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "@/lib/api";
import { authClient } from "@/lib/auth";
import { queryKeys } from "@/lib/query-keys";
import { useActiveYearStore } from "@/stores/active-year-store";
import { defaultYearComparisonPreference, useYearComparisonStore, yearComparisonPreferenceKey } from "@/stores/year-comparison-store";
import type { GetSubjectsResponse } from "@/types/get-subjects-response";
import type { GetPeriodsResponse } from "@/types/get-periods-response";
import type { Subject } from "@/types/subject";
import type { YearComparison, YearComparisonMappings, YearComparisonScope, YearComparisonSeriesPoint } from "@/types/year-comparison";
import { createYearComparison, sanitizeComparisonMap, suggestPeriodMap, suggestSubjectMap } from "@/utils/year-comparison";
import { useTimelineModeState } from "./use-timeline-mode";
import { useYears } from "./use-years";

type ComparisonResponse = { comparison: YearComparison | null };
const comparisonKey = (userId: string, yearId: string, referenceYearId: string) =>
  ["year-comparison", userId, yearId, referenceYearId] as const;

/** Reads raw query data: the timeline's absolute date must never filter another year. */
function useRawSubjects(yearId: string, enabled: boolean) {
  return useQuery({
    queryKey: queryKeys.subjects.all(yearId),
    queryFn: async () => (await apiClient.get(`years/${yearId}/subjects`).json<GetSubjectsResponse>()).subjects,
    enabled: enabled && !!yearId && yearId !== "none",
  });
}

function useRawPeriods(yearId: string, enabled: boolean) {
  return useQuery({
    queryKey: queryKeys.periods.all(yearId),
    queryFn: async () => (await apiClient.get(`years/${yearId}/periods`).json<GetPeriodsResponse>()).periods,
    enabled: enabled && !!yearId && yearId !== "none",
  });
}

export function useYearComparisonSettings(referenceYearIdOverride?: string, options?: { enabled?: boolean }) {
  const queryClient = useQueryClient();
  const activeId = useActiveYearStore((state) => state.activeId);
  const { data: session } = authClient.useSession();
  const userId = session?.user.id ?? "";
  const preferenceKey = yearComparisonPreferenceKey(userId, activeId);
  const preference = useYearComparisonStore((state) => state.preferences[preferenceKey] ?? defaultYearComparisonPreference);
  const hasHydrated = useYearComparisonStore((state) => state.hasHydrated);
  const updatePreference = useYearComparisonStore((state) => state.updatePreference);
  const yearsQuery = useYears();
  const years = yearsQuery.data ?? [];
  const currentYear = years.find((year) => year.id === activeId);
  const requestedReferenceId = referenceYearIdOverride ?? preference.referenceYearId;
  const referenceYear = years.find((year) => year.id === requestedReferenceId && year.id !== activeId);
  const referenceYearId = referenceYear?.id ?? "";
  const dataEnabled = !!userId && (hasHydrated && preference.enabled || referenceYearIdOverride !== undefined || options?.enabled === true);
  const sourceSubjectsQuery = useRawSubjects(activeId, dataEnabled);
  const referenceSubjectsQuery = useRawSubjects(referenceYearId, dataEnabled);
  const sourcePeriodsQuery = useRawPeriods(activeId, dataEnabled);
  const referencePeriodsQuery = useRawPeriods(referenceYearId, dataEnabled);
  const pairEnabled = dataEnabled && !!currentYear && !!referenceYear;
  const pairQuery = useQuery({
    queryKey: comparisonKey(userId, activeId, referenceYearId),
    queryFn: async () => (await apiClient.get(`comparisons/${activeId}/${referenceYearId}`).json<ComparisonResponse>()).comparison,
    enabled: pairEnabled,
    staleTime: 60_000,
  });

  const sourceSubjects = useMemo(() => sourceSubjectsQuery.data ?? [], [sourceSubjectsQuery.data]);
  const referenceSubjects = useMemo(() => referenceSubjectsQuery.data ?? [], [referenceSubjectsQuery.data]);
  const sourcePeriods = useMemo(() => sourcePeriodsQuery.data ?? [], [sourcePeriodsQuery.data]);
  const referencePeriods = useMemo(() => referencePeriodsQuery.data ?? [], [referencePeriodsQuery.data]);
  const subjectMap = useMemo(() => pairQuery.data
    ? sanitizeComparisonMap(pairQuery.data.subjectMap, sourceSubjects, referenceSubjects)
    : suggestSubjectMap(sourceSubjects, referenceSubjects),
    [pairQuery.data, sourceSubjects, referenceSubjects]);
  const periodMap = useMemo(() => pairQuery.data
    ? sanitizeComparisonMap(pairQuery.data.periodMap, sourcePeriods, referencePeriods)
    : suggestPeriodMap(sourcePeriods, referencePeriods),
    [pairQuery.data, sourcePeriods, referencePeriods]);

  const saveMutation = useMutation({
    mutationFn: async (input: { userId: string; yearId: string; referenceYearId: string; mappings: YearComparisonMappings }) => {
      const result = await apiClient.put(`comparisons/${input.yearId}/${input.referenceYearId}`, {
        json: input.mappings,
      }).json<ComparisonResponse>();
      if (!result.comparison) throw new Error("The comparison was not saved.");
      return result.comparison;
    },
    onSuccess: (comparison, input) => {
      queryClient.setQueryData(comparisonKey(input.userId, input.yearId, input.referenceYearId), comparison);
    },
  });

  const saveMappings = useCallback(async (mappings: YearComparisonMappings) => {
    if (!userId || !currentYear || !referenceYear) throw new Error("Choose two different years before saving.");
    return saveMutation.mutateAsync({ userId, yearId: currentYear.id, referenceYearId: referenceYear.id,
      mappings: {
        subjectMap: sanitizeComparisonMap(mappings.subjectMap, sourceSubjects, referenceSubjects),
        periodMap: sanitizeComparisonMap(mappings.periodMap, sourcePeriods, referencePeriods),
      },
    });
  }, [userId, currentYear, referenceYear, saveMutation.mutateAsync, sourceSubjects, referenceSubjects, sourcePeriods, referencePeriods]);
  const setReferenceYear = useCallback((id: string | null) => {
    updatePreference(userId, activeId, { referenceYearId: id === activeId ? null : id });
  }, [updatePreference, userId, activeId]);
  const setEnabled = useCallback((enabled: boolean) => {
    updatePreference(userId, activeId, { enabled });
  }, [updatePreference, userId, activeId]);
  const setScope = useCallback((scope: YearComparisonScope) => {
    updatePreference(userId, activeId, { scope });
  }, [updatePreference, userId, activeId]);

  const loading = yearsQuery.isPending || (dataEnabled && (sourceSubjectsQuery.isPending || sourcePeriodsQuery.isPending))
    || (pairEnabled && (pairQuery.isPending || referenceSubjectsQuery.isPending || referencePeriodsQuery.isPending));
  const error = yearsQuery.error ?? (dataEnabled ? sourceSubjectsQuery.error ?? sourcePeriodsQuery.error : null)
    ?? (pairEnabled ? pairQuery.error ?? referenceSubjectsQuery.error ?? referencePeriodsQuery.error : null);

  return {
    activeId, userId, years, currentYear, referenceYear, referenceYearId,
    sourceSubjects, referenceSubjects, sourcePeriods, referencePeriods,
    subjectMap, periodMap, savedComparison: pairQuery.data ?? null,
    loading, error, hasHydrated,
    enabled: hasHydrated && preference.enabled && !!userId,
    scope: preference.scope,
    setReferenceYear, setEnabled, setScope,
    saveMappings, isSaving: saveMutation.isPending, saveError: saveMutation.error,
  };
}

/** Shared calculation contract for cards, tables and charts. All scores are out of 20. */
export function useYearComparison(periodId?: string, subjectId?: string) {
  const settings = useYearComparisonSettings();
  const timeline = useTimelineModeState();
  const snapshotDateValue = timeline.isActive ? timeline.snapshotDateValue : null;
  const { currentYear, referenceYear, sourcePeriods, referencePeriods, referenceSubjects, subjectMap, periodMap, scope } = settings;
  const model = useMemo(() => currentYear && referenceYear ? createYearComparison({
    currentYear, referenceYear, sourcePeriods, referencePeriods, referenceSubjects,
    subjectMap, periodMap, periodId, scope, snapshotDate: snapshotDateValue ?? undefined,
  }) : null, [currentYear, referenceYear, sourcePeriods, referencePeriods, referenceSubjects,
    subjectMap, periodMap, periodId, scope, snapshotDateValue]);
  const active = settings.enabled && !!referenceYear;
  // Suggestions are a setup aid. Only explicitly saved mappings drive a live comparison.
  const ready = active && !settings.loading && !settings.error && !!settings.savedComparison && !!model?.ready;
  const getReferenceAverage = useCallback((requestedSubjectId?: string) =>
    ready ? model!.getReferenceAverage(requestedSubjectId ?? subjectId) : null,
  [ready, model, subjectId]);
  const getReferenceSeries = useCallback((dates: string[], requestedSubjectId?: string): YearComparisonSeriesPoint[] =>
    ready ? model!.getReferenceSeries(dates, requestedSubjectId ?? subjectId)
      : dates.map((date) => ({ date, referenceDate: "", value: null })),
  [ready, model, subjectId]);
  const scopeCurrentSubjects = useCallback((subjects: Subject[]) =>
    ready ? model!.scopeCurrentSubjects(subjects) : subjects,
  [ready, model]);

  return {
    ...settings, active, enabled: active, ready,
    referencePeriod: model?.referencePeriod,
    referenceSubjects: model?.referenceSubjects ?? [],
    referenceCutoffDate: model?.referenceCutoff || null,
    sourceCutoffDate: model?.sourceCutoff || null,
    getReferenceAverage, getReferenceSeries, scopeCurrentSubjects,
  };
}
