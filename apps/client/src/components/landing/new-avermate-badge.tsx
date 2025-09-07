"use client";

import { AnimatedGradientText } from "@/components/magicui/animated-gradient-text";
import { cn } from "@/lib/utils";
import { BlurFade } from "@/components/magicui/blur-fade";
import { useTranslations } from "next-intl";

export function NewAvermateBadge() {
  const t = useTranslations("Landing.Headline");

  return (
    <BlurFade delay={0.1} duration={0.6} direction="down">
      <div className="flex items-center justify-center">
        <div
          className={cn(
            "group rounded-full border border-black/5 bg-neutral-100 text-base text-white transition-all ease-in hover:cursor-pointer hover:bg-neutral-200 dark:border-white/5 dark:bg-neutral-900 dark:hover:bg-neutral-800",
          )}
        >
          <AnimatedGradientText>
            ✨{" "}
            <span
              className={cn(
                `inline animate-gradient bg-gradient-to-r from-[#ffaa40] via-[#9c40ff] to-[#ffaa40] bg-[length:var(--bg-size)_100%] bg-clip-text text-transparent`,
              )}
            >
              {t("newAvermate", { defaultValue: "New Avermate" })}
            </span>{" "}
            🎉
          </AnimatedGradientText>
        </div>
      </div>
    </BlurFade>
  );
}
