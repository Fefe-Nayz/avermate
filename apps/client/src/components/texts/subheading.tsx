import { cn } from "@/lib/utils";
import { ReactNode } from "react";
import { TextAnimate } from "@/components/magicui/text-animate";

export const SubHeading = ({
  as: As,
  className,
  children,
  animated = false,
  animationDelay = 0.5,
}: {
  as: "h3" | "h4";
  className?: string;
  children: ReactNode;
  animated?: boolean;
  animationDelay?: number;
}) => {
  if (animated && typeof children === "string") {
    return (
      <TextAnimate
        as={As}
        animation="blurInUp"
        by="word"
        delay={animationDelay}
        duration={0.6}
        className={cn(
          "max-w-[200px] md:max-w-[450px] text-sm md:text-base text-center text-muted-foreground",
          className
        )}
      >
        {children}
      </TextAnimate>
    );
  }

  return (
    <As
      className={cn(
        "max-w-[200px] md:max-w-[450px] text-sm md:text-base text-center text-muted-foreground",
        className
      )}
    >
      {children}
    </As>
  );
};
