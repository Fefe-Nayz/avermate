"use client";

import { useTimelineModeStore } from "@/stores/timeline-mode-store";
import { endOfDay, format, isValid } from "date-fns";
import {
  type ReadonlyURLSearchParams,
  usePathname,
  useRouter,
  useSearchParams,
} from "next/navigation";
import { startTransition, useCallback, useMemo } from "react";

const TIMELINE_QUERY_PARAM = "timeline";
const TIMELINE_DATE_QUERY_PARAM = "timelineDate";

function getTodayTimelineDate() {
  return format(new Date(), "yyyy-MM-dd");
}

export function isTimelineSupportedPath(pathname: string) {
  return pathname.startsWith("/dashboard") || pathname.startsWith("/profile");
}

export function normalizeTimelineDateValue(
  value?: Date | string | null
): string | null {
  if (!value) {
    return null;
  }

  const parsedDate =
    value instanceof Date
      ? value
      : /^\d{4}-\d{2}-\d{2}$/.test(value)
        ? new Date(`${value}T12:00:00`)
        : new Date(value);

  if (!isValid(parsedDate)) {
    return null;
  }

  return format(parsedDate, "yyyy-MM-dd");
}

export function parseTimelineSnapshotDate(value?: string | null) {
  const normalizedValue = normalizeTimelineDateValue(value);

  if (!normalizedValue) {
    return null;
  }

  return endOfDay(new Date(`${normalizedValue}T12:00:00`));
}

export function buildTimelineHref(
  pathname: string,
  options?: {
    searchParams?: URLSearchParams | ReadonlyURLSearchParams;
    enabled?: boolean;
    hash?: string | null;
  }
) {
  const params = new URLSearchParams(options?.searchParams?.toString());
  const hash = options?.hash ?? "";
  const enabled = options?.enabled ?? true;
  params.delete(TIMELINE_DATE_QUERY_PARAM);

  if (enabled) {
    params.set(TIMELINE_QUERY_PARAM, "1");
  } else {
    params.delete(TIMELINE_QUERY_PARAM);
  }

  const query = params.toString();
  return `${pathname}${query ? `?${query}` : ""}${hash}`;
}

export function useTimelineModeState() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const enabled = useTimelineModeStore((state) => state.enabled);
  const storedSnapshotDate = useTimelineModeStore((state) => state.snapshotDate);
  const hasHydrated = useTimelineModeStore((state) => state.hasHydrated);
  const pendingNavigation = useTimelineModeStore(
    (state) => state.pendingNavigation
  );

  const isSupportedRoute = isTimelineSupportedPath(pathname);
  const urlTimelineEnabled =
    isSupportedRoute && searchParams.get(TIMELINE_QUERY_PARAM) === "1";
  const urlSnapshotDate = normalizeTimelineDateValue(
    searchParams.get(TIMELINE_DATE_QUERY_PARAM)
  );
  const normalizedStoredSnapshotDate =
    normalizeTimelineDateValue(storedSnapshotDate);

  const isActive = useMemo(() => {
    if (!isSupportedRoute) {
      return false;
    }

    if (pendingNavigation === "exit") {
      return false;
    }

    if (urlTimelineEnabled) {
      return true;
    }

    return hasHydrated && enabled;
  }, [
    enabled,
    hasHydrated,
    isSupportedRoute,
    pendingNavigation,
    urlTimelineEnabled,
  ]);

  const snapshotDateValue = useMemo(() => {
    if (!isActive) {
      return null;
    }

    return (
      normalizedStoredSnapshotDate ??
      urlSnapshotDate ??
      getTodayTimelineDate()
    );
  }, [isActive, normalizedStoredSnapshotDate, urlSnapshotDate]);

  return {
    pathname,
    searchParams,
    hasHydrated,
    isSupportedRoute,
    isActive,
    snapshotDateValue,
    snapshotDate: parseTimelineSnapshotDate(snapshotDateValue),
  };
}

export function useTimelineMode() {
  const router = useRouter();
  const activate = useTimelineModeStore((state) => state.activate);
  const deactivate = useTimelineModeStore((state) => state.deactivate);
  const setSnapshotDate = useTimelineModeStore((state) => state.setSnapshotDate);
  const setPendingNavigation = useTimelineModeStore(
    (state) => state.setPendingNavigation
  );

  const { pathname, searchParams, isSupportedRoute, isActive, snapshotDate, snapshotDateValue } =
    useTimelineModeState();

  const enterTimelineMode = useCallback(
    (date?: Date | string | null) => {
      const nextSnapshotDate =
        normalizeTimelineDateValue(date) ??
        snapshotDateValue ??
        getTodayTimelineDate();

      setPendingNavigation("enter");
      activate(nextSnapshotDate);
      router.push(
        buildTimelineHref("/dashboard/grades", {
          enabled: true,
        })
      );
    },
    [activate, router, setPendingNavigation, snapshotDateValue]
  );

  const exitTimelineMode = useCallback(() => {
    deactivate();
    setPendingNavigation("exit");

    if (!isSupportedRoute) {
      return;
    }

    const hash = typeof window !== "undefined" ? window.location.hash : "";

    const nextHref = buildTimelineHref(pathname, {
      enabled: false,
      searchParams,
      hash,
    });

    if (typeof window !== "undefined") {
      window.history.replaceState(window.history.state, "", nextHref);
      return;
    }

    router.replace(nextHref, { scroll: false });
  }, [deactivate, isSupportedRoute, pathname, router, searchParams, setPendingNavigation]);

  const updateTimelineDate = useCallback(
    (date: Date | string) => {
      const nextSnapshotDate = normalizeTimelineDateValue(date);

      if (!nextSnapshotDate) {
        return;
      }

      startTransition(() => {
        setSnapshotDate(nextSnapshotDate);
      });
    },
    [setSnapshotDate]
  );

  const getTimelineHref = useCallback(
    (pathnameToOpen: string) =>
      buildTimelineHref(pathnameToOpen, {
        enabled: true,
      }),
    []
  );

  return {
    isActive,
    snapshotDate,
    snapshotDateValue,
    enterTimelineMode,
    exitTimelineMode,
    updateTimelineDate,
    getTimelineHref,
  };
}
