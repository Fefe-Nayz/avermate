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

export const CreateYearForm = () => {
    const formatter = useFormatter();
    const formatDates = useFormatDates(formatter);
    const errorTranslations = useTranslations("Errors");
    const toaster = useToast();
    const router = useRouter();

    const createYearSchema = z.object({
        name: z.string().min(1).max(32),
        dateRange: z
            .object({
                from: z.date({
                    required_error: "START_REQUIRED",
                }),
                to: z.date({
                    required_error: "END_REQUIRED",
                }),
            })
            .refine(
                (data) =>
                    isBefore(data.from, data.to) ||
                    data.from.getTime() === data.to.getTime(),
                {
                    message: "START_BEFORE_END",
                    path: ["to"],
                }
            ),
        defaultOutOf: z.coerce.number().min(0, "DEFAULT_OUT_OF_MIN").max(1000, "DEFAULT_OUT_OF_MAX"),
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
                title: "YEAR_CREATED_TITLE",
                description: "YEAR_CREATED_DESC",
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

    const form = useForm<CreateYearSchema>({
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
                    className="flex flex-col gap-8"
                >
                    {/* Name Field */}
                    <FormField
                        control={form.control}
                        name="name"
                        render={({ field }) => (
                            <FormItem className="mx-1">
                                <FormLabel>{"CREATE_YEAR_FORM_NAME_FIELD"}</FormLabel>
                                <FormControl>
                                    <Input
                                        type="text"
                                        placeholder={"CREATE_YEAR_FORM_NAME_FIELD_PLACEHOLDER"}
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
                        name="dateRange"
                        render={({ field }) => (
                            <FormItem className="mx-1">
                                <FormLabel>{"CREATE_YEAR_FORM_DATE_RANGE_FIELD"}</FormLabel>
                                <FormControl>
                                    <div className="flex flex-col gap-2">
                                        <Popover modal>
                                            <PopoverTrigger asChild>
                                                <Button
                                                    variant={"outline"}
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
                                                        <span>{"CREATE_YEAR_FORM_DATE_RANGE_FIELD_PLACEHOLDER"}</span>
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
                                <FormLabel>{"CREATE_YEAR_FORM_DEFAULT_OUT_OF_FIELD"}</FormLabel>
                                <FormControl>
                                    <Input
                                        type="number"
                                        placeholder={"20"}
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
                        {"CREATE_YEAR_FORM_SUBMIT"}
                    </Button>
                </form>
            </Form>
        </div>
    );
};
