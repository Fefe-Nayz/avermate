import { useEffect, useMemo, useSyncExternalStore } from "react";
import { activityStreaks } from "@avermate/core";
import { useYear } from "@/components/year-provider";
import { useSession } from "@/lib/auth-client";
import { locale } from "@/lib/i18n";
import {
  buildSystemWidgetPayload,
  serializeSystemWidgetPayload,
} from "@/lib/system-widget-model";
import { updateSystemWidget } from "@/lib/system-widget-runtime";
import {
  disabledSystemWidgetPreference,
  loadSystemWidgetPreference,
  subscribeSystemWidgetSettings,
  systemWidgetSettingsRevision,
} from "@/lib/system-widget-settings";

/** Keeps the extension snapshot local and in step with the active account. */
export function SystemWidgetSync() {
  const session = useSession();
  const { year, yearGraph, scale, decimals, timelineDate, isLoading } =
    useYear();
  const settingsRevision = useSyncExternalStore(
    subscribeSystemWidgetSettings,
    systemWidgetSettingsRevision,
    () => 0,
  );

  const source = useMemo(() => {
    if (!year || isLoading || timelineDate !== null) return null;
    const grades = yearGraph.allGrades();
    return {
      averageRatio: yearGraph.ratio(null, null),
      scale,
      decimals,
      gradeCount: grades.length,
      activityStreak: activityStreaks(grades).current.length,
      updatedAt: new Date(),
    };
  }, [decimals, isLoading, scale, timelineDate, year, yearGraph]);

  useEffect(() => {
    let alive = true;
    const userId = session.data?.user.id;

    void (async () => {
      const preference = userId
        ? await loadSystemWidgetPreference(userId)
        : disabledSystemWidgetPreference();
      if (!alive) return;
      const payload = serializeSystemWidgetPayload(
        buildSystemWidgetPayload(preference, source, locale()),
      );
      await updateSystemWidget(payload);
    })();

    return () => {
      alive = false;
    };
  }, [session.data?.user.id, settingsRevision, source]);

  return null;
}
