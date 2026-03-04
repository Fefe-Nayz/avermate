"use client";

import { useEffect, useState } from "react";

import { isHapticsEnabled, setHapticsEnabled } from "@/lib/haptics";

export function useHapticsSettings() {
  const [enabled, setEnabled] = useState(true);
  const [isLoaded, setIsLoaded] = useState(false);

  useEffect(() => {
    setEnabled(isHapticsEnabled());
    setIsLoaded(true);
  }, []);

  const updateEnabled = (nextEnabled: boolean) => {
    setEnabled(nextEnabled);
    setHapticsEnabled(nextEnabled);
  };

  return {
    enabled,
    isLoaded,
    updateEnabled,
  };
}
