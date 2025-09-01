import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { LandingSection } from "./landing-section";
import { useTranslations } from "next-intl";
import { BlurFade } from "../magicui/blur-fade";

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
    <LandingSection>
      <BlurFade delay={0.3} duration={0.6} className="w-full">
        <Accordion type="single" collapsible className="w-full">
          {questions.map(({ q, a }, index) => (
            <BlurFade key={q} delay={0.5 + index * 0.1} duration={0.5}>
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
