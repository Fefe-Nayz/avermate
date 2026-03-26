"use client";

import { useEffect, useState } from "react";

import { isHapticsEnabled, setHapticsEnabled } from "@/lib/haptics";
import { getUserSettingsStorageEventName } from "@/lib/user-settings-storage";
import { useUpdateUserSettings } from "./use-user-settings";

export function useHapticsSettings() {
  const [enabled, setEnabled] = useState(true);
  const [isLoaded, setIsLoaded] = useState(false);
  const updateUserSettings = useUpdateUserSettings();

  useEffect(() => {
    const handleSettingsChange = (event: Event) => {
      const nextEnabled = (event as CustomEvent<{
        settings: {
          hapticsEnabled: boolean;
        };
      }>).detail?.settings?.hapticsEnabled;

      if (typeof nextEnabled === "boolean") {
        setEnabled(nextEnabled);
      }
    };

    setEnabled(isHapticsEnabled());
    setIsLoaded(true);

    window.addEventListener(getUserSettingsStorageEventName(), handleSettingsChange);

    return () => {
      window.removeEventListener(
        getUserSettingsStorageEventName(),
        handleSettingsChange
      );
    };
  }, []);

  const updateEnabled = (nextEnabled: boolean) => {
    setEnabled(nextEnabled);
    setHapticsEnabled(nextEnabled);
    updateUserSettings.mutate({
      hapticsEnabled: nextEnabled,
    });
  };

  return {
    enabled,
    isLoaded,
    updateEnabled,
  };
}
