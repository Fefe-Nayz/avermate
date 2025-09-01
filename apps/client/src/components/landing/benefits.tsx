'use client';

import { CheckIcon, XMarkIcon } from "@heroicons/react/24/outline";
import { Heading } from "../texts/heading";
import { SubHeading } from "../texts/subheading";
import { LandingSection } from "./landing-section";
import { useTranslations } from "next-intl";
import { BlurFade } from "../magicui/blur-fade";
import { motion } from "motion/react";

export const Benefits = () => {
  const t = useTranslations("Landing.Benefits");

  const benefits = [
    t("easyToSetup"),
    t("fastAndSecure"),
    t("flexibleAndCustomizable"),
    t("goodUserExperience"),
  ];
  const cons = [t("hardToSetup"), t("badUserExperience"), t("lackOfFeatures")];

  return (
    <LandingSection>
      <BlurFade delay={0.3} duration={0.6} className="flex flex-col gap-4 items-center">
        <SubHeading className="max-w-[175px]" as="h3">
          {t("stayFocused")}
        </SubHeading>

        <Heading className="max-w-[250px] md:max-w-[500px]" as="h2" animationDelay={0.5} animationDuration={0.8}>
          {t("simplifyResults")}
        </Heading>
      </BlurFade>

      <div className="grid gap-8 md:grid-cols-2">
        <BlurFade delay={1.5} duration={0.6} direction="left" className="flex flex-col gap-4">
          <h4 className="text-sm text-muted-foreground">
            {t("withoutAvermate")}
          </h4>

          <ul className="flex flex-col gap-2">
            {cons.map((con, index) => (
              <motion.li 
                key={con}
                className="flex items-center text-red-500"
                initial={{ opacity: 0, x: -20 }}
                whileInView={{ opacity: 1, x: 0 }}
                transition={{ delay: 2.0 + index * 0.1, duration: 0.4 }}
                viewport={{ once: true }}
              >
                <XMarkIcon className="size-4 mr-2" />
                {con}
              </motion.li>
            ))}
          </ul>
        </BlurFade>

        <BlurFade delay={1.7} duration={0.6} direction="right" className="flex flex-col gap-4">
          <h4 className="text-sm text-muted-foreground">{t("withAvermate")}</h4>

          <ul className="flex flex-col gap-2">
            {benefits.map((benefit, index) => (
              <motion.li 
                key={benefit}
                className="flex items-center text-emerald-500"
                initial={{ opacity: 0, x: 20 }}
                whileInView={{ opacity: 1, x: 0 }}
                transition={{ delay: 2.2 + index * 0.1, duration: 0.4 }}
                viewport={{ once: true }}
              >
                <CheckIcon className="size-4 mr-2" />
                {benefit}
              </motion.li>
            ))}
          </ul>
        </BlurFade>
      </div>
    </LandingSection>
  );
};
