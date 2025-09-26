import Link from "next/link";
import { cn } from "@/lib/utils";
export default function Logo() {
  return (
    <Link className="flex gap-4 items-center" href={"/"}>
      <img className="size-8 rounded-lg" src="/logo.svg" alt="Logo" />
      <p className="hidden md:inline">Avermate</p>
    </Link>
  );
}

export function LogoSmall({className}: {className?: string}) {
  return (
      <img className={cn("size-8 rounded-lg", className)} src="/logo.svg" alt="Logo" />
  );
}