"use client";

import { SeasonalElements } from "./falling-fish";
import { SeasonalThemeProvider } from "./april-fools-theme-provider";
import { MokattamThemeProvider } from "@/components/themes/mokattam-theme-provider";

export function AprilFools() {
  return (
    <>
      <SeasonalThemeProvider />
      <MokattamThemeProvider />
      <SeasonalElements />
    </>
  );
}
