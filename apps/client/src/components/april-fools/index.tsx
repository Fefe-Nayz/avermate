"use client";

import { FallingFish } from "./falling-fish";
import { AprilFoolsThemeProvider } from "./april-fools-theme-provider";
import { useEffect, useState } from "react";

export function AprilFools() {
  const [isAprilFools, setIsAprilFools] = useState(false);
  
  useEffect(() => {
    // Check if today is April 1st
    const today = new Date();
    const isAprilFirst = today.getMonth() === 3 && today.getDate() === 1;
    setIsAprilFools(isAprilFirst);
  }, []);
  
  if (!isAprilFools) return null;
  
  return (
    <>
      <AprilFoolsThemeProvider />
        <FallingFish />

    </>
  );
}