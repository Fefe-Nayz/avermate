"use client";

import { Button } from "@/components/ui/button";
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
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
import { isEqual } from "lodash";
import React, { useEffect } from "react";
import FormContentWrapper from "./form-content-wrapper";

const updatePeriodSchema = z.object({
  name: z.string().min(1).max(64),
  dateRange: z
    .object({
      from: z.date(),
      to: z.date(),
    })
    .refine(
      (data) => isBefore(data.from, data.to) || data.from.getTime() === data.to.getTime(),
      { message: "Start date must be before end date", path: ["to"] }
    ),
  isCumulative: z.boolean().optional(),
});
type UpdatePeriodSchema = z.infer<typeof updatePeriodSchema>;

interface UpdatePeriodFormProps {
  close: () => void;
  periodId: string;
  periods: Period[];
  formData: UpdatePeriodSchema;
  setFormData: React.Dispatch<React.SetStateAction<UpdatePeriodSchema>>;
  yearId: string;
}

export const UpdatePeriodForm: React.FC<UpdatePeriodFormProps> = ({
  close,
  periodId,
  periods,
  formData,
  setFormData,
  yearId,
}) => {
  const errorTranslations = useTranslations("Errors");
  const t = useTranslations("Dashboard.Forms.UpdatePeriod");
  const toaster = useToast();
  const queryClient = useQueryClient();
  const formatDates = useFormatDates(useFormatter());
  const isDesktop = useMediaQuery("(min-width: 1024px)");

  const updatePeriodSchema = z.object({
    name: z.string().min(1, t("nameRequired")).max(64, t("nameTooLong")),
    dateRange: z
      .object({
        from: z.date().min(0, t("fromRequired")),
        to: z.date().min(0, t("toRequired")),

      })
      .refine(
        (data) =>
          isBefore(data.from, data.to) ||
          data.from.getTime() === data.to.getTime(),
        {
          message: t("dateRangeError"),
          path: ["to"],
        }
      ),
    isCumulative: z.boolean().optional(),
  });

  type UpdatePeriodSchema = z.infer<typeof updatePeriodSchema>;

  const { mutate, isPending } = useMutation({
    mutationKey: ["update-Period", periodId],
    mutationFn: async (vals: UpdatePeriodSchema) => {
      const res = await apiClient.patch(`periods/${periodId}`, {
        json: {
          name: vals.name,
          startAt: vals.dateRange.from,
          endAt: vals.dateRange.to,
          isCumulative: vals.isCumulative,
        },
      });
      const json = await res.json() as { period: Period };
      return json.period;
    },
    onSuccess: () => {
      toaster.toast({
        title: t("successTitle"),
        description: t("successDescription"),
      });

      close();
    },
    onSettled: () => {
      queryClient.cancelQueries();
      queryClient.invalidateQueries({ queryKey: ["periods", periodId] });
      queryClient.invalidateQueries({ queryKey: ["periods"] });
      queryClient.invalidateQueries({ queryKey: ["subjects", "organized-by-periods"] });
      queryClient.invalidateQueries({ queryKey: ["recent-grades"] });
      queryClient.invalidateQueries({ queryKey: ["grades"] });
    },
    onError: (error) => {
      handleError(error, toaster, errorTranslations, t("updateError"));
    },
  });

  const form = useForm<UpdatePeriodSchema>({
    // @ts-ignore
    resolver: zodResolver(updatePeriodSchema),
    defaultValues: formData,
  });

  const { data: years } = useYears();

  const year = years?.find((y) => y.id === yearId);

  // On mount, reset
  useEffect(() => {
    form.reset(formData);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Watch => sync
  const watchedValues = form.watch();
  useEffect(() => {
    if (!isEqual(watchedValues, formData)) {
      setFormData(watchedValues);
    }
  }, [watchedValues, formData, setFormData]);

  const onSubmit = (vals: UpdatePeriodSchema) => {
    // Overlap check
    const from = startOfDay(vals.dateRange.from);
    const to = startOfDay(vals.dateRange.to);

    const overlapping = periods.find((p) => {
      if (p.id === periodId) return false; // skip self
      const pStart = startOfDay(p.startAt);
      const pEnd = startOfDay(p.endAt);
      return (
        isWithinInterval(from, { start: pStart, end: pEnd }) ||
        isWithinInterval(to, { start: pStart, end: pEnd }) ||
        (pStart >= from && pEnd <= to)
      );
    });

    if (overlapping) {
      toaster.toast({ title: t("overlapTitle"), variant: "destructive" });
      return;
    }

    mutate(vals);
  };

  const numberOfMonths = isDesktop ? 2 : 1;

  return (
    <div className="">
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
                            ...periods.filter((p) => p.id !== periodId).map((period) => ({
                              from: startOfDay(period.startAt),
                              to: startOfDay(period.endAt),
                            }))]}
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
                        checked={field.value ?? false}
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
          </FormContentWrapper>
        </form>
      </Form>
    </div>
  );
};
