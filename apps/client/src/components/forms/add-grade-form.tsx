"use client";

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
dayjs.extend(isSameOrAfter);
dayjs.extend(isSameOrBefore);

import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
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
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { usePeriods } from "@/hooks/use-periods";
import { useSubjects } from "@/hooks/use-subjects";
import { useToast } from "@/hooks/use-toast";
import { apiClient } from "@/lib/api";
import { cn } from "@/lib/utils";
import { handleError } from "@/utils/error-utils";
import { useMediaQuery } from "../ui/use-media-query";
import { VisuallyHidden } from "@radix-ui/react-visually-hidden";
import { useTranslations } from "next-intl";
import { useFormatDates } from "@/utils/format";
import { useFormatter } from "next-intl";

dayjs.locale("fr");

export const AddGradeForm = ({
  close,
  parentId,
}: {
  close: () => void;
  parentId?: string;
}) => {
  const formatter = useFormatter();
  const formatDates = useFormatDates(formatter);

  const errorTranslations = useTranslations("Errors");
  const t = useTranslations("Dashboard.Forms.AddGrade");
  const toaster = useToast();
  const queryClient = useQueryClient();
  const isDesktop = useMediaQuery("(min-width: 768px)");

  // States for controlling the open/close of our responsive comboboxes
  const [openPeriod, setOpenPeriod] = useState(false);
  const [openSubject, setOpenSubject] = useState(false);

  // Flag to track manual selection of period
  const [isManualPeriod, setIsManualPeriod] = useState(false);

  // Queries
  const { data: subjects } = useSubjects();

  const { data: periods } = usePeriods();

  // Schema
  const addGradeSchema = z.object({
    name: z.string().min(1, t("nameRequired")).max(64, t("nameTooLong")),
    outOf: z.coerce.number().min(0, t("outOfMin")).max(1000, t("outOfMax")),
    value: z.coerce.number().min(0, t("valueMin")).max(1000, t("valueMax")),
    coefficient: z.coerce
      .number()
      .min(0, t("coefficientMin"))
      .max(1000, t("coefficientMax")),
    passedAt: z.date(),
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

  type AddGradeSchema = z.infer<typeof addGradeSchema>;

  const determinePeriodId = (
    date: string | number | Date | dayjs.Dayjs | null | undefined,
    periods: any[] | undefined
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

  // Mutation to create a grade
  const { mutate, isPending } = useMutation({
    mutationKey: ["create-grade"],
    mutationFn: async ({
      name,
      outOf,
      value,
      coefficient,
      passedAt,
      subjectId,
      periodId,
    }: AddGradeSchema) => {
      const res = await apiClient.post("grades", {
        json: {
          name,
          value,
          outOf,
          coefficient,
          passedAt,
          subjectId,
          periodId,
        },
      });
      const data = await res.json();
      return data;
    },
    onSuccess: () => {
      toaster.toast({
        title: t("successTitle"),
        description: t("successDescription"),
      });
      close();
      queryClient.invalidateQueries({ queryKey: ["grades"] });
      queryClient.invalidateQueries({ queryKey: ["subjects"] });
    },
    onError: (error) => {
      handleError(error, toaster, errorTranslations, t("errorAddingGrade"));
    },
  });

  const form = useForm<AddGradeSchema>({
    resolver: zodResolver(addGradeSchema),
    defaultValues: {
      name: "",
      subjectId: parentId || "",
    },
  });

  // Watch the `passedAt` field
  const watchedPassedAt = useWatch({ control: form.control, name: "passedAt" });

  // Automatically set the periodId when passedAt changes, unless manually changed
  useEffect(() => {
    if (!isManualPeriod && watchedPassedAt && periods) {
      const matchedPeriodId = determinePeriodId(watchedPassedAt, periods);
      const currentPeriodId = form.getValues("periodId");

      if (matchedPeriodId !== currentPeriodId) {
        form.setValue("periodId", matchedPeriodId, { shouldValidate: true });
      }
    }
  }, [watchedPassedAt, periods, form, isManualPeriod]);

  const selectedPeriod = periods?.find(
    (period) => period.id === form.getValues("periodId")
  );
  const selectedSubject = subjects?.find(
    (subject) => subject.id === form.getValues("subjectId")
  );

  const onSubmit = (values: AddGradeSchema) => {
    const processedValues = {
      ...values,
      periodId: values.periodId === "full-year" ? null : values.periodId,
    };
    mutate(processedValues);
  };

  const periodInputRef = useRef<HTMLInputElement>(null);
  const subjectInputRef = useRef<HTMLInputElement>(null);

  // Focus the CommandInput inside the Drawer whenever it opens
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

  return (
    <div>
      <Form {...form}>
        <form
          onSubmit={form.handleSubmit(onSubmit)}
          className="flex flex-col gap-8"
          noValidate
        >
          {/* Nom de la note */}
          <FormField
            control={form.control}
            name="name"
            disabled={isPending}
            render={({ field }) => (
              <FormItem className="mx-1">
                <FormLabel>{t("gradeName")}</FormLabel>
                <FormControl>
                  <Input
                    type="text"
                    placeholder={t("gradeNamePlaceholder")}
                    {...field}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          {/* Note, Sur, et Coefficient */}
          <div className="grid grid-cols-2 gap-8">
            <FormField
              control={form.control}
              name="value"
              disabled={isPending}
              render={({ field }) => (
                <FormItem className="mx-1">
                  <FormLabel>{t("gradeValue")}</FormLabel>
                  <FormControl>
                    <Input
                      type="number"
                      placeholder={t("gradeValuePlaceholder")}
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
                  <FormLabel>{t("gradeOutOf")}</FormLabel>
                  <FormControl>
                    <Input
                      type="number"
                      placeholder={t("gradeOutOfPlaceholder")}
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
                  <FormLabel>{t("gradeCoefficient")}</FormLabel>
                  <FormControl>
                    <Input
                      type="number"
                      placeholder={t("gradeCoefficientPlaceholder")}
                      {...field}
                      onChange={(e) => field.onChange(e.target.value)}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>

          {/* Date (Calendar) */}
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
                        console.log(date);
                        field.onChange(date);
                        setIsManualPeriod(false); // Reset manual period selection
                      }}
                      disabled={(date) =>
                        date > new Date() || date < new Date("2023-01-02")
                      }
                      autoFocus
                      defaultMonth={field.value || new Date()}
                    />
                  </PopoverContent>
                </Popover>
                <FormMessage />
              </FormItem>
            )}
          />

          {/* Responsive Combobox for Period */}
          <FormField
            control={form.control}
            name="periodId"
            render={({ field }) => (
              <FormItem className="flex flex-col mx-1">
                <FormLabel className="pointer-events-none">
                  {t("period")}
                </FormLabel>

                {isDesktop ? (
                  // Desktop: Popover
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
                          onClick={() => setOpenPeriod(!openPeriod)}
                        >
                          {selectedPeriod
                            ? selectedPeriod.name
                            : form.getValues("periodId") === "full-year"
                            ? t("fullYear")
                            : t("choosePeriod")}
                          <ChevronsUpDown className="opacity-50" />
                        </Button>
                      </PopoverTrigger>
                    </FormControl>
                    <PopoverContent
                      className="p-0 min-w-[var(--radix-popover-trigger-width)]"
                      align="center"
                    >
                      <Command>
                        <CommandInput
                          placeholder={t("choosePeriod")}
                          className="h-9"
                        />
                        <CommandList>
                          <CommandEmpty>{t("noPeriodFound")}</CommandEmpty>
                          <CommandGroup>
                            {periods?.map((period) => (
                              <CommandItem
                                key={period.id}
                                value={period.name}
                                onSelect={() => {
                                  form.setValue("periodId", period.id, {
                                    shouldValidate: true,
                                  });
                                  setIsManualPeriod(true); // Mark as manually selected
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
                                setIsManualPeriod(true); // Mark as manually selected
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
                  // Mobile: Drawer
                  <Drawer open={openPeriod} onOpenChange={setOpenPeriod}>
                    <DrawerTrigger asChild>
                      <FormControl>
                        <Button
                          variant="outline"
                          role="combobox"
                          aria-expanded={openPeriod ? "true" : "false"}
                          className="justify-between"
                          onClick={() => setOpenPeriod(!openPeriod)}
                        >
                          {selectedPeriod
                            ? selectedPeriod.name
                            : form.getValues("periodId") === "full-year"
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
                            autoFocus
                            placeholder={t("choosePeriod")}
                            className="h-9"
                          />
                          <CommandList>
                            <CommandEmpty>{t("noPeriodFound")}</CommandEmpty>
                            <CommandGroup>
                              {periods?.map((period) => (
                                <CommandItem
                                  key={period.id}
                                  value={period.name}
                                  onSelect={() => {
                                    form.setValue("periodId", period.id, {
                                      shouldValidate: true,
                                    });
                                    setIsManualPeriod(true); // Mark as manually selected
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
                                  setIsManualPeriod(true); // Mark as manually selected
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
                <FormLabel className="pointer-events-none">
                  {t("subject")}
                </FormLabel>

                {isDesktop ? (
                  // Desktop: Popover
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
                          onClick={() => setOpenSubject(!openSubject)}
                        >
                          {selectedSubject
                            ? selectedSubject.name
                            : t("chooseSubject")}
                          <ChevronsUpDown className="opacity-50" />
                        </Button>
                      </PopoverTrigger>
                    </FormControl>
                    <PopoverContent
                      className="p-0 min-w-[var(--radix-popover-trigger-width)]"
                      align="center"
                    >
                      <Command>
                        <CommandInput
                          placeholder={t("chooseSubject")}
                          className="h-9"
                        />
                        <CommandList>
                          <CommandEmpty>{t("noSubjectFound")}</CommandEmpty>
                          <CommandGroup>
                            {subjects
                              ?.filter(
                                (subject) => subject.isDisplaySubject === false
                              )
                              .slice()
                              .sort((a, b) => a.name.localeCompare(b.name))
                              .map((subject) => (
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
                    </PopoverContent>
                  </Popover>
                ) : (
                  // Mobile: Drawer
                  <Drawer open={openSubject} onOpenChange={setOpenSubject}>
                    <DrawerTrigger asChild>
                      <FormControl>
                        <Button
                          variant="outline"
                          role="combobox"
                          aria-expanded={openSubject ? "true" : "false"}
                          className="justify-between"
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
                      <div className="mt-4 border-t p-4">
                        <Command>
                          <CommandInput
                            ref={subjectInputRef}
                            autoFocus
                            placeholder={t("chooseSubject")}
                            className="h-9"
                          />
                          <CommandList>
                            <CommandEmpty>{t("noSubjectFound")}</CommandEmpty>
                            <CommandGroup>
                              {subjects
                                ?.filter(
                                  (subject) =>
                                    subject.isDisplaySubject === false
                                )
                                .slice()
                                .sort((a, b) => a.name.localeCompare(b.name))
                                .map((subject) => (
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

          {/* Submit button */}
          <Button className="w-full" type="submit" disabled={isPending}>
            {isPending && <Loader2Icon className="animate-spin mr-2 h-4 w-4" />}
            {t("submit")}
          </Button>
        </form>
      </Form>
    </div>
  );
};
