import { cn } from "@/lib/utils";
import { ReactNode } from "react";
import { TextAnimate } from "@/components/magicui/text-animate";

export const Heading = ({
  as: As,
  className,
  children,
  animationDelay = 0.2,
  animationDuration = 0.8,
}: {
  as: "h1" | "h2";
  className?: string;
  children: ReactNode;
  animationDelay?: number;
  animationDuration?: number;
}) => {
  return (
    <TextAnimate
      as={As}
      animation="blurInUp"
      by="word"
      delay={animationDelay}
      duration={animationDuration}
      once
      className={cn(
        "text-2xl md:text-5xl font-extrabold max-w-[220px] md:max-w-[450px] text-center leading-tight overflow-visible",
        className
      )}
      segmentClassName="text-transparent bg-clip-text bg-gradient-to-b from-zinc-800 to-zinc-600 dark:from-zinc-200 dark:via-zinc-100 dark:to-zinc-400"

    >
      {children as string}
    </TextAnimate>
  );
};
