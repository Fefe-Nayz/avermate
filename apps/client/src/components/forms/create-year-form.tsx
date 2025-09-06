"use client";

import { Button } from "@/components/ui/button";
import {
    Form,
    FormControl,
    FormField,
    FormItem,
    FormLabel,
    FormMessage,
    FormDescription,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import {
    Popover,
    PopoverContent,
    PopoverTrigger,
} from "@/components/ui/popover";
import { useToast } from "@/hooks/use-toast";
import { apiClient } from "@/lib/api";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { isBefore } from "date-fns";
import { CalendarIcon, Loader2Icon } from "lucide-react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { Calendar } from "../ui/calendar";
import { useMediaQuery } from "../ui/use-media-query";
import { handleError } from "@/utils/error-utils";
import { useTranslations } from "next-intl";
import { useFormatDates } from "@/utils/format";
import { useFormatter } from "next-intl";
import { useRouter } from "next/navigation";
import { Year } from "@/types/year";
import FormContentWrapper from "./form-content-wrapper";

export const CreateYearForm = () => {
    const formatter = useFormatter();
    const formatDates = useFormatDates(formatter);
    const errorTranslations = useTranslations("Errors");
    const toaster = useToast();
    const router = useRouter();

    const t = useTranslations("Dashboard.Forms.CREATE_YEAR_FORM");

    const createYearSchema = z.object({
        name: z
            .string()
            .min(1, t("CREATE_YEAR_FORM_NAME_REQUIRED_ERROR"))
            .max(32, t("CREATE_YEAR_FORM_NAME_TOO_LONG_ERROR")),
        dateRange: z
            .object({
                from: z.date().min(1, t("CREATE_YEAR_FORM_START_REQUIRED_ERROR")),
                to: z.date().min(1, t("CREATE_YEAR_FORM_END_REQUIRED_ERROR")),
            })
            .refine(
                (data) =>
                    isBefore(data.from, data.to) ||
                    data.from.getTime() === data.to.getTime(),
                {
                    message: t("CREATE_YEAR_FORM_START_BEFORE_END_ERROR"),
                    path: ["to"],
                }
            ),
        defaultOutOf: z.coerce.number().min(0, t("CREATE_YEAR_FORM_OUT_OF_MIN_ERROR")).max(1000, t("CREATE_YEAR_FORM_OUT_OF_MAX_ERROR")),
    });

    type CreateYearSchema = z.infer<typeof createYearSchema>;

    const queryClient = useQueryClient();

    const { mutate, isPending } = useMutation({
        mutationKey: ["create-year"],
        mutationFn: async ({ name, dateRange, defaultOutOf }: CreateYearSchema) => {
            const res = await apiClient.post("years", {
                json: {
                    name,
                    startDate: dateRange.from,
                    endDate: dateRange.to,
                    defaultOutOf,
                },
            });

            const data = await res.json() as { year: Year };
            return data.year;
        },
        onSuccess: (data) => {
            toaster.toast({
                title: t("CREATE_YEAR_FORM_SUCCESS_TITLE"),
                description: t("CREATE_YEAR_FORM_SUCCESS_DESC"),
            });

            router.push(`/onboarding/${data.id}`);
        },
        onSettled: () => {
            queryClient.cancelQueries();
            queryClient.invalidateQueries({ queryKey: ["years"] });
        },
        onError: (error) => {
            handleError(error, toaster, errorTranslations, "YEAR_CREATE_FAILED");
        },
    });

    const numberOfMonths = useMediaQuery("(min-width: 1024px)") ? 2 : 1;

    const form = useForm({
        // @ts-ignore
        resolver: zodResolver(createYearSchema),
        defaultValues: {
            name: "",
            dateRange: {
                from: undefined,
                to: undefined,
            },
            defaultOutOf: 20,
        },
    });

    const onSubmit = (values: CreateYearSchema) => {
        mutate(values);
    };

    return (
        <div className="w-full">
            <Form {...form}>
                <form
                    noValidate
                    onSubmit={form.handleSubmit(onSubmit)}
                // className="flex flex-col gap-8"
                >
                    <FormContentWrapper>
                        {/* Name Field */}
                        <FormField
                            control={form.control}
                            disabled={isPending}
                            name="name"
                            render={({ field }) => (
                                <FormItem className="mx-1">
                                    <FormLabel>{t("CREATE_YEAR_FORM_NAME_FIELD_LABEL")}</FormLabel>
                                    <FormControl>
                                        <Input
                                            type="text"
                                            placeholder={t("CREATE_YEAR_FORM_NAME_FIELD_PLACEHOLDER")}
                                            {...field}
                                        />
                                    </FormControl>
                                    <FormMessage />
                                </FormItem>
                            )}
                        />

                        {/* Date Range Field */}
                        <FormField
                            control={form.control}
                            disabled={isPending}
                            name="dateRange"
                            render={({ field }) => (
                                <FormItem className="mx-1">
                                    <FormLabel>{t("CREATE_YEAR_FORM_DATE_RANGE_FIELD_LABEL")}</FormLabel>
                                    <FormControl>
                                        <div className="flex flex-col gap-2">
                                            <Popover modal>
                                                <PopoverTrigger asChild>
                                                    <Button
                                                        variant="outline"
                                                        className={
                                                            !field.value?.from ? "text-muted-foreground" : ""
                                                        }
                                                    >
                                                        {field.value?.from ? (
                                                            field.value.to ? (
                                                                `${formatDates.formatIntermediate(
                                                                    field.value.from
                                                                )} - ${formatDates.formatIntermediate(
                                                                    field.value.to
                                                                )}`
                                                            ) : (
                                                                formatDates.formatIntermediate(field.value.from)
                                                            )
                                                        ) : (
                                                            <span>{t("CREATE_YEAR_FORM_DATE_RANGE_FIELD_PLACEHOLDER")}</span>
                                                        )}

                                                        <CalendarIcon className="ml-auto h-4 w-4 opacity-50" />
                                                    </Button>
                                                </PopoverTrigger>
                                                <PopoverContent className="w-auto p-0" align="center">
                                                    <Calendar
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

                        <FormField
                            control={form.control}
                            name="defaultOutOf"
                            disabled={isPending}
                            render={({ field }) => (
                                <FormItem className="mx-1">
                                    <FormLabel>{t("CREATE_YEAR_FORM_OUT_OF_FIELD_LABEL")}</FormLabel>
                                    <FormControl>
                                        {/* @ts-ignore */}
                                        <Input
                                            type="number"
                                            placeholder={t("CREATE_YEAR_FORM_OUT_OF_FIELD_PLACEHOLDER")}
                                            {...field}
                                            onChange={(e) => field.onChange(e.target.value)}
                                        />
                                    </FormControl>
                                    <FormMessage />
                                </FormItem>
                            )}
                        />

                        {/* Submit Button */}
                        <Button className="w-full" type="submit" disabled={isPending}>
                            {isPending && <Loader2Icon className="animate-spin mr-2 h-4 w-4" />}
                            {t("CREATE_YEAR_FORM_SUBMIT_BUTTON_LABEL")}
                        </Button>
                    </FormContentWrapper>
                </form>
            </Form>
        </div>
    );
};
