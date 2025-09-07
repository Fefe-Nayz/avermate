import { cn } from "@/lib/utils";
import { ReactNode } from "react";

export const LandingSection = ({
  className,
  children,
}: {
  className?: string;
  children: ReactNode;
}) => {
  return (
    <section
      className={cn(
        "flex flex-col items-center gap-8 md:gap-16 px-4 sm:px-16 lg:px-32 2xl:px-64 3xl:px-96 py-16 md:py-32 ",
        className
      )}
    >
      {children}
    </section>
  );
};
