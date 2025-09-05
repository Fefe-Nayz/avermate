"use client";

import { useTranslations } from "next-intl";
import { LandingSection } from "./landing-section";
import { DiscoverFeaturesButton } from "../buttons/discover-features-button";
import { Heading } from "../texts/heading";
import { GetStarted } from "./get-started";
import { BlurFade } from "../magicui/blur-fade";
import { TextAnimate } from "../magicui/text-animate";
import { AnimatedGradientTextDemo } from "./new-badge";

export const Headline = () => {
  const t = useTranslations("Landing.Headline");

  return (
    <LandingSection className="overflow-hidden relative pt-32!">
      <div className="flex flex-col gap-8 md:gap-16 items-center relative z-10" id="home">
        {/* New Avermate Badge */}
        <BlurFade delay={0.1} duration={0.4} direction="down">
          <AnimatedGradientTextDemo />
        </BlurFade>

        {/* Heading */}
        <Heading as="h1" animationDelay={0.3} animationDuration={0.6}>
          {t("title")}
        </Heading>

        {/* Subheading */}
        <TextAnimate
          once
          as="h2"
          animation="blurInUp"
          by="word"
          delay={0.8}
          duration={0.6}
          className="md:text-base text-xs text-muted-foreground text-center max-w-[300px] md:max-w-[600px]"
        >
          {t("subtitle")}
        </TextAnimate>

        <BlurFade
          delay={1.4}
          duration={0.4}
          direction="up"
          className="flex flex-col md:flex-row gap-2 md:gap-8 items-center"
        >
          <GetStarted />
          <DiscoverFeaturesButton />
        </BlurFade>

        <div className="flex flex-col gap-16 items-center">
          {/* Hero mockup - full-bleed, bold tilt, subtle hover */}
          {/* Hero mockup — bold tilt, no hover, reasonable sizing */}
          {/* Hero mockup — centered at all sizes, bold tilt, no hover */}
          <BlurFade
            delay={2.0}
            duration={1.0}
            offset={20}
            direction="down"
            className="relative w-screen max-w-[90vw] -mx-4 sm:-mx-16 lg:-mx-32 2xl:-mx-64 overflow-visible pt-8"
          >
            {/* Stage keeps the block centered and reserves vertical space */}
            <div className="flex justify-center">
              {/* Centered, then slightly left-biased; width scales but stays reasonable */}
              <div
                className="
        ml-0 sm:ml-[-8vw] lg:ml-[-10vw]
        w-full sm:w-[145vw] lg:w-[160vw] max-w-[2200px]
        origin-top transform-gpu will-change-transform
        rotate-0 sm:rotate-[-20deg] lg:rotate-[-22deg]
        skew-y-0 sm:skew-y-12
        pointer-events-none select-none
      "
                aria-hidden="true"
              >
                {/* Frame */}
                <div
                  className="
          relative z-10 flex overflow-visible rounded-2xl
          p-3 md:p-4 shadow-2xl
          bg-border/60 dark:bg-border/20
          border border-border/80 dark:border-border/30
          backdrop-blur-3xl
        "
                >
                  {/* Inner surface + gentle mask (with WebKit fallback) */}
                  <div
                    className="
            relative z-10 flex w-full overflow-visible rounded-xl
            bg-background/90 shadow-2xl
            border border-border/80 dark:border-border/20 dark:border-t-border/40

          "
                  >
                    {/* Desktop Dark */}
                    <img
                      src="/images/landing/main-desktop-dark.png"
                      alt="Dashboard Desktop Dark"
                      className="hidden dark-desktop:block w-full rounded-xl"
                      loading="lazy"
                      decoding="async"
                    />

                    {/* Desktop Light */}
                    <img
                      src="/images/landing/main-desktop-light.png"
                      alt="Dashboard Desktop Light"
                      className="hidden light-desktop:block dark:hidden w-full rounded-xl"
                      loading="lazy"
                      decoding="async"
                    />

                    {/* Mobile Dark */}
                    <img
                      src="/images/landing/main-mobile-dark.png"
                      alt="Dashboard Mobile Dark"
                      className="hidden dark-mobile:block w-full rounded-xl shadow-lg"
                      loading="lazy"
                      decoding="async"
                    />

                    {/* Mobile Light */}
                    <img
                      src="/images/landing/main-mobile-light.png"
                      alt="Dashboard Mobile Light"
                      className="hidden light-mobile:block dark:hidden w-full rounded-xl shadow-lg"
                      loading="lazy"
                      decoding="async"
                    />
                  </div>
                </div>
              </div>
            </div>
          </BlurFade>
        </div>
      </div>

      {/* Gradient overlay from transparent to black */}
      <div className="absolute inset-0 bg-gradient-to-b from-transparent via-transparent to-white dark:to-zinc-950 pointer-events-none z-20" />
    </LandingSection>
  );
};
