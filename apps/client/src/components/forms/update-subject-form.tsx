"use client";

import { Button } from "@/components/ui/button";
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
import { Switch } from "@/components/ui/switch";
import { useMediaQuery } from "@/components/ui/use-media-query";
import { useSubjects } from "@/hooks/use-subjects";
import { useToast } from "@/hooks/use-toast";
import { apiClient } from "@/lib/api";
import { Subject } from "@/types/subject";
import { handleError } from "@/utils/error-utils";
import { CheckIcon, ChevronUpDownIcon } from "@heroicons/react/24/outline";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Loader2Icon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { Badge } from "../ui/badge";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "../ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "../ui/popover";
import { VisuallyHidden } from "@radix-ui/react-visually-hidden";
import { useTranslations } from "next-intl"; // Import useTranslations

export const UpdateSubjectForm = ({
  close,
  subject,
}: {
  close: () => void;
  subject: Subject;
}) => {
  const errorTranslations = useTranslations("Errors");
  const t = useTranslations("Dashboard.Forms.UpdateSubject");
  const [openParent, setOpenParent] = useState(false);
  const [parentInputValue, setParentInputValue] = useState("");
  const toaster = useToast();
  const queryClient = useQueryClient();
  const isDesktop = useMediaQuery("(min-width: 768px)");

  const parentInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!isDesktop && openParent) {
      setTimeout(() => parentInputRef.current?.focus(), 350);
    }
  }, [openParent, isDesktop]);

  const { data: subjects } = useSubjects(subject.yearId);

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
    defaultValues: {
      name: subject.name,
      coefficient: subject.coefficient / 100,
      parentId: subject.parentId ?? "none",
      isMainSubject: subject.isMainSubject,
      isDisplaySubject: subject.isDisplaySubject,
    },
  });

  // -----------------------------------
  // 2) Then use 'form' to find selectedParent
  // -----------------------------------
  const selectedParent = subjects?.find(
    (s) => s.id === form.getValues("parentId")
  );

  // 3) Filter based on parentInputValue
  const filteredSubjects = subjects
    ?.filter(
      (s) =>
        s.id !== subject.id &&
        s.name.toLowerCase().includes(parentInputValue.toLowerCase())
    )
    .sort((a, b) => a.name.localeCompare(b.name));

  // 4) Use the rest exactly the same
  const { mutate, isPending } = useMutation({
    mutationKey: ["update-subject"],
    mutationFn: async ({
      name,
      coefficient,
      parentId,
      isMainSubject,
      isDisplaySubject,
    }: UpdateSubjectSchema) => {
      const res = await apiClient.patch(`subjects/${subject.id}`, {
        json: {
          name,
          coefficient,
          parentId,
          isMainSubject,
          isDisplaySubject,
        },
      });

      const data = await res.json<{ subject: Subject }>();
      return data.subject;
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
      queryClient.invalidateQueries({ queryKey: ["subject", subject.id] });
    },
    onError: (error) => {
      handleError(error, toaster, errorTranslations, t("updateError"));
    },
  });

  const isDisplaySubject = form.watch("isDisplaySubject");

  useEffect(() => {
    if (isDisplaySubject) {
      form.setValue("coefficient", 1);
    }
  }, [isDisplaySubject, form]);

  const onSubmit = (values: UpdateSubjectSchema) => {
    mutate(values);
  };

  // Reset parentInputValue when popover/drawer opens
  useEffect(() => {
    if (openParent) {
      setParentInputValue(selectedParent?.name ?? "");
    }
  }, [openParent, selectedParent]);

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
                  <Input type="text" placeholder={subject.name} {...field} />
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
                    placeholder={(subject.coefficient / 100).toString()}
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
                    <Switch
                      checked={field.value}
                      onCheckedChange={field.onChange}
                    />
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
                    <Switch
                      checked={field.value}
                      onCheckedChange={field.onChange}
                    />
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
                        >
                          {selectedParent
                            ? selectedParent.name
                            : field.value === "none"
                            ? t("chooseParentSubject")
                            : ""}
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
                          {selectedParent
                            ? selectedParent.name
                            : field.value === "none"
                            ? t("chooseParentSubject")
                            : ""}
                          <ChevronUpDownIcon className="opacity-50" />
                        </Button>
                      </FormControl>
                    </DrawerTrigger>
                    <DrawerContent>
                      <VisuallyHidden>
                        <DrawerTitle>{t("chooseParentSubject")}</DrawerTitle>
                      </VisuallyHidden>
                      <div className="mt-4 border-t p-4">
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
