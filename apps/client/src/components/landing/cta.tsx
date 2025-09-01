import { Heading } from "../texts/heading";
import { SubHeading } from "../texts/subheading";
import { GetStarted } from "./get-started";
import { LandingSection } from "./landing-section";
import { useTranslations } from "next-intl";
import { BlurFade } from "../magicui/blur-fade";

export const CTA = () => {
  const t = useTranslations("Landing.CTA");

  return (
    <LandingSection>
      <BlurFade delay={0.3} duration={0.6} className="flex flex-col gap-2 md:gap-4 items-center">
        <SubHeading as="h3">{t("startToday")}</SubHeading>

        <Heading className="max-w-[275px] md:max-w-[550px]" as="h2" animationDelay={0.5} animationDuration={0.8}>
          {t("transformEfforts")}
        </Heading>
      </BlurFade>

      <BlurFade delay={1.5} duration={0.6} direction="up">
        <GetStarted />
      </BlurFade>
    </LandingSection>
  );
};
