"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import dayjs from "dayjs";
import "dayjs/locale/fr";
import {
  Check,
  ChevronsUpDown,
  Loader2Icon,
  PlusCircle,
  Trash2,
} from "lucide-react";
import React, { useEffect, useRef, useState } from "react";
import { useFieldArray, useForm } from "react-hook-form";
import { z } from "zod";

import { Badge } from "@/components/ui/badge";
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
import { Switch } from "@/components/ui/switch";
import { useMediaQuery } from "@/components/ui/use-media-query";
import { useSubjects } from "@/hooks/use-subjects";
import { toast } from "sonner";
import { apiClient } from "@/lib/api";

import { handleError } from "@/utils/error-utils";
import { VisuallyHidden } from "@radix-ui/react-visually-hidden";
import { useTranslations } from "next-intl";
import { isEqual } from "lodash";
import { Average } from "@/types/average";
import { ScrollArea } from "../ui/scroll-area";
import FormContentWrapper from "./form-content-wrapper";

/**
 * Reuse your 'updateCustomAverageSchema' or define it similarly.
 * Must match the parent's shape to keep them in sync.
 */
const updateCustomAverageSchema = z.object({
  name: z.string().min(1),
  subjects: z.array(
    z.object({
      id: z.string().min(1),
      customCoefficient: z.number().min(1).max(1000).nullable().optional(),
      includeChildren: z.boolean().optional(),
    })
  ),
  isMainAverage: z.boolean().default(false).optional(),
});
type UpdateCustomAverageSchema = z.infer<typeof updateCustomAverageSchema>;

interface UpdateCustomAverageFormProps {
  close: () => void;
  averageId: string; // So we know which item to PATCH
  formData: UpdateCustomAverageSchema;
  setFormData: React.Dispatch<React.SetStateAction<UpdateCustomAverageSchema>>;
  yearId: string;
}

