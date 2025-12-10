"use client";

import { CustomAveragesSection } from '@/app/profile/settings/custom-averages-section';
import { PeriodsSection } from '@/app/profile/settings/periods-section';
import DeleteYearSection from '@/components/dashboard/year-settings/delete-year-section';
import UpdateYearSection from '@/components/dashboard/year-settings/update-year-section';
import GradesSection from '@/components/dashboard/year-settings/grades-section';
import { Separator } from '@/components/ui/separator';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { useYears } from '@/hooks/use-years';
import { useActiveYearStore } from '@/stores/active-year-store';
import React from 'react'
import { useTranslations } from "next-intl";
import { Button } from '@/components/ui/button';
import { EllipsisVerticalIcon, PlusCircleIcon } from '@heroicons/react/24/outline';
import { Label } from '@/components/ui/label';
import { YearReviewButton } from '@/components/year-review/year-review-trigger';

export default function YearSettingsPage() {
    const { activeId } = useActiveYearStore();
    const { data: years } = useYears();
    const year = years?.find((year) => year.id === activeId);
    const t = useTranslations("Dashboard.Pages.YEAR_SETTINGS_PAGE");

    const showSkeleton = activeId === "none" || !year ;

    return (
        <main className="flex flex-col gap-4 md:gap-8 mx-auto max-w-[2000px]">
            <div className="flex flex-wrap items-center justify-between min-h-9">
                <h1 className="md:text-3xl font-bold text-xl">{t("YEAR_SETTINGS_PAGE_TITLE")}</h1>
            </div>

            <Separator />

            {showSkeleton ? (
                <div className="flex flex-col gap-4 md:gap-8">
                    {/* Update Year - Name */}
                    <Card className="w-full">
                        <div className="flex flex-col gap-6">
                            <CardHeader className="pb-0">
                                <div>
                                    <Skeleton className="w-36 h-6" />
                                </div>
                                <div>
                                    <Skeleton className="w-20 h-4" />
                                </div>
                            </CardHeader>

                            <CardContent className="p-0">
                                <div className="flex flex-col gap-4">
                                    <div className="px-6">
                                        <form>
                                            <div className="w-full">
                                                <Skeleton className="w-full h-8" />
                                            </div>
                                        </form>
                                    </div>
                                    <div className="flex justify-end border-t py-4 px-6">
                                        <Button type="submit" disabled>
                                            {t("save")}
                                        </Button>
                                    </div>
                                </div>
                            </CardContent>
                        </div>
                    </Card>

                    {/* Update Year - Default Out Of */}
                    <Card className="w-full">
                        <div className="flex flex-col gap-6">
                            <CardHeader className="pb-0">
                                <div>
                                    <Skeleton className="w-36 h-6" />
                                </div>
                                <div>
                                    <Skeleton className="w-20 h-4" />
                                </div>
                            </CardHeader>

                            <CardContent className="p-0">
                                <div className="flex flex-col gap-4">
                                    <div className="px-6">
                                        <form>
                                            <div className="w-full">
                                                <Skeleton className="w-full h-8" />
                                            </div>
                                        </form>
                                    </div>
                                    <div className="flex justify-end border-t py-4 px-6">
                                        <Button type="submit" disabled>
                                            {t("save")}
                                        </Button>
                                    </div>
                                </div>
                            </CardContent>
                        </div>
                    </Card>

                    {/* Update Year - Date Range */}
                    <Card className="w-full">
                        <div className="flex flex-col gap-6">
                            <CardHeader className="pb-0">
                                <div>
                                    <Skeleton className="w-36 h-6" />
                                </div>
                                <div>
                                    <Skeleton className="w-20 h-4" />
                                </div>
                            </CardHeader>

                            <CardContent className="p-0">
                                <div className="flex flex-col gap-4">
                                    <div className="px-6">
                                        <form>
                                            <div className="w-full">
                                                <Skeleton className="w-full h-8" />
                                            </div>
                                        </form>
                                    </div>
                                    <div className="flex justify-end border-t py-4 px-6">
                                        <Button type="submit" disabled>
                                            {t("save")}
                                        </Button>
                                    </div>
                                </div>
                            </CardContent>
                        </div>
                    </Card>

                    {/* Periods Section */}
                    <Card className={"w-full"}>
                        <div className="flex flex-col gap-6">
                            <CardHeader className="pb-0">
                                <CardTitle>
                                    <Skeleton className="w-36 h-6" />
                                </CardTitle>
                                <div>
                                    <Skeleton className="w-20 h-4" />
                                </div>
                            </CardHeader>

                            <CardContent className="p-0">
                                <div className="flex flex-col gap-4">
                                    <div className="px-6 grid gap-4">
                                        {Array.from({ length: 3 }).map((_, index) => (
                                            <div
                                                key={index}
                                                className="bg-card text-card-foreground flex gap-6 rounded-xl border shadow-sm flex-row p-4 justify-between items-start"
                                            >
                                                <div className="flex flex-col gap-1 w-full">
                                                    <span>
                                                        <Skeleton className="w-full md:w-64 h-6" />
                                                    </span>
                                                    <span className="text-muted-foreground text-sm">
                                                        <Skeleton className="w-full md:w-32 h-4" />
                                                    </span>
                                                </div>
                                                <div>
                                                    <Button size="icon" variant="outline" disabled>
                                                        <EllipsisVerticalIcon className="size-4" />
                                                    </Button>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                    <div className="flex justify-end border-t py-4 px-6">
                                            <Button disabled>
                                                <PlusCircleIcon className="size-4 mr-2" />
                                            {t("addPeriod")}
                                            </Button>
                                    </div>
                                </div>
                            </CardContent>
                        </div>
                    </Card>

                    {/* Custom Averages Section */}
                    <Card className={"w-full"}>
                        <div className="flex flex-col gap-6">
                            <CardHeader className="pb-0">
                                <CardTitle>
                                    <Skeleton className="w-36 h-6" />
                                </CardTitle>
                                <div>
                                    <Skeleton className="w-20 h-4" />
                                </div>
                            </CardHeader>

                            <CardContent className="p-0">
                                <div className="flex flex-col gap-4">
                                    <div className="px-6 grid gap-4">
                                        {Array.from({ length: 1 }).map((_, index) => (
                                            <div
                                                key={index}
                                                className="bg-card text-card-foreground flex gap-6 rounded-xl border shadow-sm flex-row p-4 justify-between items-start"
                                            >
                                                <div className="flex flex-col gap-1 w-full">
                                                    <Label>
                                                        <Skeleton className="w-full md:w-64 h-6" />
                                                    </Label>
                                                    <span className="text-muted-foreground text-sm">
                                                        <Skeleton className="w-full md:w-32 h-4" />
                                                    </span>
                                                </div>
                                                <div>
                                                    <Button size="icon" variant="outline" disabled>
                                                        <EllipsisVerticalIcon className="size-4" />
                                                    </Button>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                    <div className="flex justify-end border-t py-4 px-6">
                                            <Button disabled>
                                                <PlusCircleIcon className="size-4 mr-2" />
                                                {t("addCustomAverage")}
                                            </Button>
                                    </div>
                                </div>
                            </CardContent>
                        </div>
                    </Card>

                    {/* Grades Section */}
                    <Card className="w-full">
                        <div className="flex flex-col gap-6">
                            <CardHeader className="pb-0">
                                <CardTitle>
                                    <Skeleton className="w-44 h-6" />
                                </CardTitle>
                                <CardDescription>
                                    <Skeleton className="w-72 h-4" />
                                </CardDescription>
                            </CardHeader>
                            <div className="justify-end flex rounded-b-xl px-6 py-4 border-t">
                                <Button disabled>
                                    <PlusCircleIcon className="size-4 mr-2" />
                                    {t("GRADES_SECTION_BUTTON")}
                                </Button>
                            </div>
                        </div>
                    </Card>
                    {/* Delete Year Section */}
                    <Card className="w-full border-destructive/40">
                        <div className="flex flex-col gap-6">
                            <CardHeader className="pb-0">
                                <CardTitle>
                                    <Skeleton className="w-44 h-6" />
                                </CardTitle>
                                <CardDescription>
                                    <Skeleton className="w-72 h-4" />
                                </CardDescription>
                            </CardHeader>
                            <div className="justify-end flex rounded-b-xl px-6 py-4 border-t border-destructive/30 bg-destructive/10">
                                <Button disabled variant="destructive">{t("DELETE_YEAR_DIALOG_OPEN_BUTTON")}</Button>
                            </div>
                        </div>
                    </Card>
                </div>
            ) : (
                <>
                    <UpdateYearSection yearId={activeId} />
                    <PeriodsSection yearId={activeId} />
                    <CustomAveragesSection yearId={activeId} />
                    <GradesSection yearId={activeId} />
                    <DeleteYearSection yearId={activeId} />
                </>
            )}
             <div className="mb-8">
                <YearReviewButton />
            </div>
        </main>
    )
}
