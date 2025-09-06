"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { z } from "zod";
import dayjs from "dayjs";
import isSameOrAfter from "dayjs/plugin/isSameOrAfter";
import isSameOrBefore from "dayjs/plugin/isSameOrBefore";
import { Button } from "@/components/ui/button";
import { CalendarIcon } from "@heroicons/react/24/outline";
import { Calendar } from "@/components/ui/calendar";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
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
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { usePeriods } from "@/hooks/use-periods";
import { useSubjects } from "@/hooks/use-subjects";
import { useToast } from "@/hooks/use-toast";
import { apiClient } from "@/lib/api";
import { cn } from "@/lib/utils";
import { Grade } from "@/types/grade";
import { handleError } from "@/utils/error-utils";
import { useMediaQuery } from "../ui/use-media-query";
import { VisuallyHidden } from "@radix-ui/react-visually-hidden";
import { useTranslations } from "next-intl";
import { useFormatDates } from "@/utils/format";
import { useFormatter } from "next-intl";
import { useYears } from "@/hooks/use-years";
import { Check, ChevronsUpDown, Loader2Icon } from "lucide-react";
import { isEqual } from "lodash";
import FormContentWrapper from "./form-content-wrapper";

dayjs.extend(isSameOrAfter);
dayjs.extend(isSameOrBefore);
dayjs.locale("fr");

/** The same shape we used in the parent. */
const updateGradeSchema = z.object({
  name: z.string().min(1).max(64),
  outOf: z.number().min(0).max(1000),
  value: z.number().min(0).max(1000),
  coefficient: z.number().min(0).max(1000),
  passedAt: z.date(),
  subjectId: z.string().min(1).max(64),
  periodId: z.string().min(1).max(64).nullable(),
});
type UpdateGradeSchema = z.infer<typeof updateGradeSchema>;

interface UpdateGradeFormProps {
  gradeId: string;
  close: () => void;
  formData: UpdateGradeSchema;
  setFormData: React.Dispatch<React.SetStateAction<UpdateGradeSchema>>;
  yearId: string;
}

