"use client";

import { cn } from "@/lib/utils";
import Link from "next/link";
import { usePathname } from "next/navigation";

const rounded = false;

export default function GradeBadge({
  value,
  outOf,
  coefficient,
  id,
  periodId,
  subjectId,
}: {
  value: number;
  outOf: number;
  coefficient: number;
  id: string;
  periodId: string;
  subjectId: string;
}) {
  const pathname = usePathname();

  const handleClick = () => {
    const currentPath = pathname + window.location.search || "/dashboard";
    localStorage.setItem("backFromGradeOrSubject", `${currentPath}#${subjectId}`);
  };

  return (
    <Link href={`/dashboard/grades/${id}/${periodId}`} onClick={handleClick}>
      <span
        className={cn(
          "flex items-center justify-center text-center align-middle px-2 py-0.5 bg-muted font-semibold rounded text-sm bg-opacity-40 hover:bg-muted/50 transition-all duration-300",
          rounded && "rounded-full"
        )}
      >
        <p className="text-center align-middle">{value / 100}</p>
        <sub className="ml-1">/{outOf / 100}</sub>
        <span className="ml-2">({coefficient / 100})</span>
      </span>
    </Link>
  );
}
