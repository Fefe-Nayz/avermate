import { cn } from "@/lib/utils";
import { ReactNode } from "react";

export const Heading = ({
  as: As,
  className,
  children,
}: {
  as: "h1" | "h2";
    className?: string;
  children: ReactNode
}) => {
  return (
    <As
      className={cn(
        "text-5xl font-extrabold max-w-[450px] text-center text-transparent bg-clip-text bg-gradient-to-b from-zinc-800 to-zinc-600 dark:from-zinc-200 dark:via-zinc-100 dark:to-zinc-400",
        className
      )}
    >
      {children}
    </As>
  );
};
