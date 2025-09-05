import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { LandingSection } from "./landing-section";
import { useTranslations } from "next-intl";
import { BlurFade } from "../magicui/blur-fade";
import { Heading } from "../texts/heading";

export const FAQ = () => {
  const t = useTranslations("Landing.FAQ");

  const questions = [
    {
      q: t("question1"),
      a: t("answer1"),
    },
    {
      q: t("question2"),
      a: t("answer2"),
    },
    {
      q: t("question3"),
      a: t("answer3"),
    },
    {
      q: t("question4"),
      a: t("answer4"),
    },
  ];

  return (
    <LandingSection className="max-w-screen-3xl mx-auto">
      <BlurFade delay={0.1} duration={0.6} className="flex flex-col gap-4 items-center" inView={true}>
        <Heading className="max-w-[275px] md:max-w-[450px]" as="h2" animationDelay={0.3} animationDuration={0.8}>
          {t("title")}
        </Heading>
      </BlurFade>

      <BlurFade delay={0.5} duration={0.6} className="w-full" inView={true}>
        <Accordion type="single" collapsible className="w-full">
          {questions.map(({ q, a }, index) => (
            <BlurFade key={q} delay={0.7 + index * 0.1} duration={0.5} inView={true}>
              <AccordionItem value={q}>
                <AccordionTrigger className="text-left">{q}</AccordionTrigger>
                <AccordionContent>{a}</AccordionContent>
              </AccordionItem>
            </BlurFade>
          ))}
        </Accordion>
      </BlurFade>
    </LandingSection>
  );
};
