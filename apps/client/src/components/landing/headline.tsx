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
    <LandingSection>
      <div className="flex flex-col gap-8 md:gap-16 items-center">
        {/* New Avermate Badge */}
        <BlurFade delay={0.1} duration={0.6} direction="down">
          <AnimatedGradientTextDemo />
        </BlurFade>

        {/* Heading */}
        <Heading as="h1" animationDelay={0.5} animationDuration={1.0}>{t("title")}</Heading>

        {/* Subheading */}
        <TextAnimate
          as="h2"
          animation="blurInUp"
          by="word"
          delay={1.8}
          duration={0.8}
          className="md:text-base text-xs text-muted-foreground text-center max-w-[300px] md:max-w-[600px]"
        >
          {t("subtitle")}
        </TextAnimate>

        <BlurFade delay={2.8} duration={0.6} direction="up" className="flex flex-col md:flex-row gap-2 md:gap-8 items-center">
          <GetStarted />
          <DiscoverFeaturesButton />
        </BlurFade>
              <div className="flex flex-col gap-16 items-center">
        <BlurFade delay={3.5} duration={1.0} direction="up" className="relative w-full">
          {/* Desktop Dark Theme */}
          <img
            src="/images/landing/main-desktop-dark.png"
            alt="Dashboard Desktop Dark"
            className="hidden dark-desktop:block w-full rounded-3xl max-w-[2000px] mask-[linear-gradient(to_top,transparent_10%,#000_100%)]"
          />

          {/* Desktop Light Theme */}
          <img
            src="/images/landing/main-desktop-light.png"
            alt="Dashboard Desktop Light"
            className="hidden light-desktop:block dark:hidden w-full rounded-3xl max-w-[2000px] mask-[linear-gradient(to_top,transparent_10%,#000_100%)]"
          />

          {/* Mobile Dark Theme */}
          <img
            src="/images/landing/main-mobile-dark.png"
            alt="Dashboard Mobile Dark"
            className="hidden dark-mobile:block w-full rounded-3xl max-w-[2000px] shadow-lg"
          />

          {/* Mobile Light Theme */}
          <img
            src="/images/landing/main-mobile-light.png"
            alt="Dashboard Mobile Light"
            className="hidden light-mobile:block dark:hidden w-full rounded-3xl max-w-[2000px] shadow-lg"
          />
        </BlurFade>
      </div>
        </div>
    </LandingSection>
  );
};
