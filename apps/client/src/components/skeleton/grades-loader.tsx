import { Separator } from "@/components/ui/separator";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import React from "react";
import { Skeleton } from "../ui/skeleton";

import {
  EllipsisVerticalIcon,
  PlusCircleIcon,
} from "@heroicons/react/24/outline";
import { Button } from "../ui/button";
import { ScrollArea, ScrollBar } from "../ui/scroll-area";
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../ui/table";

export default function gradesLoader(t: any) {
  return (
    <main className="flex flex-col gap-4 md:gap-8 mx-auto max-w-[2000px]">
      <div className="flex gap-2 md:gap-16 justify-between items-center">
        <h1 className="text-xl md:text-3xl font-semibold">
          <Skeleton className="w-40 h-[32px]" />
        </h1>

        <div className="hidden lg:flex gap-4">
          <Button disabled={true}>
            <PlusCircleIcon className="size-4 mr-2" />
            {t("addGrade")}
          </Button>

          <Button variant="outline" disabled={true}>
            <PlusCircleIcon className="size-4 mr-2" />
            {t("addSubject")}
          </Button>
          <Button variant="outline" disabled={true}>
            <PlusCircleIcon className="size-4 mr-2" />
            {t("addPeriod")}
          </Button>
        </div>
        <div className="flex lg:hidden gap-2">
          <Button size="icon" disabled>
            <PlusCircleIcon className="size-4" />
          </Button>

          <Button size="icon" variant="outline" disabled>
            <EllipsisVerticalIcon className="size-4" />
          </Button>
        </div>
      </div>
      <Separator />

      {/* Statistiques */}
      <Tabs>
        <ScrollArea>
          <div className="flex w-full">
            <Skeleton className="flex md:hidden h-9 w-full" />

            <TabsList className="md:flex hidden">
              {Array.from({ length: 5 }).map((_, index) => (
                <TabsTrigger
                  key={index}
                  value={index.toString()}
                  className="px-1 data-[state=active]:bg-background cursor-default"
                >
                  <Skeleton className="w-32 h-7" />
                </TabsTrigger>
              ))}
            </TabsList>
          </div>

          <ScrollBar orientation="horizontal" />
        </ScrollArea>
        {/* Desktop layout (unchanged) */}
        <Table className="w-full table-auto hidden md:table mt-2">
          <TableCaption>
            <div className="flex w-full justify-center">
              <Skeleton className="w-64 h-[14px]" />
            </div>
          </TableCaption>

          <TableHeader>
            <TableRow>
              <TableHead className="w-[50px] md:w-[200px]">
                <Skeleton className="w-full h-[18px]" />
              </TableHead>
              <TableHead className="w-[50px] md:w-[100px] text-center">
                <Skeleton className="w-full h-[18px]" />
              </TableHead>
              <TableHead>
                <Skeleton className="w-full h-[18px]" />
              </TableHead>
            </TableRow>
          </TableHeader>

          <TableBody>
            {Array.from({ length: 20 }, (_, i) => (
              <TableRow key={i}>
                <TableCell>
                  <Skeleton className="w-full h-[20px]" />
                </TableCell>
                <TableCell className="text-center font-semibold">
                  <Skeleton className="w-full h-[20px]" />
                </TableCell>
                <TableCell>
                  <Skeleton className="w-full h-[20px]" />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>

        {/* Mobile layout */}
        <Table className="w-full table-auto md:hidden">
          <TableCaption>
            <div className="flex w-full justify-center">
              <Skeleton className="w-64 h-[14px]" />
            </div>
          </TableCaption>
          {/* No header on mobile */}
          <TableBody>
            {Array.from({ length: 20 }, (_, i) => i).map((item) => (
              <React.Fragment key={item}>
                {/* Subject + average row on mobile */}
                <TableRow className="border-b">
                  <TableCell className="w-full">
                    {/* Subject name skeleton */}
                    <Skeleton className="w-3/4 h-[20px] mb-1" />
                    {/* Mobile-only average skeleton */}
                    <Skeleton className="w-1/2 h-[14px]" />
                  </TableCell>
                </TableRow>

                {/* Notes row on mobile */}
                <TableRow className="border-b">
                  <TableCell className="w-full">
                    <div className="flex gap-2 flex-wrap pt-1 pb-2">
                      <Skeleton className="w-10 h-[20px]" />
                      <Skeleton className="w-10 h-[20px]" />
                      <Skeleton className="w-10 h-[20px]" />
                    </div>
                  </TableCell>
                </TableRow>
              </React.Fragment>
            ))}
          </TableBody>
        </Table>
      </Tabs>
    </main>
  );
}
