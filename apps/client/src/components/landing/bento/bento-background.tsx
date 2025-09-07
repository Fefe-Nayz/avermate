import { ReactNode } from "react";

export const BentoBackground = ({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) => {
  return (
    <div className="absolute h-full w-full transition-all duration-300 ease-out mask-[linear-gradient(to_top,transparent_10%,#000_100%)] group-hover:scale-105 cursor-default pointer-events-none">
      <div className="p-4 md:p-8">{children}</div>
    </div>
  );
};