export function UpdateGradeForm({
  gradeId,
  close,
  formData,
  setFormData,
  yearId
}: UpdateGradeFormProps) {
  const errorTranslations = useTranslations("Errors");
  const t = useTranslations("Dashboard.Forms.UpdateGrade");
  const toaster = useToast();
  const queryClient = useQueryClient();
  const isDesktop = useMediaQuery("(min-width: 768px)");
  const formatter = useFormatter();
  const formatDates = useFormatDates(formatter);

  const [openPeriod, setOpenPeriod] = useState(false);
  const [openSubject, setOpenSubject] = useState(false);

  const periodInputRef = useRef<HTMLInputElement>(null);
  const subjectInputRef = useRef<HTMLInputElement>(null);

  const [periodInputValue, setPeriodInputValue] = useState("");
  const [subjectInputValue, setSubjectInputValue] = useState("");

  const { data: subjects } = useSubjects(yearId);

  const { data: periods } = usePeriods(yearId);

  const updateGradeSchema = z.object({
    name: z.string().min(1, t("nameRequired")).max(64, t("nameTooLong")),
    outOf: z.coerce.number().min(0, t("outOfMin")).max(1000, t("outOfMax")),
    value: z.coerce.number().min(0, t("valueMin")).max(1000, t("valueMax")),
    coefficient: z.coerce
      .number()
      .min(0, t("coefficientMin"))
      .max(1000, t("coefficientMax")),
    passedAt: z.date().min(0, t("passedAtRequired")),
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

  // This is how we pick an automatic period
  function determinePeriodId(date: Date | null | undefined, allPeriods: { id: string; name: string; startAt: string; endAt: string }[] | undefined) {
    if (!date || !allPeriods) return "";
    const d = dayjs(date);
    const matched = allPeriods.find(
      (p) => d.isSameOrAfter(dayjs(p.startAt)) && d.isSameOrBefore(dayjs(p.endAt))
    );
    return matched ? matched.id : "full-year";
  }

  const { mutate, isPending } = useMutation({
    mutationKey: ["update-grade", gradeId],
    mutationFn: async (vals: UpdateGradeSchema) => {
      // Convert "full-year" => null
      const payload = {
        ...vals,
        periodId: vals.periodId === "full-year" ? null : vals.periodId,
      };
      const res = await apiClient.patch(`grades/${gradeId}`, { json: payload });
      return (await res.json<{ grade: Grade }>()).grade;
    },
    onSuccess: () => {
      toaster.toast({
        title: t("successTitle"),
        description: t("successDescription"),
      });
      close();

    },
    onSettled() {
      queryClient.cancelQueries();
      queryClient.invalidateQueries({ queryKey: ["grades"] });
      queryClient.invalidateQueries({ queryKey: ["grade", gradeId] });
      queryClient.invalidateQueries({ queryKey: ["subjects"] });
      queryClient.invalidateQueries({ queryKey: ["subjects", "organized-by-periods"] });
      queryClient.invalidateQueries({ queryKey: ["recent-grades"] });
    },
    onError: (error) => {
      handleError(error, toaster, errorTranslations, t("updateError"));
    },
  });

  const { data: years } = useYears();
  const year = years?.find((y) => y.id === yearId);

  // Setup our form with parent's data
  const form = useForm({
    // @ts-ignore
    resolver: zodResolver(updateGradeSchema),
    defaultValues: formData,
  });

  // On mount, reset
  useEffect(() => {
    form.reset(formData);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Watch + sync
  const watchedValues = form.watch();
  useEffect(() => {
    if (!isEqual(watchedValues, formData)) {
      {/* @ts-ignore */}
      setFormData(watchedValues);
    }
  }, [watchedValues, formData, setFormData]);

  // Auto select period if date changes + user hasn't manually chosen
  const [isManualPeriod, setIsManualPeriod] = useState(false);
  const watchedPassedAt = useWatch({ control: form.control, name: "passedAt" });
  const [initialDate] = useState(formData.passedAt); // store original date

  useEffect(() => {
    if (
      watchedPassedAt &&
      initialDate &&
      watchedPassedAt.getTime() !== initialDate.getTime() &&
      !isManualPeriod &&
      periods
    ) {
      const matchedId = determinePeriodId(watchedPassedAt, periods);
      const current = form.getValues("periodId");
      if (matchedId !== current) {
        form.setValue("periodId", matchedId, { shouldValidate: true });
      }
    }
  }, [watchedPassedAt, periods, form, isManualPeriod, initialDate]);

  const onSubmit = (vals: UpdateGradeSchema) => {
    mutate(vals);
  };

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
          // className="flex flex-col gap-8"
        >
          <FormContentWrapper>
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
                      {/* @ts-ignore */}
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
                      {/* @ts-ignore */}
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
                      {/* @ts-ignore */}
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
                          variant="outline"
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
                            disabled={isPending}
                            onClick={() => setOpenPeriod(!openPeriod)}
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
                      <PopoverContent className="p-0 min-w-(--radix-popover-trigger-width)">
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
                            disabled={isPending}
                            onClick={() => setOpenPeriod(!openPeriod)}
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
                        <div className="mt-4 border-t p-4 overflow-scroll">
                          <Command>
                            <CommandInput
                              ref={periodInputRef}
                              autoFocus
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
                            disabled={isPending}
                            onClick={() => setOpenSubject(!openSubject)}
                          >
                            {selectedSubject
                              ? selectedSubject.name
                              : t("chooseSubject")}
                            <ChevronsUpDown className="opacity-50" />
                          </Button>
                        </PopoverTrigger>
                      </FormControl>
                      <PopoverContent className="p-0 min-w-(--radix-popover-trigger-width)">
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
                            disabled={isPending}
                            onClick={() => setOpenSubject(!openSubject)}
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
                        <div className="mt-4 border-t p-4 overflow-scroll">
                          <Command>
                            <CommandInput
                              ref={subjectInputRef}
                              autoFocus
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
          </FormContentWrapper>
        </form>
      </Form>
    </div>
  );
};
