"use client";

import { useEffect, useId } from "react"

import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select"
import { useActiveYears } from "@/hooks/use-active-year";
import { Skeleton } from "../ui/skeleton";
import { formatDate } from "@/utils/format";
import { PlusIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useActiveYearStore } from "@/stores/active-year-store";
import { useYears } from "@/hooks/use-years";
import {useTranslations} from "next-intl";

export default function YearWorkspaceSelect() {
    const id = useId();
    const { activeId } = useActiveYearStore();
    const { data: years, isPending } = useYears();
    const { select } = useActiveYears();

    const t = useTranslations("Dashboard.Buttons");

    const router = useRouter();

    useEffect(() => {
        console.log("Active ID changed from select:", activeId);
    }, [activeId]);

    if (isPending || !activeId || !years) {
        return <Skeleton className="w-[200px] h-[56px] rounded-md" />;
    }

    if (years.length === 0) {
        return <div className="h-[56px]"></div>;
    }

    return (
        <div className="*:not-first:mt-2">
            <Select defaultValue={activeId} value={activeId} onValueChange={(id) => {
                if (id === "new") return router.push("/onboarding");
                if (id !== activeId) {
                    select(id);

                    if (window.location.pathname.startsWith("/dashboard/grades/")) {
                        router.push("/dashboard");

                    }

                    if (window.location.pathname.startsWith("/dashboard/subjects/")) {
                        router.push("/dashboard");
                    }
                }
            }}>
                <SelectTrigger
                    id={id}
                    className="h-auto ps-2 text-left [&>span]:flex [&>span]:items-center [&>span]:gap-2 [&>span_img]:shrink-0"
                >
                    <SelectValue placeholder={"YEAR_SELECT_PLACEHOLDER"} />
                </SelectTrigger>

                <SelectContent className="[&_*[role=option]]:ps-2 [&_*[role=option]]:pe-8 [&_*[role=option]>span]:start-auto [&_*[role=option]>span]:end-2">
                    {years.map((year) => (
                        <SelectItem value={year.id} key={year.id}>
                            <span className="flex items-center gap-2 mr-2">
                                <span className="mr-2">
                                    <span className="block font-medium">{year.name}</span>

                                    <span className="text-muted-foreground mt-0.5 block text-xs">
                                        {formatDate(new Date(year.startDate))} - {formatDate(new Date(year.endDate))}
                                    </span>
                                </span>
                            </span>
                        </SelectItem>
                    ))}

                    <SelectItem value="new">
                        <div className="flex items-center text-blue-500">
                            <PlusIcon className="size-4 mr-2" />
                            <span className="block font-medium">{t("CREATE_YEAR_BUTTON_LABEL")}</span>
                        </div>
                    </SelectItem>
                </SelectContent>
            </Select>
        </div >
    )
}
