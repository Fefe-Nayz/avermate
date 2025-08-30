"use client";

import { Year } from "@/types/year";
import { useEffect, useState } from "react";
import { useYears } from "./use-years";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";

export const useActiveYears = () => {
    const [active, setActive] = useState<Year | undefined>(undefined);
    const [isPending, setIsPending] = useState(true);
    const [isError, setIsError] = useState(false);
    const [years, setYears] = useState<Year[]>([]);
    const [activeId, setActiveId] = useState<string | undefined>(undefined);
    const router = useRouter();

    const { data, isPending: isFetchPending, isError: isFetchError } = useYears();

    useEffect(() => {
        setIsPending(isFetchPending);
        setIsError(isFetchError);
        setYears(data || []);

        if (data) {
            const status = getStatusFromLocalStorage();

            // If no selection
            if (status === "default") {
                const defaultActive = findDefaultActive(data);

                if (defaultActive) {
                    setActive(defaultActive);
                    saveIdToLocalStorage(defaultActive.id);
                    setActiveId(defaultActive.id);
                    saveStatusToLocalStorage("default");
                }
            }

            // If manual select
            if (status === "manual") {
                const manualActiveId = getIdFromLocalStorage();
                const manualActive = data.find((year) => year.id === manualActiveId);
                const defaultActive = findDefaultActive(data);

                // If deleted
                if (!manualActive) {
                    // Fallback to default

                    if (defaultActive) {
                        setActive(defaultActive);
                        saveIdToLocalStorage(defaultActive.id);
                        setActiveId(defaultActive.id);
                        saveStatusToLocalStorage("default");
                    }
                }

                // If manual active found
                if (manualActive) {
                    // If manual is default turn off manual
                    if (manualActive.id === defaultActive?.id && defaultActive) {
                        setActive(defaultActive);
                        saveIdToLocalStorage(defaultActive.id);
                        setActiveId(defaultActive.id);
                        saveStatusToLocalStorage("default");
                    }

                    setActive(manualActive);
                    saveIdToLocalStorage(manualActive.id);
                    setActiveId(manualActive.id);
                    saveStatusToLocalStorage("manual");
                }
            }
        }
    }, [data, isFetchPending, isFetchError]);

    // Si aucun years n'existe
    useEffect(() => {
        if (!isError && !isPending && data?.length === 0) {
            router.push("/onboarding");
        }
    }, [data, isPending, isError]);

    useEffect(() => {
        console.log(`Active ID: ${activeId}`);
    }, [activeId])

    function select(id: string) {
        const manualActive = years.find((year) => year.id === id);
        const defaultActive = findDefaultActive(years);

        if (!manualActive || manualActive.id === defaultActive?.id) {
            if (!defaultActive) return;
            setActive(defaultActive);
            saveIdToLocalStorage(defaultActive.id);
            setActiveId(defaultActive.id);
            saveStatusToLocalStorage("default");
            return;
        }

        setActive(manualActive);
        saveIdToLocalStorage(manualActive.id);
        setActiveId(manualActive.id);
        saveStatusToLocalStorage("manual");
    }

    function findDefaultActive(years: Year[]): Year | undefined {
        if (years.length === 0) return undefined;
        // Return the only year
        if (years.length === 1) return years[0];

        // Sort by start date desc
        const sortedYears = years.sort((a, b) => new Date(b.startDate).getTime() - new Date(a.startDate).getTime());

        // Get all years that we are in
        const currentYears = sortedYears.filter((year) => {
            const now = new Date();
            return new Date(year.startDate) <= now && new Date(year.endDate) >= now;
        });

        // Return the most recent start in current or the most recent started
        if (currentYears.length > 0) {
            return currentYears[0];
        } else {
            return sortedYears[0];
        }
    }

    function getIdFromLocalStorage() {
        return localStorage.getItem("active_year_id");
    }

    function saveIdToLocalStorage(id: string) {
        localStorage.setItem("active_year_id", id);
    }

    function getStatusFromLocalStorage() {
        return (localStorage.getItem("active_year_status") || "default") as "default" | "manual";
    }

    function saveStatusToLocalStorage(status: "default" | "manual") {
        localStorage.setItem("active_year_status", status);
    }

    return {
        active,
        activeId: activeId || getIdFromLocalStorage() || "none",
        select,
        years,
        isPending,
        isError
    };
}

