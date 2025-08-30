"use client";

import { useId } from "react"

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

export default function YearWorkspaceSelect() {
    const id = useId();
    const { activeId, select, isPending, years } = useActiveYears();

    if (isPending) {
        return <Skeleton className="w-[200px] h-[56px] rounded-md" />;
    }

    if (years.length === 0) {
        return <div className="h-[56px]"></div>;
    }

    return (
        <div className="*:not-first:mt-2">
            <Select defaultValue={activeId} value={activeId} onValueChange={(id) => select(id)}>
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
                </SelectContent>
            </Select>
        </div>
    )
}
