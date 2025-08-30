"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation } from "@tanstack/react-query";
import React, { useEffect, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";

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
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Drawer,
  DrawerContent,
  DrawerTitle,
  DrawerTrigger,
} from "@/components/ui/drawer";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { apiClient } from "@/lib/api";
import { Check, ChevronsUpDown } from "lucide-react";
import { authClient } from "@/lib/auth";
import { useMediaQuery } from "@/components/ui/use-media-query";
import { handleError } from "@/utils/error-utils";
import { VisuallyHidden } from "@radix-ui/react-visually-hidden";
import { useTranslations } from "next-intl";
import { isEqual } from "lodash";

interface FeedbackFormProps {
  close: () => void;
  formData: {
    type?: "Général" | "Bug" | "Suggestion";
    subject?: string;
    content?: string;
    image?: string;
    email?: string;
  };
  setFormData: React.Dispatch<
    React.SetStateAction<{
      type?: "Général" | "Bug" | "Suggestion";
      subject?: string;
      content?: string;
      image?: string;
      email?: string;
    }>
  >;
}

export const FeedbackForm: React.FC<FeedbackFormProps> = ({
  close,
  formData,
  setFormData,
}) => {
  const errorTranslations = useTranslations("Errors");
  const t = useTranslations("Dashboard.Forms.Feedback");
  const toaster = useToast();

  const [openType, setOpenType] = useState(false);
  const typeInputRef = useRef<HTMLInputElement>(null);
  const isDesktop = useMediaQuery("(min-width: 768px)");

  const feedbackSchema = z.object({
    type: z.enum(["Général", "Bug", "Suggestion"]),
    subject: z.string().min(1, t("subjectRequired")).max(100, t("subjectTooLong")),
    content: z.string().min(10, t("contentMin")).max(1000, t("contentMax")),
    image: z.string().optional(),
    email: z.string().email(t("invalidEmail")),
  });
  type FeedbackSchema = z.infer<typeof feedbackSchema>;

  // Possibly retrieve user’s email
  const { data } = authClient.useSession() as any;
  const defaultEmail = data?.user.email || "";

  const { mutate, isPending } = useMutation({
    mutationKey: ["submit-feedback"],
    mutationFn: async (vals: FeedbackSchema) => {
      const res = await apiClient.post("feedback", {
        json: vals,
      });
      return res.json();
    },
    onSuccess: () => {
      toaster.toast({
        title: t("successTitle"),
        description: t("successDescription"),
      });
      close();
    },
    onError: (error) => {
      handleError(error, toaster, errorTranslations, t("errorSubmittingFeedback"));
    },
  });

  // Keep original defaults from your code
  const form = useForm<FeedbackSchema>({
    resolver: zodResolver(feedbackSchema),
    defaultValues: {
      type: formData.type || "Général",
      subject: formData.subject || "",
      content: formData.content || "",
      image: formData.image || "",
      email: formData.email || defaultEmail,
    },
  });

  // On mount, reset
  useEffect(() => {
    form.reset({
      type: formData.type || "Général",
      subject: formData.subject || "",
      content: formData.content || "",
      image: formData.image || "",
      email: formData.email || defaultEmail,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // watch
  const watchedValues = form.watch();

  // sync back
  useEffect(() => {
    if (!isEqual(watchedValues, formData)) {
      setFormData(watchedValues);
    }
  }, [watchedValues, formData, setFormData]);

  const onSubmit = (vals: FeedbackSchema) => {
    mutate(vals);
  };

  const handleImageChange = (
    e: React.ChangeEvent<HTMLInputElement>,
    onChange: (value: string) => void
  ) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = () => {
        if (reader.result) {
          onChange(reader.result as string);
        }
      };
      reader.readAsDataURL(file);
    }
  };

  const feedbackTypes = [
    { id: "Général", name: t("general") },
    { id: "Bug", name: t("bug") },
    { id: "Suggestion", name: t("suggestion") },
  ];

  const watchedType = form.watch("type");

  return (
    <Form {...form}>
      <form
        noValidate
        onSubmit={form.handleSubmit(onSubmit)}
        className="flex flex-col gap-6"
      >
        {/* Feedback Type */}
        <FormField
          control={form.control}
          name="type"
          render={({ field }) => (
            <FormItem className="flex flex-col mx-1">
              <FormLabel>{t("feedbackType")}</FormLabel>
              {isDesktop ? (
                <Popover modal open={openType} onOpenChange={setOpenType}>
                  <FormControl>
                    <PopoverTrigger asChild>
                      <Button
                        variant="outline"
                        role="combobox"
                        aria-expanded={openType}
                        className={cn(
                          "justify-between",
                          !watchedType && "text-muted-foreground"
                        )}
                      >
                        {watchedType || t("selectFeedbackType")}
                        <ChevronsUpDown className="ml-2 h-4 w-4 opacity-50" />
                      </Button>
                    </PopoverTrigger>
                  </FormControl>
                  <PopoverContent align="center" className="p-0 min-w-[200px]">
                    <Command>
                      <CommandInput
                        ref={typeInputRef}
                        placeholder={t("searchFeedbackType")}
                        className="h-9"
                      />
                      <CommandList>
                        <CommandEmpty>{t("noFeedbackTypeFound")}</CommandEmpty>
                        <CommandGroup>
                          {feedbackTypes.map((item) => (
                            <CommandItem
                              key={item.id}
                              value={item.name}
                              onSelect={() => {
                                form.setValue("type", item.id as FeedbackSchema["type"], {
                                  shouldValidate: true,
                                });
                                setOpenType(false);
                              }}
                            >
                              {item.name}
                              {watchedType === item.id && (
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
                <Drawer open={openType} onOpenChange={setOpenType}>
                  <DrawerTrigger asChild>
                    <FormControl>
                      <Button
                        variant="outline"
                        role="combobox"
                        aria-expanded={openType}
                        className={cn(
                          "justify-between",
                          !watchedType && "text-muted-foreground"
                        )}
                        onClick={() => setOpenType(!openType)}
                      >
                        {watchedType || t("selectFeedbackType")}
                        <ChevronsUpDown className="opacity-50" />
                      </Button>
                    </FormControl>
                  </DrawerTrigger>
                  <DrawerContent>
                    <VisuallyHidden>
                      <DrawerTitle>{t("selectFeedbackType")}</DrawerTitle>
                    </VisuallyHidden>
                    <div className="mt-4 border-t p-4 overflow-scroll">
                      <Command>
                        <CommandInput
                          ref={typeInputRef}
                          placeholder={t("searchFeedbackType")}
                          className="h-9"
                          autoFocus
                        />
                        <CommandList>
                          <CommandEmpty>{t("noFeedbackTypeFound")}</CommandEmpty>
                          <CommandGroup>
                            {feedbackTypes.map((item) => (
                              <CommandItem
                                key={item.id}
                                value={item.name}
                                onSelect={() => {
                                  form.setValue("type", item.id as FeedbackSchema["type"], {
                                    shouldValidate: true,
                                  });
                                  setOpenType(false);
                                }}
                              >
                                {item.name}
                                {watchedType === item.id && (
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

        {/* Subject */}
        <FormField
          control={form.control}
          name="subject"
          render={({ field }) => (
            <FormItem className="mx-1">
              <FormLabel>{t("subject")}</FormLabel>
              <FormControl>
                <Input placeholder={t("subjectPlaceholder")} {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        {/* Content */}
        <FormField
          control={form.control}
          name="content"
          render={({ field }) => (
            <FormItem className="mx-1">
              <FormLabel>{t("content")}</FormLabel>
              <FormControl>
                <Textarea placeholder={t("contentPlaceholder")} {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        {/* Image */}
        <FormField
          control={form.control}
          name="image"
          render={({ field }) => (
            <FormItem className="mx-1">
              <FormLabel>{t("addImage")}</FormLabel>
              <FormControl>
                <Input
                  type="file"
                  accept="image/png, image/jpeg"
                  onChange={(e) => handleImageChange(e, field.onChange)}
                />
              </FormControl>
              <FormMessage />
              {/* You can keep your original FormDescription if you had one */}
            </FormItem>
          )}
        />

        {/* Email field is omitted in your snippet. If needed, just put it back. */}

        <Button type="submit" disabled={isPending}>
          {isPending ? t("submitting") : t("submit")}
        </Button>
      </form>
    </Form>
  );
};