export const UpdateCustomAverageForm: React.FC<UpdateCustomAverageFormProps> = ({
  close,
  averageId,
  formData,
  setFormData,
  yearId,
}) => {
  const errorTranslations = useTranslations("Errors");
  const t = useTranslations("Dashboard.Forms.UpdateAverage");
  const queryClient = useQueryClient();
  const isDesktop = useMediaQuery("(min-width: 768px)");

  // Prepare our local form using parent's data
  const form = useForm({
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore
    resolver: zodResolver(updateCustomAverageSchema),
    defaultValues: formData,
  });

  // On mount, reset to parent's data
  useEffect(() => {
    form.reset(formData);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  console.log("from form", yearId)

  const { data: subjects } = useSubjects(yearId);

  // Watch everything so we can sync back up to the parent
  const watchedValues = form.watch();
  useEffect(() => {
    if (!isEqual(watchedValues, formData)) {
      setFormData(watchedValues);
    }
  }, [watchedValues, formData, setFormData]);

  // For handling multiple subject fields
  const { fields, append, remove } = useFieldArray({
    control: form.control,
    name: "subjects",
  });

  // Our mutation to update the average via PATCH
  const { mutate, isPending: isSubmitting } = useMutation({
    mutationKey: ["update-custom-average", averageId],
    mutationFn: async (vals: UpdateCustomAverageSchema) => {
      const res = await apiClient.patch(`averages/${averageId}`, {
        json: {
          name: vals.name,
          subjects: vals.subjects,
          isMainAverage: vals.isMainAverage,
        },
      });
      return res.json();
    },
    onSuccess: () => {
      toast.success(t("successTitle"), {
        description: t("successDescription"),
      });
      close();

    },
    onSettled: () => {
      queryClient.cancelQueries();
      queryClient.invalidateQueries({ queryKey: ["custom-averages"] });
      queryClient.invalidateQueries({
        queryKey: ["custom-averages", averageId],
      });
    },
    onError: (error: any) => {
      handleError(error, errorTranslations, t("updateError"));
    },
  });

  const onSubmit = (vals: UpdateCustomAverageSchema) => {
    const filtered = vals.subjects.filter((s) => s.id !== "");
    if (!filtered.length) {
      toast.error(t("errorTitle"), {
        description: t("selectAtLeastOneSubject"),
      });
      return;
    }
    mutate({ ...vals, subjects: filtered });
  };

  // Subject selection combos
  const [openSubjectIndex, setOpenSubjectIndex] = useState<number | null>(null);
  const subjectInputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (!isDesktop && openSubjectIndex !== null) {
      setTimeout(() => subjectInputRef.current?.focus(), 350);
    }
  }, [openSubjectIndex, isDesktop]);

  const setSubjectForIndex = (index: number, subjectId: string) => {
    form.setValue(`subjects.${index}.id`, subjectId, { shouldValidate: true });
    setOpenSubjectIndex(null);
  };

  // Renders the repeated subject row
  const renderSubjectField = (index: number, fieldItem: any) => {
    const selectedSubjectId = form.getValues(`subjects.${index}.id`);
    const selectedSubjectName = subjects?.find((s) => s.id === selectedSubjectId)?.name;

    return (
      <div
        key={fieldItem.id}
        className="flex flex-col gap-4 border p-4 rounded"
      >
        {/* Subject Selection */}
        <FormField
          control={form.control}
          name={`subjects.${index}.id`}
          render={({ field }) => (
            <FormItem className="flex flex-col gap-2">
              <FormLabel>{t("subject")}</FormLabel>
              {isDesktop ? (
                <Popover
                  modal
                  open={openSubjectIndex === index}
                  onOpenChange={(open) =>
                    setOpenSubjectIndex(open ? index : null)
                  }
                >
                  <FormControl>
                    <PopoverTrigger asChild>
                      <Button
                        variant="outline"
                        role="combobox"
                        aria-expanded={
                          openSubjectIndex === index ? "true" : "false"
                        }
                        className="justify-between w-full"
                        disabled={isSubmitting}
                      >
                        {selectedSubjectName || t("chooseSubject")}
                        <ChevronsUpDown className="opacity-50" />
                      </Button>
                    </PopoverTrigger>
                  </FormControl>
                  <PopoverContent className="p-0 min-w-(--radix-popover-trigger-width)">
                    <Command>
                      <CommandInput
                        placeholder={t("searchSubject")}
                        className="h-9"
                      />
                      <CommandList>
                        <CommandEmpty>{t("noSubjectFound")}</CommandEmpty>
                        <CommandGroup>
                          {subjects
                            ?.slice()
                            .sort((a, b) => a.name.localeCompare(b.name))
                            .map((subject) => (
                              <CommandItem
                                key={subject.id}
                                value={subject.name}
                                onSelect={() =>
                                  setSubjectForIndex(index, subject.id)
                                }
                              >
                                <span>{subject.name}</span>
                                {field.value === subject.id && (
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
                <>
                  <Drawer
                    open={openSubjectIndex === index}
                    onOpenChange={(open) =>
                      setOpenSubjectIndex(open ? index : null)
                    }
                  >
                    <DrawerTrigger asChild>
                      <FormControl>
                        <Button
                          variant="outline"
                          role="combobox"
                          aria-expanded={
                            openSubjectIndex === index ? "true" : "false"
                          }
                          className="justify-between w-full"
                          onClick={() => setOpenSubjectIndex(index)}
                          disabled={isSubmitting}
                        >
                          {selectedSubjectName || t("chooseSubject")}
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
                            placeholder={t("searchSubject")}
                            className="h-9"
                            autoFocus
                          />
                          <CommandList>
                            <CommandEmpty>{t("noSubjectFound")}</CommandEmpty>
                            <CommandGroup>
                              {subjects
                                ?.slice()
                                .sort((a, b) => a.name.localeCompare(b.name))
                                .map((subject) => (
                                  <CommandItem
                                    key={subject.id}
                                    value={subject.name}
                                    onSelect={() =>
                                      setSubjectForIndex(index, subject.id)
                                    }
                                  >
                                    <span>{subject.name}</span>
                                    {field.value === subject.id && (
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
                </>
              )}
              <FormMessage />
            </FormItem>
          )}
        />

        {/* Custom Coefficient */}
        <FormField
          control={form.control}
          name={`subjects.${index}.customCoefficient`}
          render={({ field }) => (
            <FormItem className="flex flex-col gap-2">
              <FormLabel>
                {t("customCoefficient")}{" "}
                <Badge className="ml-2">{t("optional")}</Badge>
              </FormLabel>
              <FormControl>
                <Input
                  type="number"
                  placeholder={t("customCoefficientPlaceholder")}
                  min={1}
                  max={1000}
                  value={field.value ?? ""}
                  onChange={(e) =>
                    field.onChange(
                      e.target.value === "" ? null : Number(e.target.value)
                    )
                  }
                  disabled={isSubmitting}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        {/* Include Children */}
        <FormField
          control={form.control}
          name={`subjects.${index}.includeChildren`}
          render={({ field }) => (
            <FormItem className="flex flex-row items-center gap-4">
              <FormLabel>{t("includeChildren")}</FormLabel>
              <FormControl>
                <Switch
                  checked={field.value ?? false}
                  onCheckedChange={field.onChange}
                  disabled={isSubmitting}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        {/* Remove subject button if more than one subject */}
        {fields.length > 1 && (
          <Button
            type="button"
            variant="destructive"
            size="sm"
            onClick={() => remove(index)}
            disabled={isSubmitting}
            className="mt-2"
          >
            <Trash2 className="h-4 w-4 mr-2" />
            {t("removeSubject")}
          </Button>
        )}
      </div>
    );
  };

  return (
    <div>
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
              render={({ field }) => (
                <FormItem className="mx-1">
                  <FormLabel>{t("averageName")}</FormLabel>
                  <FormControl>
                    <Input
                      type="text"
                      placeholder={t("averageNamePlaceholder")}
                      {...field}
                      disabled={isSubmitting}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* isMainAverage Switch */}
            <FormField
              control={form.control}
              name="isMainAverage"
              render={({ field }) => (
                <FormItem className="mx-1 flex flex-row items-center gap-4">
                  <FormLabel>{t("displayOnMainPage")}</FormLabel>
                  <FormControl>
                    <Switch
                      checked={field.value ?? false}
                      onCheckedChange={field.onChange}
                      disabled={isSubmitting}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* Subjects */}
            <div className="flex flex-col gap-4 mx-1">
              <FormLabel>{t("subjects")}</FormLabel>
              <div>
                <div className="flex flex-col gap-4">
                  {fields.map((fieldItem, index) =>
                    renderSubjectField(index, fieldItem)
                  )}
                </div>
              </div>
              <Button
                type="button"
                variant="secondary"
                onClick={() =>
                  append({
                    id: "",
                    customCoefficient: null,
                    includeChildren: false,
                  })
                }
                disabled={isSubmitting}
                className="mt-2 flex items-center gap-2"
              >
                <PlusCircle className="h-4 w-4" />
                {t("addSubject")}
              </Button>
            </div>

            {/* Submit */}
            <Button className="w-full" type="submit" disabled={isSubmitting}>
              {isSubmitting && (
                <Loader2Icon className="animate-spin mr-2 h-4 w-4" />
              )}
              {t("updateAverage")}
            </Button>
          </FormContentWrapper>
        </form>
      </Form>
    </div>
  );
};
