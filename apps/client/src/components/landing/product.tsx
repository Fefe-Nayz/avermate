import { Heading } from "../texts/heading";
import { SubHeading } from "../texts/subheading";
import { FeaturesGrid } from "./features-grid";
import { LandingSection } from "./landing-section";
import { useTranslations } from "next-intl";
import { BlurFade } from "../magicui/blur-fade";

export const Product = () => {
  const t = useTranslations("Landing.Product");
  return (
    <div id="features">
      <LandingSection>
        <BlurFade delay={0.3} duration={0.6} className="flex flex-col items-center gap-4">
          <SubHeading as="h3">
            {t("subHeading")}
          </SubHeading>

          <Heading className="max-w-[280px] md:max-w-[550px]" as="h2" animationDelay={0.5} animationDuration={0.8}>
            {t("heading")}
          </Heading>
        </BlurFade>

        <FeaturesGrid />

        {/* <MockGradesTable /> */}
        {/* <MockAverageChart /> */}
      </LandingSection>
    </div>
  );
};
