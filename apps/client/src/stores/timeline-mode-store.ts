"use client";

import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

type TimelineModeState = {
  enabled: boolean;
  snapshotDate: string | null;
  hasHydrated: boolean;
  pendingNavigation: "enter" | "exit" | null;
  activate: (snapshotDate?: string | null) => void;
  setSnapshotDate: (snapshotDate: string) => void;
  deactivate: () => void;
  setHasHydrated: (hasHydrated: boolean) => void;
  setPendingNavigation: (pendingNavigation: "enter" | "exit" | null) => void;
};

export const useTimelineModeStore = create<TimelineModeState>()(
  persist(
    (set) => ({
      enabled: false,
      snapshotDate: null,
      hasHydrated: false,
      pendingNavigation: null,
      activate: (snapshotDate) =>
        set({
          enabled: true,
          snapshotDate: snapshotDate ?? null,
        }),
      setSnapshotDate: (snapshotDate) => set({ snapshotDate, enabled: true }),
      deactivate: () =>
        set({
          enabled: false,
          snapshotDate: null,
        }),
      setHasHydrated: (hasHydrated) => set({ hasHydrated }),
      setPendingNavigation: (pendingNavigation) => set({ pendingNavigation }),
    }),
    {
      name: "timeline-mode-store",
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({
        enabled: state.enabled,
        snapshotDate: state.snapshotDate,
      }),
      onRehydrateStorage: () => (state) => {
        state?.setHasHydrated(true);
      },
    }
  )
);
