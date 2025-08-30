"use client";

import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Drawer,
  DrawerContent,
  DrawerTitle,
  DrawerTrigger,
} from "@/components/ui/drawer";
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
import { useMediaQuery } from "@/components/ui/use-media-query";
import { usePeriods } from "@/hooks/use-periods";
import { useSubjects } from "@/hooks/use-subjects";
import { useToast } from "@/hooks/use-toast";
import { apiClient } from "@/lib/api";
import { cn } from "@/lib/utils";
import { Grade } from "@/types/grade";
import { handleError } from "@/utils/error-utils";
import { CalendarIcon } from "@heroicons/react/24/outline";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import dayjs from "dayjs";
import "dayjs/locale/fr";
import isSameOrAfter from "dayjs/plugin/isSameOrAfter";
import isSameOrBefore from "dayjs/plugin/isSameOrBefore";
import { Check, ChevronsUpDown, Loader2Icon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { z } from "zod";
import { Calendar } from "../ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "../ui/popover";
import { VisuallyHidden } from "@radix-ui/react-visually-hidden";
import { useTranslations } from "next-intl";
import { useFormatDates } from "@/utils/format";
import { useFormatter } from "next-intl";
import { useYears } from "@/hooks/use-years";

dayjs.extend(isSameOrAfter);
dayjs.extend(isSameOrBefore);

dayjs.locale("fr");

export const UpdateGradeForm = ({
  close,
  grade,
}: {
  close: () => void;
  grade: Grade;
  }) => {
  const formatter = useFormatter();
  const formatDates = useFormatDates(formatter);

  const errorTranslations = useTranslations("Errors");
  const t = useTranslations("Dashboard.Forms.UpdateGrade");
  const toaster = useToast();
  const queryClient = useQueryClient();
  const isDesktop = useMediaQuery("(min-width: 768px)");

  const [openPeriod, setOpenPeriod] = useState(false);
  const [openSubject, setOpenSubject] = useState(false);

  const periodInputRef = useRef<HTMLInputElement>(null);
  const subjectInputRef = useRef<HTMLInputElement>(null);

  const [periodInputValue, setPeriodInputValue] = useState("");
  const [subjectInputValue, setSubjectInputValue] = useState("");

  // Track if period was manually selected
  const [isManualPeriod, setIsManualPeriod] = useState(false);

  // Store initial date so we only apply date->period logic after date changes
  const [initialDate] = useState(grade.passedAt);

  const { data: subjects } = useSubjects(grade.yearId);

  const { data: periods } = usePeriods(grade.yearId);

  // Feedback schema validation
  const updateGradeSchema = z.object({
    name: z.string().min(1, t("nameRequired")).max(64, t("nameTooLong")),
    outOf: z.coerce.number().min(0, t("outOfMin")).max(1000, t("outOfMax")),
    value: z.coerce.number().min(0, t("valueMin")).max(1000, t("valueMax")),
    coefficient: z.coerce
      .number()
      .min(0, t("coefficientMin"))
      .max(1000, t("coefficientMax")),
    passedAt: z.date({ required_error: t("passedAtRequired") }),
    subjectId: z
      .string()
      .min(1, t("subjectIdRequired"))
      .max(64, t("subjectIdMax")),
    periodId: z
      .string()
      .min(1, t("periodIdRequired"))
      .max(64, t("periodIdMax"))
      .nullable(),
  });

  type UpdateGradeSchema = z.infer<typeof updateGradeSchema>;

  const determinePeriodId = (
    date: Date | null | undefined,
    periods:
      | { id: string; name: string; startAt: string; endAt: string }[]
      | undefined
  ) => {
    if (!date || !periods) return "";
    const formattedDate = dayjs(date);
    const matchedPeriod = periods.find(
      (period) =>
        formattedDate.isSameOrAfter(dayjs(period.startAt)) &&
        formattedDate.isSameOrBefore(dayjs(period.endAt))
    );
    return matchedPeriod ? matchedPeriod.id : "full-year";
  };

  const { mutate, isPending } = useMutation({
    mutationKey: ["update-grade"],
    mutationFn: async (values: UpdateGradeSchema) => {
      const payload = {
        ...values,
        periodId: values.periodId === "full-year" ? null : values.periodId,
      };
      const res = await apiClient.patch(`grades/${grade.id}`, {
        json: payload,
      });
      const data = await res.json<{ grade: Grade }>();
      return data.grade;
    },
    onSuccess: () => {
      toaster.toast({
        title: t("successTitle"),
        description: t("successDescription"),
      });
      close();
      queryClient.invalidateQueries({ queryKey: ["grades"] });
      queryClient.invalidateQueries({ queryKey: ["grade", grade.id] });
      queryClient.invalidateQueries({ queryKey: ["subjects"] });
      queryClient.invalidateQueries({ queryKey: ["recent-grades"] });
    },
    onError: (error) => {
      handleError(error, toaster, errorTranslations, t("updateError"));
    },
  });

  const { data: years } = useYears();
  const year = years?.find((y) => y.id === grade?.yearId);

  const form = useForm<UpdateGradeSchema>({
    resolver: zodResolver(updateGradeSchema),
    defaultValues: {
      name: grade.name,
      outOf: grade.outOf / 100,
      value: grade.value / 100,
      coefficient: grade.coefficient / 100,
      passedAt: new Date(grade.passedAt),
      subjectId: grade.subjectId,
      periodId: grade.periodId === null ? "full-year" : grade.periodId,
    },
  });

  const watchedPassedAt = useWatch({ control: form.control, name: "passedAt" });

  // When the date changes, if not manually selected and if actually changed from initial, update the periodId
  useEffect(() => {
    if (
      watchedPassedAt &&
      initialDate &&
      new Date(watchedPassedAt).getTime() !== new Date(initialDate).getTime() &&
      !isManualPeriod &&
      periods
    ) {
      const matchedPeriodId = determinePeriodId(watchedPassedAt, periods);
      const currentPeriodId = form.getValues("periodId");

      if (matchedPeriodId !== currentPeriodId) {
        form.setValue("periodId", matchedPeriodId, { shouldValidate: true });
      }
    }
  }, [watchedPassedAt, periods, form, isManualPeriod, initialDate]);

  useEffect(() => {
    if (!isDesktop && openPeriod) {
      setTimeout(() => periodInputRef.current?.focus(), 350);
    }
  }, [openPeriod, isDesktop]);

  useEffect(() => {
    if (!isDesktop && openSubject) {
      setTimeout(() => subjectInputRef.current?.focus(), 350);
    }
  }, [openSubject, isDesktop]);

  const selectedPeriodValue = form.getValues("periodId");
  const selectedPeriod =
    selectedPeriodValue && selectedPeriodValue !== "full-year"
      ? periods?.find((p) => p.id === selectedPeriodValue)
      : null;

  const selectedSubject = subjects?.find(
    (subject) => subject.id === form.getValues("subjectId")
  );

  const onSubmit = (values: UpdateGradeSchema) => {
    mutate(values);
  };

  // Filter periods based on input
  const filteredPeriods = periods
    ?.filter((p) =>
      p.name.toLowerCase().includes(periodInputValue.toLowerCase())
    )
    .sort((a, b) => a.name.localeCompare(b.name));

  // Filter subjects based on input
  const filteredSubjects = subjects
    ?.filter(
      (subject) =>
        subject.isDisplaySubject === false &&
        subject.name.toLowerCase().includes(subjectInputValue.toLowerCase())
    )
    .sort((a, b) => a.name.localeCompare(b.name));

  // Update periodInputValue when popover/drawer opens
  useEffect(() => {
    if (openPeriod) {
      setPeriodInputValue(
        selectedPeriod?.name ||
          (selectedPeriodValue === "full-year" ? t("fullYear") : "")
      );
    }
  }, [openPeriod, selectedPeriod, selectedPeriodValue, t]);

  // Update subjectInputValue when popover/drawer opens
  useEffect(() => {
    if (openSubject) {
      setSubjectInputValue(selectedSubject?.name || "");
    }
  }, [openSubject, selectedSubject]);

  return (
    <div className="">
      <Form {...form}>
        <form
          noValidate
          onSubmit={form.handleSubmit(onSubmit)}
          className="flex flex-col gap-8"
        >
          {/* Name */}
          <FormField
            control={form.control}
            name="name"
            disabled={isPending}
            render={({ field }) => (
              <FormItem className="mx-1">
                <FormLabel>{t("name")}</FormLabel>
                <FormControl>
                  <Input type="text" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          {/* Responsive Combobox for Period */}
          <div className="grid grid-cols-2 gap-8">
            <FormField
              control={form.control}
              name="value"
              disabled={isPending}
              render={({ field }) => (
                <FormItem className="mx-1">
                  <FormLabel>{t("grade")}</FormLabel>
                  <FormControl>
                    <Input
                      type="number"
                      {...field}
                      onChange={(e) => field.onChange(e.target.value)}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="outOf"
              disabled={isPending}
              render={({ field }) => (
                <FormItem className="mx-1">
                  <FormLabel>{t("outOf")}</FormLabel>
                  <FormControl>
                    <Input
                      type="number"
                      {...field}
                      onChange={(e) => field.onChange(e.target.value)}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="coefficient"
              disabled={isPending}
              render={({ field }) => (
                <FormItem className="col-span-2 mx-1">
                  <FormLabel>{t("coefficient")}</FormLabel>
                  <FormControl>
                    <Input
                      type="number"
                      {...field}
                      onChange={(e) => field.onChange(e.target.value)}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>

          <FormField
            control={form.control}
            name="passedAt"
            render={({ field }) => (
              <FormItem className="flex flex-col mx-1">
                <FormLabel>{t("passedAt")}</FormLabel>
                <Popover modal>
                  <PopoverTrigger asChild>
                    <FormControl>
                      <Button
                        variant={"outline"}
                        className={cn(
                          "pl-3 text-left font-normal",
                          !field.value && "text-muted-foreground"
                        )}
                      >
                        {field.value
                          ? formatDates.formatLong(new Date(field.value))
                          : t("chooseDate")}
                        <CalendarIcon className="ml-auto h-4 w-4 opacity-50" />
                      </Button>
                    </FormControl>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0" align="center">
                    <Calendar
                      mode="single"
                      selected={field.value}
                      onSelect={(date) => {
                        field.onChange(date);
                        setIsManualPeriod(false);
                      }}
                      disabled={(date) =>
                        (year !== undefined && (date > new Date(year.endDate) || date < new Date(year.startDate)))
                      }
                      autoFocus
                      defaultMonth={field.value || (year !== undefined ? (new Date() > new Date(year?.endDate) ? new Date(year.endDate) : new Date()) : new Date())}
                    />
                  </PopoverContent>
                </Popover>
                <FormMessage />
              </FormItem>
            )}
          />

          {/* PeriodId Field */}
          <FormField
            control={form.control}
            name="periodId"
            render={({ field }) => (
              <FormItem className="flex flex-col mx-1">
                <FormLabel className="pointer-events-none">
                  {t("period")}
                </FormLabel>
                {isDesktop ? (
                  <Popover
                    modal
                    open={openPeriod}
                    onOpenChange={(isOpen) => setOpenPeriod(isOpen)}
                  >
                    <FormControl>
                      <PopoverTrigger asChild>
                        <Button
                          variant="outline"
                          role="combobox"
                          aria-expanded={openPeriod ? "true" : "false"}
                          className="justify-between"
                        >
                          {selectedPeriod
                            ? selectedPeriod.name
                            : selectedPeriodValue === "full-year"
                            ? t("fullYear")
                            : t("choosePeriod")}
                          <ChevronsUpDown className="opacity-50" />
                        </Button>
                      </PopoverTrigger>
                    </FormControl>
                    <PopoverContent className="p-0 min-w-[var(--radix-popover-trigger-width)]">
                      <Command>
                        <CommandInput
                          placeholder={t("choosePeriod")}
                          ref={periodInputRef}
                          value={periodInputValue}
                          onValueChange={setPeriodInputValue}
                          className="h-9"
                        />
                        <CommandList>
                          <CommandEmpty>{t("noPeriodFound")}</CommandEmpty>
                          <CommandGroup>
                            {filteredPeriods?.map((period) => (
                              <CommandItem
                                key={period.id}
                                value={period.name}
                                onSelect={() => {
                                  form.setValue("periodId", period.id, {
                                    shouldValidate: true,
                                  });
                                  setIsManualPeriod(true);
                                  setOpenPeriod(false);
                                }}
                              >
                                <span>{period.name}</span>
                                {form.getValues("periodId") === period.id && (
                                  <Check className="ml-auto h-4 w-4" />
                                )}
                              </CommandItem>
                            ))}
                            <CommandItem
                              key="full-year"
                              value={t("fullYear")}
                              onSelect={() => {
                                form.setValue("periodId", "full-year", {
                                  shouldValidate: true,
                                });
                                setIsManualPeriod(true);
                                setOpenPeriod(false);
                              }}
                            >
                              <span>{t("fullYear")}</span>
                              {form.getValues("periodId") === "full-year" && (
                                <Check className="ml-auto h-4 w-4" />
                              )}
                            </CommandItem>
                          </CommandGroup>
                        </CommandList>
                      </Command>
                    </PopoverContent>
                  </Popover>
                ) : (
                  <Drawer open={openPeriod} onOpenChange={setOpenPeriod}>
                    <DrawerTrigger asChild>
                      <FormControl>
                        <Button
                          variant="outline"
                          role="combobox"
                          aria-expanded={openPeriod ? "true" : "false"}
                          className="justify-between"
                        >
                          {selectedPeriod
                            ? selectedPeriod.name
                            : selectedPeriodValue === "full-year"
                            ? t("fullYear")
                            : t("choosePeriod")}
                          <ChevronsUpDown className="opacity-50" />
                        </Button>
                      </FormControl>
                    </DrawerTrigger>
                    <DrawerContent>
                      <VisuallyHidden>
                        <DrawerTitle>{t("choosePeriod")}</DrawerTitle>
                      </VisuallyHidden>
                      <div className="mt-4 border-t p-4">
                        <Command>
                          <CommandInput
                            ref={periodInputRef}
                            placeholder={t("choosePeriod")}
                            className="h-9"
                            onValueChange={setPeriodInputValue}
                            value={periodInputValue}
                          />
                          <CommandList>
                            <CommandEmpty>{t("noPeriodFound")}</CommandEmpty>
                            <CommandGroup>
                              {filteredPeriods?.map((period) => (
                                <CommandItem
                                  key={period.id}
                                  value={period.name}
                                  onSelect={() => {
                                    form.setValue("periodId", period.id, {
                                      shouldValidate: true,
                                    });
                                    setIsManualPeriod(true);
                                    setOpenPeriod(false);
                                  }}
                                >
                                  <span>{period.name}</span>
                                  {form.getValues("periodId") === period.id && (
                                    <Check className="ml-auto h-4 w-4" />
                                  )}
                                </CommandItem>
                              ))}
                              <CommandItem
                                key="full-year"
                                value={t("fullYear")}
                                onSelect={() => {
                                  form.setValue("periodId", "full-year", {
                                    shouldValidate: true,
                                  });
                                  setIsManualPeriod(true);
                                  setOpenPeriod(false);
                                }}
                              >
                                <span>{t("fullYear")}</span>
                                {form.getValues("periodId") === "full-year" && (
                                  <Check className="ml-auto h-4 w-4" />
                                )}
                              </CommandItem>
                            </CommandGroup>
                          </CommandList>
                        </Command>
                      </div>
                    </DrawerContent>
                  </Drawer>
                )}
                <FormMessage />
                <FormDescription>{t("periodDescription")}</FormDescription>
              </FormItem>
            )}
          />

          {/* Responsive Combobox for Subject */}
          <FormField
            control={form.control}
            name="subjectId"
            render={({ field }) => (
              <FormItem className="flex flex-col mx-1">
                <FormLabel>{t("subject")}</FormLabel>
                {isDesktop ? (
                  <Popover
                    modal
                    open={openSubject}
                    onOpenChange={(isOpen) => setOpenSubject(isOpen)}
                  >
                    <FormControl>
                      <PopoverTrigger asChild>
                        <Button
                          variant="outline"
                          role="combobox"
                          aria-expanded={openSubject ? "true" : "false"}
                          className="justify-between"
                        >
                          {selectedSubject
                            ? selectedSubject.name
                            : t("chooseSubject")}
                          <ChevronsUpDown className="opacity-50" />
                        </Button>
                      </PopoverTrigger>
                    </FormControl>
                    <PopoverContent className="p-0 min-w-[var(--radix-popover-trigger-width)]">
                      <Command>
                        <CommandInput
                          placeholder={t("chooseSubject")}
                          ref={subjectInputRef}
                          value={subjectInputValue}
                          onValueChange={setSubjectInputValue}
                          className="h-9"
                        />
                        <CommandList>
                          <CommandEmpty>{t("noSubjectFound")}</CommandEmpty>
                          <CommandGroup>
                            {filteredSubjects?.map((subject) => (
                              <CommandItem
                                key={subject.id}
                                value={subject.name}
                                onSelect={() => {
                                  form.setValue("subjectId", subject.id, {
                                    shouldValidate: true,
                                  });
                                  setOpenSubject(false);
                                }}
                              >
                                <span>{subject.name}</span>
                                {form.getValues("subjectId") === subject.id && (
                                  <Check className="ml-auto h-4 w-4" />
                                )}
                              </CommandItem>
                            ))}
                          </CommandGroup>
                        </CommandList>
                      </Command>
                    </PopoverContent>
                  </Popover>
                ) : (
                  <Drawer open={openSubject} onOpenChange={setOpenSubject}>
                    <DrawerTrigger asChild>
                      <FormControl>
                        <Button
                          variant="outline"
                          role="combobox"
                          aria-expanded={openSubject ? "true" : "false"}
                          className="justify-between"
                        >
                          {selectedSubject
                            ? selectedSubject.name
                            : t("chooseSubject")}
                          <ChevronsUpDown className="opacity-50" />
                        </Button>
                      </FormControl>
                    </DrawerTrigger>
                    <DrawerContent>
                      <VisuallyHidden>
                        <DrawerTitle>{t("chooseSubject")}</DrawerTitle>
                      </VisuallyHidden>
                      <div className="mt-4 border-t p-4">
                        <Command>
                          <CommandInput
                            ref={subjectInputRef}
                            placeholder={t("chooseSubject")}
                            className="h-9"
                            value={subjectInputValue}
                            onValueChange={setSubjectInputValue}
                          />
                          <CommandList>
                            <CommandEmpty>{t("noSubjectFound")}</CommandEmpty>
                            <CommandGroup>
                              {filteredSubjects?.map((subject) => (
                                <CommandItem
                                  key={subject.id}
                                  value={subject.name}
                                  onSelect={() => {
                                    form.setValue("subjectId", subject.id, {
                                      shouldValidate: true,
                                    });
                                    setOpenSubject(false);
                                  }}
                                >
                                  <span>{subject.name}</span>
                                  {form.getValues("subjectId") ===
                                    subject.id && (
                                    <Check className="ml-auto h-4 w-4" />
                                  )}
                                </CommandItem>
                              ))}
                            </CommandGroup>
                          </CommandList>
                        </Command>
                      </div>
                    </DrawerContent>
                  </Drawer>
                )}
                <FormMessage />
              </FormItem>
            )}
          />

          {/* Submit Button */}
          <Button className="w-full" type="submit" disabled={isPending}>
            {isPending && <Loader2Icon className="animate-spin mr-2 size-4" />}
            {t("submit")}
          </Button>
        </form>
      </Form>
    </div>
  );
};
