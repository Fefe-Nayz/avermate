"use client";

import {
  buildTimelineHref,
  isTimelineSupportedPath,
  normalizeTimelineDateValue,
} from "@/hooks/use-timeline-mode";
import { useTimelineModeStore } from "@/stores/timeline-mode-store";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect } from "react";

const TIMELINE_QUERY_PARAM = "timeline";
const TIMELINE_DATE_QUERY_PARAM = "timelineDate";

export default function TimelineModeSync() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const enabled = useTimelineModeStore((state) => state.enabled);
  const snapshotDate = useTimelineModeStore((state) => state.snapshotDate);
  const hasHydrated = useTimelineModeStore((state) => state.hasHydrated);
  const pendingNavigation = useTimelineModeStore(
    (state) => state.pendingNavigation
  );
  const activate = useTimelineModeStore((state) => state.activate);
  const setPendingNavigation = useTimelineModeStore(
    (state) => state.setPendingNavigation
  );

  useEffect(() => {
    if (!hasHydrated || !isTimelineSupportedPath(pathname)) {
      return;
    }

    const urlEnabled = searchParams.get(TIMELINE_QUERY_PARAM) === "1";
    const urlSnapshotDate = normalizeTimelineDateValue(
      searchParams.get(TIMELINE_DATE_QUERY_PARAM)
    );
    const normalizedStoreSnapshotDate = normalizeTimelineDateValue(snapshotDate);
    const nextSnapshotDate = urlSnapshotDate ?? normalizedStoreSnapshotDate;
    const hash = typeof window !== "undefined" ? window.location.hash : "";

    if (pendingNavigation === "enter") {
      if (urlEnabled) {
        if (nextSnapshotDate) {
          activate(nextSnapshotDate);
        }

        if (searchParams.has(TIMELINE_DATE_QUERY_PARAM)) {
          router.replace(
            buildTimelineHref(pathname, {
              enabled: true,
              searchParams,
              hash,
            }),
            { scroll: false }
          );
        }

        setPendingNavigation(null);
      }

      return;
    }

    if (pendingNavigation === "exit") {
      if (!urlEnabled) {
        setPendingNavigation(null);
      }

      return;
    }

    if (urlEnabled) {
      if (!enabled || (nextSnapshotDate && normalizedStoreSnapshotDate !== nextSnapshotDate)) {
        activate(nextSnapshotDate);
      }

      if (searchParams.has(TIMELINE_DATE_QUERY_PARAM)) {
        router.replace(
          buildTimelineHref(pathname, {
            enabled: true,
            searchParams,
            hash,
          }),
          { scroll: false }
        );
      }

      return;
    }

    if (enabled) {
      router.replace(
        buildTimelineHref(pathname, {
          enabled: true,
          searchParams,
          hash,
        }),
        { scroll: false }
      );
    }
  }, [
    activate,
    enabled,
    hasHydrated,
    pathname,
    pendingNavigation,
    router,
    searchParams,
    setPendingNavigation,
    snapshotDate,
  ]);

  return null;
}
