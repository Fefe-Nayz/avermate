"use client";

import { useToast } from "@/hooks/use-toast";
import { Subject } from "@/types/subject";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { CheckIcon, ChevronsUpDownIcon, Loader2Icon } from "lucide-react";
import { useForm } from "react-hook-form";
import { z } from "zod";

import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { useState, useRef, useEffect } from "react";
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
import React from "react";

interface AddSubjectFormProps {
  close: () => void;
  parentId?: string;
  yearId: string;
  formData: {
    name: string;
    coefficient?: number;
    parentId?: string | null;
    isMainSubject?: boolean;
    isDisplaySubject?: boolean;
  };
  setFormData: React.Dispatch<
    React.SetStateAction<{
      name: string;
      coefficient?: number;
      parentId?: string | null;
      isMainSubject?: boolean;
      isDisplaySubject?: boolean;
    }>
  >;
}

export const AddSubjectForm = ({
  close,
  parentId,
  formData,
  setFormData,
  yearId,
}: AddSubjectFormProps) => {
  const errorTranslations = useTranslations("Errors");
  const t = useTranslations("Dashboard.Forms.AddSubject");
  const toaster = useToast();
  const queryClient = useQueryClient();
  const isDesktop = useMediaQuery("(min-width: 768px)");
  const { data: subjects } = useSubjects(yearId);

  const addSubjectSchema = z.object({
    name: z.string().min(1, t("nameRequired")).max(64, t("nameTooLong")),
    coefficient: z.coerce.number({
      invalid_type_error: t("coefficientRequired"),
    }).min(0, t("coefficientMin")).max(1000, t("coefficientMax")),
    parentId: z
      .string()
      .max(64, t("parentIdMax"))
      .optional()
      .transform((val) => (val === "" || val === "none" ? null : val)),
    isMainSubject: z.boolean().optional(),
    isDisplaySubject: z.boolean().optional(),
  });
  type AddSubjectSchema = z.infer<typeof addSubjectSchema>;

  const [openParent, setOpenParent] = useState(false);

  const parentInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!isDesktop && openParent) {
      setTimeout(() => parentInputRef.current?.focus(), 350);
    }
  }, [openParent, isDesktop]);

  const { mutate, isPending } = useMutation({
    mutationKey: ["create-subject"],
    mutationFn: async ({
      name,
      coefficient,
      parentId,
      isMainSubject,
      isDisplaySubject,
    }: AddSubjectSchema) => {
      const res = await apiClient.post(`years/${yearId}/subjects`, {
        json: { name, coefficient, parentId, isMainSubject, isDisplaySubject },
      });
      const json = await res.json() as {subject: Subject};
      return json.subject;
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
      queryClient.invalidateQueries({ queryKey: ["subjects"] });
      queryClient.invalidateQueries({ queryKey: ["subjects", "organized-by-periods"] });
      queryClient.invalidateQueries({ queryKey: ["recent-grades"] });
      queryClient.invalidateQueries({ queryKey: ["grades"] });
    },
    onError: (error) => {
      handleError(error, toaster, errorTranslations, t("errorAddingSubject"));
    },
  });

  // Keep original form default
  const form = useForm<AddSubjectSchema>({
    resolver: zodResolver(addSubjectSchema),
    defaultValues: {
      name: "",
      parentId: parentId?.toString() || "",
      isDisplaySubject: false,
      isMainSubject: false,
      coefficient: undefined,
    },
  });

  // Sync with parent's data
  useEffect(() => {
    form.reset(formData);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const watchedValues = form.watch();
  useEffect(() => {
    if (!isEqual(watchedValues, formData)) {
      setFormData(watchedValues);
    }
  }, [watchedValues, formData, setFormData]);

  // inside your AddSubjectForm or wherever you watch isDisplaySubject
  const isDisplaySubject = form.watch("isDisplaySubject");
  const coefficient = form.watch("coefficient");

  // Use an effect to set the coefficient to 1 *only* if it isn’t already 1
  useEffect(() => {
    if (isDisplaySubject && coefficient !== 1) {
      form.setValue("coefficient", 1);
    }
  }, [isDisplaySubject, coefficient, form]);


  const onSubmit = (values: AddSubjectSchema) => {
    mutate(values);
  };

  return (
    <div>
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

          <FormField
            control={form.control}
            name="coefficient"
            render={({ field }) => (
              <FormItem className="col-span-2 mx-1">
                <FormLabel>{t("coefficient")}</FormLabel>
                <FormControl>
                  <Input
                    type="number"
                    placeholder={t("coefficientPlaceholder")}
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
                  <Switch
                    checked={field.value ?? false}
                    onCheckedChange={field.onChange}
                  />
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
                  <Switch
                    checked={field.value ?? false}
                    onCheckedChange={field.onChange}
                  />
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
                  <Popover
                    modal
                    open={openParent}
                    onOpenChange={setOpenParent}
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
                          {field.value === "none"
                            ? t("noParent")
                            : field.value
                              ? subjects?.find((s) => s.id === field.value)?.name
                              : t("chooseParentSubject")}
                          <ChevronsUpDownIcon className="opacity-50" />
                        </Button>
                      </PopoverTrigger>
                    </FormControl>
                    <PopoverContent className="p-0 min-w-(--radix-popover-trigger-width)">
                      <Command>
                        <CommandInput
                          placeholder={t("chooseParentSubjectPlaceholder")}
                          className="h-9"
                        />
                        <CommandList>
                          <CommandEmpty>
                            {t("noParentSubjectFound")}
                          </CommandEmpty>
                          <CommandGroup>
                            {/* No parent */}
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
                              {field.value === "none" && (
                                <CheckIcon className="ml-auto h-4 w-4" />
                              )}
                            </CommandItem>
                            {subjects
                              ?.slice()
                              .sort((a, b) => a.name.localeCompare(b.name))
                              .map((subject) => (
                                <CommandItem
                                  key={subject.id}
                                  value={subject.name}
                                  onSelect={() => {
                                    form.setValue("parentId", subject.id, {
                                      shouldValidate: true,
                                    });
                                    setOpenParent(false);
                                  }}
                                >
                                  <span>{subject.name}</span>
                                  {field.value === subject.id && (
                                    <CheckIcon className="ml-auto h-4 w-4" />
                                  )}
                                </CommandItem>
                              ))}
                          </CommandGroup>
                        </CommandList>
                      </Command>
                    </PopoverContent>
                  </Popover>
                ) : (
                  <Drawer open={openParent} onOpenChange={setOpenParent}>
                    <DrawerTrigger asChild>
                      <FormControl>
                        <Button
                          variant="outline"
                          role="combobox"
                          aria-expanded={openParent ? "true" : "false"}
                          className="justify-between"
                          onClick={() => setOpenParent(!openParent)}
                          disabled={isPending}
                        >
                          {field.value === "none"
                            ? t("noParent")
                            : field.value
                              ? subjects?.find((s) => s.id === field.value)?.name
                              : t("chooseParentSubject")}
                          <ChevronsUpDownIcon className="opacity-50" />
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
                            placeholder={t("chooseParentSubjectPlaceholder")}
                            className="h-9"
                            autoFocus
                          />
                          <CommandList>
                            <CommandEmpty>
                              {t("noParentSubjectFound")}
                            </CommandEmpty>
                            <CommandGroup>
                              {/* No parent */}
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
                                {field.value === "none" && (
                                  <CheckIcon className="ml-auto h-4 w-4" />
                                )}
                              </CommandItem>
                              {subjects
                                ?.slice()
                                .sort((a, b) => a.name.localeCompare(b.name))
                                .map((subject) => (
                                  <CommandItem
                                    key={subject.id}
                                    value={subject.name}
                                    onSelect={() => {
                                      form.setValue("parentId", subject.id, {
                                        shouldValidate: true,
                                      });
                                      setOpenParent(false);
                                    }}
                                  >
                                    <span>{subject.name}</span>
                                    {field.value === subject.id && (
                                      <CheckIcon className="ml-auto h-4 w-4" />
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