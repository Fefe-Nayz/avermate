"use client";

import { SeasonalElements } from "./falling-fish";
import { SeasonalThemeProvider } from "./april-fools-theme-provider";

export function AprilFools() {
  return (
    <>
      <SeasonalThemeProvider />
      <SeasonalElements />
    </>
  );
}