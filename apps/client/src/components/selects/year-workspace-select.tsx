"use client";

import { useEffect, useId } from "react"

import { useActiveYears } from "@/hooks/use-active-year";
import { Skeleton } from "../ui/skeleton";
import { formatDate } from "@/utils/format";
import { PlusIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useActiveYearStore } from "@/stores/active-year-store";
import { useYears } from "@/hooks/use-years";
import { useTranslations } from "next-intl";
import {
    SelectDrawer,
    SelectDrawerTrigger,
    SelectDrawerContent,
    SelectDrawerItem,
    SelectDrawerGroup,
    SelectDrawerSeparator
} from "@/components/ui/selectdrawer";
import { cn } from "@/lib/utils";
import { useIsMobile } from "@/hooks/use-mobile";

export default function YearWorkspaceSelect() {
    const id = useId();
    const { activeId } = useActiveYearStore();
    const { data: years, isPending } = useYears();
    const { select } = useActiveYears();

    const t = useTranslations("Dashboard.Buttons");

    const router = useRouter();
    const isMobile = useIsMobile();

    useEffect(() => {
        console.log("Active ID changed from select:", activeId);
    }, [activeId]);

    if (isPending || !activeId || !years) {
        return <Skeleton className="w-[200px] h-9 rounded-md" />;
    }

    if (years.length === 0) {
        return <div className="h-9"></div>;
    }

    return (
        <div>
            <SelectDrawer
                value={activeId}
                onValueChange={(value) => {
                    if (value === "new") return router.push("/onboarding?canBack=true");
                    if (value !== activeId) {
                        select(value);

                        if (window.location.pathname.startsWith("/dashboard/grades/")) {
                            router.push("/dashboard");
                        }

                        if (window.location.pathname.startsWith("/dashboard/subjects/")) {
                            router.push("/dashboard");
                        }
                    }
                }}
            >
                <SelectDrawerTrigger
                    className={cn(
                        "h-auto ps-2 text-left [&>span]:flex [&>span]:items-center [&>span]:gap-2"
                    )}
                    placeholder={t("SELECT_YEAR_PLACEHOLDER")}
                >
                    {years.find(year => year.id === activeId)?.name}
                </SelectDrawerTrigger>

                <SelectDrawerContent title={t("SELECT_YEAR_TITLE")} align="end">
                    <SelectDrawerGroup>
                        {years.map((year) => (
                            <SelectDrawerItem value={year.id} key={year.id}>
                                <span className="flex items-center gap-2 mr-2">
                                    <span className="mr-2">
                                        <span className="block font-medium">{year.name}</span>

                                        <span className="text-muted-foreground mt-0.5 block text-xs">
                                            {formatDate(new Date(year.startDate))} - {formatDate(new Date(year.endDate))}
                                        </span>
                                    </span>
                                </span>
                            </SelectDrawerItem>
                        ))}
                    </SelectDrawerGroup>

                    <SelectDrawerSeparator />

                    <SelectDrawerGroup>
                        {isMobile ? (
                            <Link
                                href="/onboarding?canBack=true"
                                className="flex items-center px-4 py-3 hover:bg-accent hover:text-accent-foreground rounded-md"
                            >
                                <PlusIcon className="size-4 mr-2 text-blue-600" />
                                <span className="block font-medium text-blue-600">
                                    {t("CREATE_YEAR_BUTTON_LABEL")}
                                </span>
                            </Link>
                        ) : (
                            <SelectDrawerItem value="new">
                                <div className="flex items-center text-blue-600">
                                    <PlusIcon className="size-4 mr-2 text-blue-600" />
                                    <span className="block font-medium">
                                        {t("CREATE_YEAR_BUTTON_LABEL")}
                                    </span>
                                </div>
                            </SelectDrawerItem>
                        )}
                    </SelectDrawerGroup>
                </SelectDrawerContent>
            </SelectDrawer>
        </div >
    )
}
