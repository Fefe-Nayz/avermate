"use client";

import { useToast } from "@/hooks/use-toast";
import { Subject } from "@/types/subject";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { CheckIcon, Loader2Icon } from "lucide-react";
import React, { useEffect, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";

import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "../ui/popover";
import {
  Drawer,
  DrawerContent,
  DrawerTitle,
  DrawerTrigger,
} from "@/components/ui/drawer";
import { useMediaQuery } from "@/components/ui/use-media-query";
import { handleError } from "@/utils/error-utils";
import { useSubjects } from "@/hooks/use-subjects";
import { VisuallyHidden } from "@radix-ui/react-visually-hidden";
import { useTranslations } from "next-intl";
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
import { apiClient } from "@/lib/api";
import { isEqual } from "lodash";
import { ChevronUpDownIcon } from "@heroicons/react/24/outline";

// match the parent's updateSubjectSchema
const updateSubjectSchema = z.object({
  name: z.string().min(1).max(64),
  coefficient: z.number().min(0).max(1000),
  parentId: z.string().max(64).nullable().optional(),
  isMainSubject: z.boolean().optional(),
  isDisplaySubject: z.boolean().optional(),
});
type UpdateSubjectSchema = z.infer<typeof updateSubjectSchema>;

interface UpdateSubjectFormProps {
  close: () => void;
  subjectId: string;
  yearId: string;
  formData: UpdateSubjectSchema;
  setFormData: React.Dispatch<React.SetStateAction<UpdateSubjectSchema>>;
}

export const UpdateSubjectForm: React.FC<UpdateSubjectFormProps> = ({
  close,
  subjectId,
  formData,
  setFormData,
  yearId,
}) => {
  const errorTranslations = useTranslations("Errors");
  const t = useTranslations("Dashboard.Forms.UpdateSubject");
  const toaster = useToast();
  const queryClient = useQueryClient();
  const isDesktop = useMediaQuery("(min-width: 768px)");

  const parentInputRef = useRef<HTMLInputElement>(null);

  const { data: subjects } = useSubjects(yearId);

  // -----------------------------------
  // 1) First, define 'form'
  // -----------------------------------
  const updateSubjectSchema = z.object({
    name: z.string().min(1, t("nameRequired")).max(64, t("nameTooLong")),
    coefficient: z.coerce
      .number()
      .min(0, t("coefficientMin"))
      .max(1000, t("coefficientMax")),
    parentId: z
      .string()
      .max(64)
      .optional()
      .transform((val) => (val === "none" ? null : val))
      .nullable()
      .refine((val) => val === null || subjects?.some((s) => s.id === val), {
        message: t("parentIdInvalid"),
      }),
    isMainSubject: z.boolean().optional(),
    isDisplaySubject: z.boolean().optional(),
  });

  type UpdateSubjectSchema = z.infer<typeof updateSubjectSchema>;

  const form = useForm<UpdateSubjectSchema>({
    resolver: zodResolver(updateSubjectSchema),
    defaultValues: formData,
  });

  const selectedParent = subjects?.find(
    (s) => s.id === form.getValues("parentId")
  );

  // On mount, sync
  useEffect(() => {
    form.reset(formData);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // watch => setFormData
  const watchedValues = form.watch();
  useEffect(() => {
    if (!isEqual(watchedValues, formData)) {
      setFormData(watchedValues);
    }
  }, [watchedValues, formData, setFormData]);

  // handle isDisplaySubject => setCoefficient=1
  const isDisplaySubject = form.watch("isDisplaySubject");
  const coefficient = form.watch("coefficient");
  useEffect(() => {
    if (isDisplaySubject && coefficient !== 1) {
      form.setValue("coefficient", 1);
    }
  }, [isDisplaySubject, coefficient, form]);

  const { mutate, isPending } = useMutation({
    mutationKey: ["update-subject", subjectId],
    mutationFn: async (vals: UpdateSubjectSchema) => {
      const res = await apiClient.patch(`subjects/${subjectId}`, { json: vals });
      return (await res.json<{ subject: Subject }>()).subject;
    },
    onSuccess: (subject) => {
      toaster.toast({
        title: t("successTitle"),
        description: t("successDescription"),
      });
      close();
    },
    onSettled: () => {
      queryClient.cancelQueries();
      queryClient.invalidateQueries({ queryKey: ["subject", subjectId] });
      queryClient.invalidateQueries({ queryKey: ["subjects"] });
      queryClient.invalidateQueries({ queryKey: ["subjects", "organized-by-periods"] });
      queryClient.invalidateQueries({ queryKey: ["recent-grades"] });
      queryClient.invalidateQueries({ queryKey: ["grades"] });
    },
    onError: (error) => {
      handleError(error, toaster, errorTranslations, t("updateError"));
    },
  });

  const onSubmit = (values: UpdateSubjectSchema) => {
    mutate(values);
  };

  // For picking a parent
  const [openParent, setOpenParent] = useState(false);
  useEffect(() => {
    if (!isDesktop && openParent) {
      setTimeout(() => parentInputRef.current?.focus(), 350);
    }
  }, [openParent, isDesktop]);

  // Filter out self & search
  const [parentInputValue, setParentInputValue] = useState("");
  const filteredSubjects = subjects
    ?.filter((s) => s.id !== subjectId && s.name.toLowerCase().includes(parentInputValue.toLowerCase()))
    .sort((a, b) => a.name.localeCompare(b.name));

  return (
    <div className="">
      <Form {...form}>
        <form
          noValidate
          onSubmit={form.handleSubmit(onSubmit)}
          className="flex flex-col gap-8"
        >
          <FormField
            control={form.control}
            name="name"
            disabled={isPending}
            render={({ field }) => (
              <FormItem className="mx-1">
                <FormLabel>{t("name")}</FormLabel>
                <FormControl>
                  <Input type="text" placeholder={formData.name} {...field} />
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
                    placeholder={(formData.coefficient / 100).toString()}
                    {...field}
                    disabled={isPending || isDisplaySubject}
                    onChange={(e) => field.onChange(e.target.value)}
                  />
                </FormControl>
                <FormMessage />
                {isDisplaySubject && (
                  <FormDescription>
                    {t("coefficientDescription")}
                  </FormDescription>
                )}
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="isMainSubject"
            render={({ field }) => (
              <FormItem className="mx-1">
                <div className="col-span-2 flex flex-row gap-4 items-center">
                  <FormLabel>{t("isMainSubject")}</FormLabel>
                  <FormControl>
                    <Switch checked={field.value ?? false} onCheckedChange={field.onChange} />
                  </FormControl>
                </div>
                <FormMessage />
                <FormDescription>
                  {t("isMainSubjectDescription")}
                </FormDescription>
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="isDisplaySubject"
            render={({ field }) => (
              <FormItem className="mx-1">
                <div className="col-span-2 flex flex-row gap-4 items-center">
                  <FormLabel>{t("isDisplaySubject")}</FormLabel>
                  <FormControl>
                    <Switch checked={field.value ?? false} onCheckedChange={field.onChange} />
                  </FormControl>
                </div>
                <FormMessage />
                <FormDescription>
                  {t("isDisplaySubjectDescription")}
                </FormDescription>
              </FormItem>
            )}
          />

          {/* Responsive Combobox for ParentId */}
          <FormField
            control={form.control}
            name="parentId"
            render={({ field }) => (
              <FormItem className="flex flex-col mx-1">
                <FormLabel>
                  {t("parentSubject")}{" "}
                  <Badge className="ml-2">{t("optional")}</Badge>
                </FormLabel>

                {isDesktop ? (
                  // Desktop: Popover
                  <Popover
                    modal
                    open={openParent}
                    onOpenChange={(isOpen) => setOpenParent(isOpen)}
                  >
                    <FormControl>
                      <PopoverTrigger asChild>
                        <Button
                          variant="outline"
                          role="combobox"
                          aria-expanded={openParent ? "true" : "false"}
                          className="justify-between"
                          onClick={() => setOpenParent(!openParent)}
                          disabled={isPending}
                        >
                          {field.value === null
                            ? t("noParent")
                            : field.value
                              ? subjects?.find((s) => s.id === field.value)?.name
                              : t("chooseParentSubject")}
                          <ChevronUpDownIcon className="opacity-50" />
                        </Button>
                      </PopoverTrigger>
                    </FormControl>
                    <PopoverContent
                      className="p-0 min-w-[var(--radix-popover-trigger-width)]"
                      align="center"
                    >
                      <Command>
                        <CommandInput
                          ref={parentInputRef}
                          placeholder={t("chooseParentSubject")}
                          value={parentInputValue}
                          onValueChange={setParentInputValue}
                          className="h-9"
                        />
                        <CommandList>
                          <CommandEmpty>{t("noSubjectsFound")}</CommandEmpty>
                          <CommandGroup>
                            <CommandItem
                              value="none"
                              onSelect={() => {
                                form.setValue("parentId", "none", {
                                  shouldValidate: true,
                                });
                                setOpenParent(false);
                              }}
                            >
                              <span>{t("noParent")}</span>
                              {form.getValues("parentId") === "none" && (
                                <CheckIcon className="w-4 h-4 ml-auto" />
                              )}
                            </CommandItem>
                            {filteredSubjects?.map((item) => (
                              <CommandItem
                                key={item.id}
                                value={item.name}
                                onSelect={() => {
                                  form.setValue("parentId", item.id, {
                                    shouldValidate: true,
                                  });
                                  setOpenParent(false);
                                }}
                              >
                                <span>{item.name}</span>
                                {form.getValues("parentId") === item.id && (
                                  <CheckIcon className="w-4 h-4 ml-auto" />
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
                  <Drawer open={openParent} onOpenChange={setOpenParent}>
                    <DrawerTrigger asChild>
                      <FormControl>
                        <Button
                          variant="outline"
                          role="combobox"
                          aria-expanded={openParent ? "true" : "false"}
                          className="justify-between"
                          onClick={() => setOpenParent(!openParent)}
                        >
                          {field.value === null
                            ? t("noParent")
                            : field.value
                              ? subjects?.find((s) => s.id === field.value)?.name
                              : t("chooseParentSubject")}
                          <ChevronUpDownIcon className="opacity-50" />
                        </Button>
                      </FormControl>
                    </DrawerTrigger>
                    <DrawerContent>
                      <VisuallyHidden>
                        <DrawerTitle>{t("chooseParentSubject")}</DrawerTitle>
                      </VisuallyHidden>
                      <div className="mt-4 border-t p-4 overflow-scroll">
                        <Command>
                          <CommandInput
                            ref={parentInputRef}
                            autoFocus
                            placeholder={t("chooseParentSubject")}
                            value={parentInputValue}
                            onValueChange={setParentInputValue}
                            className="h-9"
                          />
                          <CommandList>
                            <CommandEmpty>{t("noSubjectsFound")}</CommandEmpty>
                            <CommandGroup>
                              <CommandItem
                                value="none"
                                onSelect={() => {
                                  form.setValue("parentId", "none", {
                                    shouldValidate: true,
                                  });
                                  setOpenParent(false);
                                }}
                              >
                                <span>{t("noParent")}</span>
                                {form.getValues("parentId") === "none" && (
                                  <CheckIcon className="w-4 h-4 ml-auto" />
                                )}
                              </CommandItem>
                              {filteredSubjects?.map((item) => (
                                <CommandItem
                                  key={item.id}
                                  value={item.name}
                                  onSelect={() => {
                                    form.setValue("parentId", item.id, {
                                      shouldValidate: true,
                                    });
                                    setOpenParent(false);
                                  }}
                                >
                                  <span>{item.name}</span>
                                  {form.getValues("parentId") === item.id && (
                                    <CheckIcon className="w-4 h-4 ml-auto" />
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
                <FormDescription>
                  {t("parentSubjectDescription")}
                </FormDescription>
              </FormItem>
            )}
          />

          <Button className="w-full" type="submit" disabled={isPending}>
            {isPending && <Loader2Icon className="animate-spin mr-2 h-4 w-4" />}
            {t("submit")}
          </Button>
        </form>
      </Form>
    </div>
  );
};
