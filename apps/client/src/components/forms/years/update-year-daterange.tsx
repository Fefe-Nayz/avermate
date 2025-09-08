"use client";

import { Button } from "@/components/ui/button";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { toast } from "sonner";
import { apiClient } from "@/lib/api";
import { handleError } from "@/utils/error-utils";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { isBefore } from "date-fns";
import { CalendarIcon, Loader2Icon } from "lucide-react";
import { useFormatter } from "next-intl";
import { useTranslations } from "next-intl";
import React from "react";
import { useForm } from "react-hook-form";
import * as z from "zod";
import { Calendar } from "@/components/ui/calendar";
import { useMediaQuery } from "@/components/ui/use-media-query";
import { useFormatDates } from "@/utils/format";
import { usePeriods } from "@/hooks/use-periods";
import { HTTPError } from "ky";

export function UpdateYearDateRangeForm({
    yearId,
    defaultFrom,
    defaultTo,
}: {
    yearId: string;
    defaultFrom?: Date;
    defaultTo?: Date;
}) {
    const errorTranslations = useTranslations("Errors");
    const t = useTranslations("Dashboard.Forms.UPDATE_YEAR_DATE_RANGE_FORM");
    const queryClient = useQueryClient();
    const formatter = useFormatter();
    const formatDates = useFormatDates(formatter);
    const numberOfMonths = useMediaQuery("(min-width: 1024px)") ? 2 : 1;

    const { data: periods } = usePeriods(yearId);

    const schema = z.object({
        dateRange: z
            .object({ from: z.date(), to: z.date() })
            .refine(
                (data) => isBefore(data.from, data.to) || data.from.getTime() === data.to.getTime(),
                { message: t("START_AFTER_END_ERROR"), path: ["to"] }
            ),
    });
    type Schema = z.infer<typeof schema>;

    const { mutate, isPending } = useMutation({
        mutationKey: ["update-year-dates", yearId],
        mutationFn: async ({ dateRange }: Schema) => {
            const res = await apiClient.patch(`years/${yearId}`, {
                json: { startDate: dateRange.from, endDate: dateRange.to },
            });
            return res.json();
        },
        onSuccess: () => {
            toast.success(t("TOAST_SUCCESS_TITLE"), {
                description: t("TOAST_SUCCESS_DESC"),
            });
        },
        onSettled: () => {
            queryClient.cancelQueries();
            queryClient.invalidateQueries({ queryKey: ["years"] });
            queryClient.invalidateQueries({ queryKey: ["periods"] });
            queryClient.invalidateQueries({ queryKey: ["subjects", "organized-by-periods"] });
        },
        onError: async (error) => {
            if (error instanceof HTTPError) {
                if (error.response.status === 400) {
                    const json = await error.response.json();
                    if (json?.code === "YEAR_START_AFTER_PERIOD_START_ERR") {
                        toast.error(t("TOAST_YEAR_START_AFTER_PERIOD_START_ERROR_TITLE"), {
                            description: t("TOAST_YEAR_START_AFTER_PERIOD_START_ERROR_DESCRIPTION"),
                        });

                        form.setError("dateRange", {
                            message: t("FIELD_YEAR_START_AFTER_PERIOD_START_ERROR"),
                        });

                        return;
                    }

                    if (json?.code === "YEAR_END_BEFORE_PERIOD_END_ERR") {
                        toast.error(t("TOAST_YEAR_END_BEFORE_PERIOD_END_ERROR_TITLE"), {
                            description: t("TOAST_YEAR_END_BEFORE_PERIOD_END_ERROR_DESCRIPTION"),
                        });

                        form.setError("dateRange", {
                            message: t("FIELD_YEAR_END_BEFORE_PERIOD_END_ERROR"),
                        });

                        return;
                    }
                }
            }

            handleError(error, errorTranslations, t("errorMessage", { default: "Update failed" }));
        },
    });

    const form = useForm<Schema>({
        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
        // @ts-ignore
        resolver: zodResolver(schema),
        defaultValues: {
            dateRange: {
                from: defaultFrom ?? undefined,
                to: defaultTo ?? undefined,
            },
        },
    });

    const onSubmit = (values: Schema) => mutate(values);

    // // Order periods by start date
    // const sortedPeriods = periods?.sort((a, b) => new Date(a.startAt).getTime() - new Date(b.startAt).getTime());
    // // Get the first period start and last period end
    // const firstPeriodStart = sortedPeriods?.[0].startAt;
    // const lastPeriodEnd = sortedPeriods?.[sortedPeriods.length - 1].endAt;

    return (
        <div className="flex flex-col gap-4">
            <div className="px-6">
                <Form {...form}>
                    <form onSubmit={form.handleSubmit(onSubmit)}>
                        <div className="w-full">
                            <FormField
                                control={form.control}
                                name="dateRange"
                                disabled={isPending}
                                render={({ field }) => (
                                    <FormItem>
                                        <FormControl>
                                            <div className="flex flex-col gap-2">
                                                <Popover modal>
                                                    <PopoverTrigger asChild>
                                                        <Button variant="outline" className={!field.value?.from ? "text-muted-foreground" : ""}>
                                                            {field.value?.from ? (
                                                                field.value.to ? (
                                                                    `${formatDates.formatIntermediate(field.value.from)} - ${formatDates.formatIntermediate(field.value.to)}`
                                                                ) : (
                                                                    formatDates.formatIntermediate(field.value.from)
                                                                )
                                                            ) : (
                                                                <span>{t("FIELD_PLACEHOLDER")}</span>
                                                            )}
                                                            <CalendarIcon className="ml-auto h-4 w-4 opacity-50" />
                                                        </Button>
                                                    </PopoverTrigger>
                                                    <PopoverContent className="w-auto p-0" align="center">
                                                        <Calendar
                                                            className="rounded-md"
                                                            excludeDisabled
                                                            mode="range"
                                                            selected={field.value}
                                                            onSelect={field.onChange}
                                                            numberOfMonths={numberOfMonths}
                                                            defaultMonth={field.value?.from || new Date()}
                                                        />
                                                    </PopoverContent>
                                                </Popover>
                                            </div>
                                        </FormControl>
                                        <FormMessage />
                                    </FormItem>
                                )}
                            />
                        </div>
                    </form>
                </Form>
            </div>
            <div className="flex justify-end border-t py-4 px-6">
                <Button type="submit" disabled={isPending} onClick={form.handleSubmit(onSubmit)}>
                    {isPending && <Loader2Icon className="animate-spin h-4 w-4 mr-2" />}
                    {t("SUBMIT_BUTTON_LABEL")}
                </Button>
            </div>
        </div>
    );
}

export default UpdateYearDateRangeForm;
