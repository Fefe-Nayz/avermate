"use client";

import { apiClient } from "@/lib/api";
import { queryKeys } from "@/lib/query-keys";
import {
  defaultUserSettings,
  type ChartSettings,
  type PersistedUserSettings,
  type UserSettings,
} from "@/types/user-settings";
import {
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { useCallback, useEffect, useState } from "react";
import { HTTPError } from "ky";
import type { QueryClient } from "@tanstack/react-query";

type UserSettingsResponse = {
  settings: PersistedUserSettings;
};

export type UpdateUserSettingsInput = {
  theme?: UserSettings["theme"];
  language?: UserSettings["language"];
  chartSettings?: Partial<ChartSettings>;
  seasonalThemesEnabled?: boolean;
  seasonalTheme?: UserSettings["seasonalTheme"];
  mokattamThemeEnabled?: boolean;
  hapticsEnabled?: boolean;
};

const SETTINGS_PATCH_DEBOUNCE_MS = 250;

let queuedUpdates: UpdateUserSettingsInput | null = null;
let queuedFlushTimeout: ReturnType<typeof setTimeout> | null = null;
let activeFlushPromise: Promise<void> | null = null;
let activeQueryClient: QueryClient | null = null;
let globalPending = false;
const pendingListeners = new Set<(pending: boolean) => void>();

function mergeSettings(
  current: PersistedUserSettings | undefined,
  updates: UpdateUserSettingsInput
): PersistedUserSettings {
  const optimisticUpdatedAt = new Date().toISOString();
  const base = current ?? {
    ...defaultUserSettings,
    persisted: true,
    updatedAt: optimisticUpdatedAt,
  };

  return {
    ...base,
    ...updates,
    chartSettings: updates.chartSettings
      ? {
          ...base.chartSettings,
          ...updates.chartSettings,
        }
      : base.chartSettings,
    persisted: true,
    updatedAt: optimisticUpdatedAt,
  };
}

function mergeUpdatePayload(
  current: UpdateUserSettingsInput | null,
  updates: UpdateUserSettingsInput
): UpdateUserSettingsInput {
  return {
    ...current,
    ...updates,
    chartSettings: updates.chartSettings
      ? {
          ...(current?.chartSettings ?? {}),
          ...updates.chartSettings,
        }
      : current?.chartSettings,
  };
}

function hasMeaningfulUpdates(
  current: PersistedUserSettings | undefined,
  updates: UpdateUserSettingsInput
) {
  if (!current) {
    return Object.keys(updates).length > 0;
  }

  if (updates.theme !== undefined && updates.theme !== current.theme) {
    return true;
  }

  if (
    updates.language !== undefined &&
    updates.language !== current.language
  ) {
    return true;
  }

  if (
    updates.seasonalThemesEnabled !== undefined &&
    updates.seasonalThemesEnabled !== current.seasonalThemesEnabled
  ) {
    return true;
  }

  if (
    updates.seasonalTheme !== undefined &&
    updates.seasonalTheme !== current.seasonalTheme
  ) {
    return true;
  }

  if (
    updates.mokattamThemeEnabled !== undefined &&
    updates.mokattamThemeEnabled !== current.mokattamThemeEnabled
  ) {
    return true;
  }

  if (
    updates.hapticsEnabled !== undefined &&
    updates.hapticsEnabled !== current.hapticsEnabled
  ) {
    return true;
  }

  if (!updates.chartSettings) {
    return false;
  }

  if (
    updates.chartSettings.autoZoomYAxis !== undefined &&
    updates.chartSettings.autoZoomYAxis !== current.chartSettings.autoZoomYAxis
  ) {
    return true;
  }

  if (
    updates.chartSettings.showTrendLine !== undefined &&
    updates.chartSettings.showTrendLine !== current.chartSettings.showTrendLine
  ) {
    return true;
  }

  if (
    updates.chartSettings.trendLineSubdivisions !== undefined &&
    updates.chartSettings.trendLineSubdivisions !==
      current.chartSettings.trendLineSubdivisions
  ) {
    return true;
  }

  return false;
}

function setGlobalPending(nextPending: boolean) {
  globalPending = nextPending;

  for (const listener of pendingListeners) {
    listener(nextPending);
  }
}

async function flushQueuedSettings(): Promise<void> {
  if (activeFlushPromise || !queuedUpdates || !activeQueryClient) {
    return activeFlushPromise ?? Promise.resolve();
  }

  const queryClient = activeQueryClient;
  const payload = queuedUpdates;
  queuedUpdates = null;

  setGlobalPending(true);

  activeFlushPromise = (async () => {
    try {
      const response = await apiClient.patch("settings", {
        json: payload,
      });
      const data = await response.json<UserSettingsResponse>();

      queryClient.setQueryData(queryKeys.userSettings.current, data.settings);
    } catch {
      await queryClient.invalidateQueries({
        queryKey: queryKeys.userSettings.current,
        exact: true,
      });
    } finally {
      activeFlushPromise = null;

      if (queuedUpdates) {
        void flushQueuedSettings();
        return;
      }

      setGlobalPending(false);
    }
  })();

  return activeFlushPromise;
}

function scheduleQueuedSettingsFlush(queryClient: QueryClient) {
  activeQueryClient = queryClient;

  if (queuedFlushTimeout) {
    clearTimeout(queuedFlushTimeout);
  }

  queuedFlushTimeout = setTimeout(() => {
    queuedFlushTimeout = null;
    void flushQueuedSettings();
  }, SETTINGS_PATCH_DEBOUNCE_MS);
}

export function useUserSettings(enabled: boolean) {
  return useQuery({
    queryKey: queryKeys.userSettings.current,
    queryFn: async () => {
      const response = await apiClient.get("settings");
      const data = await response.json<UserSettingsResponse>();

      return data.settings;
    },
    enabled,
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
    retry: (failureCount, error) => {
      if (error instanceof HTTPError) {
        const status = error.response.status;

        if (status === 401 || status === 403 || status === 429) {
          return false;
        }
      }

      return failureCount < 2;
    },
  });
}

export function useUpdateUserSettings() {
  const queryClient = useQueryClient();
  const [isPending, setIsPending] = useState(globalPending);

  useEffect(() => {
    pendingListeners.add(setIsPending);

    return () => {
      pendingListeners.delete(setIsPending);
    };
  }, []);

  const mutate = useCallback(
    async (updates: UpdateUserSettingsInput) => {
      await queryClient.cancelQueries({
        queryKey: queryKeys.userSettings.current,
      });

      const previous = queryClient.getQueryData<PersistedUserSettings>(
        queryKeys.userSettings.current
      );

      if (!hasMeaningfulUpdates(previous, updates)) {
        return;
      }

      queryClient.setQueryData<PersistedUserSettings>(
        queryKeys.userSettings.current,
        mergeSettings(previous, updates)
      );

      queuedUpdates = mergeUpdatePayload(queuedUpdates, updates);
      setGlobalPending(true);
      scheduleQueuedSettingsFlush(queryClient);
    },
    [queryClient]
  );

  return {
    mutate,
    isPending,
  };
}
