import Link from "next/link";
import { cn } from "@/lib/utils";
export default function Logo() {
  return (
    <Link
      className="group flex gap-4 items-center rounded-md outline-none"
      href={"/"}
    >
      <img
        className="size-8 rounded-lg border border-transparent transition-all group-focus-visible:border-ring group-focus-visible:ring-ring/50 group-focus-visible:ring-[3px]"
        src="/logo.svg"
        alt="Logo"
      />
      <p className="hidden md:inline">Avermate</p>
    </Link>
  );
}

export function LogoSmall({className}: {className?: string}) {
  return (
      <img
        className={cn(
          "size-8 rounded-lg border border-transparent transition-all group-focus-visible:border-ring group-focus-visible:ring-ring/50 group-focus-visible:ring-[3px]",
          className
        )}
        src="/logo.svg"
        alt="Logo"
      />
  );
}
