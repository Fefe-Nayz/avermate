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
import { Period } from "@/types/period";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { format, isBefore, isWithinInterval, startOfDay } from "date-fns";
import { CalendarIcon, Loader2Icon } from "lucide-react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { Calendar } from "../ui/calendar";
import { useMediaQuery } from "../ui/use-media-query";
import { handleError } from "@/utils/error-utils";
import { Switch } from "@/components/ui/switch";
import { useTranslations } from "next-intl";
import { useFormatDates } from "@/utils/format";
import { useFormatter } from "next-intl";
import { useYears } from "@/hooks/use-years";

export const AddPeriodForm = ({
  close,
  periods,
  yearId,
}: {
  close: () => void;
  periods: Period[];
  yearId: string;
}) => {
  const formatter = useFormatter();
  const formatDates = useFormatDates(formatter);
  const errorTranslations = useTranslations("Errors");
  const t = useTranslations("Dashboard.Forms.AddPeriod");
  const addPeriodSchema = z.object({
    name: z.string().min(1, t("nameRequired")).max(64, t("nameTooLong")),
    dateRange: z
      .object({
        from: z.date({
          required_error: t("startDateRequired"),
        }),
        to: z.date({
          required_error: t("endDateRequired"),
        }),
      })
      .refine(
        (data) =>
          isBefore(data.from, data.to) ||
          data.from.getTime() === data.to.getTime(),
        {
          message: t("startDateBeforeEndDate"),
          path: ["to"],
        }
      ),
    isCumulative: z.boolean().optional(),
  });

  type AddPeriodSchema = z.infer<typeof addPeriodSchema>;
  const toaster = useToast();
  const queryClient = useQueryClient();

  const { mutate, isPending } = useMutation({
    mutationKey: ["create-Period"],
    mutationFn: async ({ name, dateRange, isCumulative }: AddPeriodSchema) => {
      const res = await apiClient.post(`years/${yearId}/periods`, {
        json: {
          name,
          startAt: dateRange.from,
          endAt: dateRange.to,
          isCumulative,
        },
      });

      const data = await res.json();
      return data;
    },
    onSuccess: () => {
      toaster.toast({
        description: t("successDescription"),
      });

      close();
    },
    onSettled: () => {
      queryClient.cancelQueries();
      queryClient.invalidateQueries({ queryKey: ["periods"] });
      queryClient.invalidateQueries({ queryKey: ["subjects", "organized-by-periods"] });
      queryClient.invalidateQueries({ queryKey: ["recent-grades"] });
      queryClient.invalidateQueries({ queryKey: ["grades"] });
    },
    onError: (error) => {
      handleError(error, toaster, errorTranslations, t("errorAddingPeriod"));
    },
  });

  const numberOfMonths = useMediaQuery("(min-width: 1024px)") ? 2 : 1;

  const form = useForm<AddPeriodSchema>({
    resolver: zodResolver(addPeriodSchema),
    defaultValues: {
      name: "",
      dateRange: {
        from: undefined,
        to: undefined,
      },
      isCumulative: false,
    },
  });

  const { data: years } = useYears();

  const year = years?.find((y) => y.id === yearId);

  const onSubmit = (values: AddPeriodSchema) => {
    const { from: startAt, to: endAt } = values.dateRange;

    const normalizedStartAt = startOfDay(startAt);
    const normalizedEndAt = startOfDay(endAt);

    // Check overlap
    const overlappingPeriod = periods.find((period) => {
      const normalizedPeriodStartAt = startOfDay(period.startAt);
      const normalizedPeriodEndAt = startOfDay(period.endAt);

      return (
        isWithinInterval(normalizedStartAt, {
          start: normalizedPeriodStartAt,
          end: normalizedPeriodEndAt,
        }) ||
        isWithinInterval(normalizedEndAt, {
          start: normalizedPeriodStartAt,
          end: normalizedPeriodEndAt,
        }) ||
        (normalizedPeriodStartAt >= normalizedStartAt &&
          normalizedPeriodEndAt <= normalizedEndAt)
      );
    });

    if (overlappingPeriod) {
      toaster.toast({
        title: t("overlappingPeriods"),
        variant: "destructive",
      });
      return;
    }

    mutate(values);
  };

  return (
    <div className="">
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
                <FormLabel>{t("name")}</FormLabel>
                <FormControl>
                  <Input
                    type="text"
                    placeholder={t("namePlaceholder")}
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
                <FormLabel>{t("dateRange")}</FormLabel>
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
                            <span>{t("selectDateRange")}</span>
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
                          disabled={[{
                            from: year ? new Date(new Date(year?.startDate).getTime() - 10 * 365 * 24 * 60 * 60 * 1000) : undefined,
                            to: year ? new Date(new Date(year.startDate).getTime() - 24 * 60 * 60 * 1000) : undefined,
                          },
                          {
                            from: year ? new Date(new Date(year.endDate).getTime() + 24 * 60 * 60 * 1000) : undefined,
                            to: year ? new Date(new Date(year.endDate).getTime() + 10 * 365 * 24 * 60 * 60 * 1000) : undefined
                          },
                          ...periods.map((period) => ({
                            from: startOfDay(period.startAt),
                            to: startOfDay(period.endAt),
                          }))]}
                          defaultMonth={field.value.from || (year !== undefined ? (new Date() > new Date(year?.endDate) ? new Date(year.endDate) : new Date()) : new Date())}
                        />
                      </PopoverContent>
                    </Popover>
                  </div>
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          {/* isCumulative Switch Field */}
          <FormField
            control={form.control}
            name="isCumulative"
            render={({ field }) => (
              <FormItem className="mx-1">
                <div className="flex flex-row gap-4 items-center">
                  <FormLabel>{t("isCumulative")}</FormLabel>
                  <FormControl>
                    <Switch
                      checked={field.value}
                      onCheckedChange={field.onChange}
                    />
                  </FormControl>
                </div>
                <FormDescription>
                  {t("isCumulativeDescription")}
                </FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />

          {/* Submit Button */}
          <Button className="w-full" type="submit" disabled={isPending}>
            {isPending && <Loader2Icon className="animate-spin mr-2 h-4 w-4" />}
            {t("submit")}
          </Button>
        </form>
      </Form>
    </div>
  );
};
