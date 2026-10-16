"use client";

import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import type { YearComparisonPreference } from "@/types/year-comparison";

export const defaultYearComparisonPreference: YearComparisonPreference = {
  enabled: false,
  referenceYearId: null,
  scope: "same-progress",
};

export function yearComparisonPreferenceKey(userId: string, yearId: string) {
  return JSON.stringify([userId, yearId]);
}

type YearComparisonState = {
  preferences: Record<string, YearComparisonPreference>;
  hasHydrated: boolean;
  updatePreference: (userId: string, yearId: string, update: Partial<YearComparisonPreference>) => void;
  setHasHydrated: (hydrated: boolean) => void;
};

export const useYearComparisonStore = create<YearComparisonState>()(
  persist(
    (set) => ({
      preferences: {},
      hasHydrated: false,
      updatePreference: (userId, yearId, update) => {
        if (!userId || !yearId || yearId === "none") return;
        const key = yearComparisonPreferenceKey(userId, yearId);
        set((state) => ({
          preferences: {
            ...state.preferences,
            [key]: { ...defaultYearComparisonPreference, ...state.preferences[key], ...update },
          },
        }));
      },
      setHasHydrated: (hasHydrated) => set({ hasHydrated }),
    }),
    {
      name: "year-comparison-preferences-v1",
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({ preferences: state.preferences }),
      onRehydrateStorage: () => (state) => state?.setHasHydrated(true),
    }
  )
);
