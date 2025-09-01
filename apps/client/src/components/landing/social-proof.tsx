"use client";

import { LandingSection } from "./landing-section";
import { Skeleton } from "../ui/skeleton";
import NumberTicker from "../ui/number-ticker";
import { useTranslations } from "next-intl";
import { useLandingStats } from "@/hooks/use-landing-stats";

export const SocialProof = () => {
  const { data, isError, isPending } = useLandingStats();

  const t = useTranslations("Landing.SocialProof");

  if (isError) {
    return (
      <LandingSection className="!px-0 !py-0">
        <div className="grid dark:bg-zinc-950 grid-cols-3 w-full px-4 sm:px-16 lg:px-32 2xl:px-64 3xl:px-96 py-8 border-y divide-x backdrop-blur-2xl">
          <div className="flex flex-col items-center px-1">
            <p className="font-extrabold text-lg md:text-2xl">0</p>
            <p className="text-center text-sm md:text-base text-muted-foreground">
              {t("users")}
            </p>
          </div>

          <div className="flex flex-col items-center px-2">
            <p className="font-extrabold text-lg md:text-2xl">0</p>
            <p className="text-center text-sm md:text-base text-muted-foreground">
              {t("grades")}
            </p>
          </div>

          <div className="flex flex-col items-center px-1">
            <p className="font-extrabold text-lg md:text-2xl">0</p>
            <p className="text-center text-sm md:text-base text-muted-foreground">
              {t("subjects")}
            </p>
          </div>
        </div>
      </LandingSection>
    );
  }

  if (isPending) {
    return (
      <LandingSection className="!px-0 !py-0">
        <div className="grid dark:bg-zinc-950 grid-cols-3 w-full px-4 sm:px-16 lg:px-32 2xl:px-64 3xl:px-96 py-8 border-y divide-x backdrop-blur-2xl">
          <div className="flex flex-col items-center px-1">
            <Skeleton className="w-12 h-7 md:h-8" />
            <p className="text-center text-sm md:text-base text-muted-foreground">
              {t("users")}
            </p>
          </div>

          <div className="flex flex-col items-center px-2">
            <Skeleton className="w-12 h-7 md:h-8" />
            <p className="text-center text-sm md:text-base text-muted-foreground">
              {t("grades")}
            </p>
          </div>

          <div className="flex flex-col items-center px-1">
            <Skeleton className="w-12 h-7 md:h-8" />
            <p className="text-center text-sm md:text-base text-muted-foreground">
              {t("subjects")}
            </p>
          </div>
        </div>
      </LandingSection>
    );
  }

  return (
    <LandingSection className="!px-0 !py-0">
      <div className="grid dark:bg-zinc-950 grid-cols-3 w-full px-4 sm:px-16 lg:px-32 2xl:px-64 3xl:px-96 py-8 border-y divide-x backdrop-blur-2xl">
        <div className="flex flex-col items-center px-1">
          <p className="font-extrabold text-lg md:text-2xl">
            <NumberTicker value={data?.userCount || 0} decimalPlaces={0} duration={5} />
          </p>
          <p className="text-center text-sm md:text-base text-muted-foreground">
            {t("users")}
          </p>
        </div>

        <div className="flex flex-col items-center px-2">
          <p className="font-extrabold text-lg md:text-2xl">
            <NumberTicker value={data?.gradeCount || 0} decimalPlaces={0} duration={5} />
          </p>
          <p className="text-center text-sm md:text-base text-muted-foreground">
            {t("grades")}
          </p>
        </div>

        <div className="flex flex-col items-center px-1">
          <p className="font-extrabold text-lg md:text-2xl">
            <NumberTicker value={data?.subjectCount || 0} decimalPlaces={0} duration={5} />
          </p>
          <p className="text-center text-sm md:text-base text-muted-foreground">
            {t("subjects")}
          </p>
        </div>
      </div>
    </LandingSection>
  );
};
