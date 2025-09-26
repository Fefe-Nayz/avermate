"use client";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import {
  DropDrawer,
  DropDrawerContent,
  DropDrawerGroup,
  DropDrawerItem,
  DropDrawerLabel,
  DropDrawerSeparator,
  DropDrawerTrigger,
} from "@/components/ui/dropdrawer";
import { ChevronRight } from "lucide-react";
import Link from "next/link";
import { Subject } from "@/types/subject";
import { Grade } from "@/types/grade";
import { Period } from "@/types/period";
import { getChildSubjects, getSubjectGrades } from "@/utils/breadcrumbs";
import { useIsMobile } from "@/hooks/use-mobile";

interface BreadcrumbFinalNavigationProps {
  currentItem: {
    type: "subject" | "grade";
    subject?: Subject;
    grade?: Grade;
  };
  allSubjects: Subject[];
  period: Period;
}

export function BreadcrumbFinalNavigation({
  currentItem,
  allSubjects,
  period,
}: BreadcrumbFinalNavigationProps) {
  const isMobile = useIsMobile();

  const getNavigationItems = () => {
    if (currentItem.type === "subject" && currentItem.subject) {
      const childSubjects = getChildSubjects(
        currentItem.subject.id,
        allSubjects,
        period
      );
      const subjectGrades = getSubjectGrades(
        currentItem.subject.id,
        allSubjects,
        period
      );

      return {
        childSubjects,
        grades: subjectGrades,
      };
    }

    // For grades, don't show any children - grades should be in the previous dropdown
    return {
      childSubjects: [],
      grades: [],
    };
  };

  const { childSubjects, grades } = getNavigationItems();
  const hasItems = childSubjects.length > 0 || grades.length > 0;

  if (!hasItems) {
    return null;
  }

  if (isMobile) {
    return (
      <li data-slot="breadcrumb-final-navigation" className="relative">
        <DropDrawer>
          <DropDrawerTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="size-7 group"
              aria-label="Show child items"
            >
              <ChevronRight className="size-3.5 transition-transform duration-200 group-data-[state=open]:rotate-90" />
            </Button>
          </DropDrawerTrigger>
          <DropDrawerContent>
            {childSubjects.length > 0 && (
              <DropDrawerGroup>
                {childSubjects.length > 0 && grades.length > 0 && (
                  <DropDrawerLabel>Subjects</DropDrawerLabel>
                )}
                {childSubjects.map((item, index) => (
                  <Link key={`subject-${item.href}-${index}`} href={item.href}>
                    <DropDrawerItem>{item.label}</DropDrawerItem>
                  </Link>
                ))}
              </DropDrawerGroup>
            )}

            {grades.length > 0 && (
              <DropDrawerGroup>
                {childSubjects.length > 0 && grades.length > 0 && (
                  <DropDrawerLabel>Grades</DropDrawerLabel>
                )}
                {grades.map((item, index) => (
                  <Link key={`grade-${item.href}-${index}`} href={item.href}>
                    <DropDrawerItem>{item.label}</DropDrawerItem>
                  </Link>
                ))}
              </DropDrawerGroup>
            )}
          </DropDrawerContent>
        </DropDrawer>
      </li>
    );
  }

  return (
    <li data-slot="breadcrumb-final-navigation" className="relative">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="size-7 group"
            aria-label="Show child items"
          >
            <ChevronRight className="size-3.5 transition-transform duration-200 group-data-[state=open]:rotate-90" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="start"
          className="max-h-[300px] overflow-y-auto"
        >
          {childSubjects.length > 0 && (
            <>
              {childSubjects.length > 0 && grades.length > 0 && (
                <DropdownMenuLabel>Subjects</DropdownMenuLabel>
              )}
              {childSubjects.map((item, index) => (
                <DropdownMenuItem key={`subject-${item.href}-${index}`} asChild>
                  <Link href={item.href} className="text-sm">
                    {item.label}
                  </Link>
                </DropdownMenuItem>
              ))}
              {grades.length > 0 && <DropdownMenuSeparator />}
            </>
          )}

          {grades.length > 0 && (
            <>
              {childSubjects.length > 0 && grades.length > 0 && (
                <DropdownMenuLabel>Grades</DropdownMenuLabel>
              )}
              {grades.map((item, index) => (
                <DropdownMenuItem key={`grade-${item.href}-${index}`} asChild>
                  <Link href={item.href} className="text-sm">
                    {item.label}
                  </Link>
                </DropdownMenuItem>
              ))}
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </li>
  );
}
