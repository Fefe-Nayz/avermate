"use client";

import { Year } from "@/types/year";
import { useEffect } from "react";
import { useYears } from "./use-years";
import { useRouter } from "next/navigation";
import { useActiveYearStore } from "@/stores/active-year-store";
import { useQueryClient } from "@tanstack/react-query";

export const useActiveYears = () => {
    const { setActiveId } = useActiveYearStore();
    const router = useRouter();
    const queryClient = useQueryClient();

    const { data, isPending, isError } = useYears();

    useEffect(() => {
        if (data) {
            const status = getStatusFromLocalStorage();

            // If no selection
            if (status === "default") {
                const defaultActive = findDefaultActive(data);

                if (defaultActive) {
                    saveIdToLocalStorage(defaultActive.id);
                    setActiveId(defaultActive.id);
                    saveStatusToLocalStorage("default");
                    return;
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
                        saveIdToLocalStorage(defaultActive.id);
                        setActiveId(defaultActive.id);
                        saveStatusToLocalStorage("default");
                        return;
                    }
                }

                // If manual active found
                if (manualActive) {
                    // If manual is default turn off manual
                    if (manualActive.id === defaultActive?.id && defaultActive) {
                        saveIdToLocalStorage(defaultActive.id);
                        setActiveId(defaultActive.id);
                        saveStatusToLocalStorage("default");
                        return;
                    }

                    saveIdToLocalStorage(manualActive.id);
                    setActiveId(manualActive.id);
                    saveStatusToLocalStorage("manual");
                    return;
                }
            }
        }
    }, [data, isPending, isError]);

    // Si aucun years n'existe
    useEffect(() => {
        if (!isError && !isPending && data?.length === 0) {
            router.push("/onboarding");
        }
    }, [data, isPending, isError]);

    function select(id: string) {
        const manualActive = data?.find((year) => year.id === id);
        const defaultActive = findDefaultActive(data || []);

        queryClient.cancelQueries();
        queryClient.clear();
        queryClient.invalidateQueries();

        if (!manualActive || manualActive.id === defaultActive?.id) {
            if (!defaultActive) return;
            saveIdToLocalStorage(defaultActive.id);
            setActiveId(defaultActive.id);
            saveStatusToLocalStorage("default");
            return;
        }

        saveIdToLocalStorage(manualActive.id);
        setActiveId(manualActive.id);
        saveStatusToLocalStorage("manual");
        return;
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
        select,
        isPending,
        isError
    };
}

