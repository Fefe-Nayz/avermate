"use client";

import { Button } from "@/components/ui/button";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { authClient } from "@/lib/auth";
import { env } from "@/lib/env";
import { cn } from "@/lib/utils";
import { handleError } from "@/utils/error-utils";
import { getPasswordStrength } from "@/utils/password";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation } from "@tanstack/react-query";
import { Eye, EyeOff, Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { useTranslations } from "next-intl";
import { z } from "zod";
import { motion } from "framer-motion";

export const SignUpForm = () => {
  const [isVisible, setIsVisible] = useState<boolean>(false);

  const router = useRouter();
  const errorTranslations = useTranslations("Errors");
  const t = useTranslations("Auth.SignUp");

  const getStrengthColor = (strength: string) => {
    switch (strength) {
      case "weak":
        return "bg-red-500";
      case "medium":
        return "bg-amber-500";
      case "strong":
        return "bg-emerald-500";
      default:
        return "bg-border";
    }
  };

  const getStrengthGlow = (strength: string) => {
    switch (strength) {
      case "weak":
        return "rgba(239, 68, 68, 0.6)";
      case "medium":
        return "rgba(245, 158, 11, 0.6)";
      case "strong":
        return "rgba(16, 185, 129, 0.6)";
      default:
        return "transparent";
    }
  };

  const signUpSchema = z.object({
    firstName: z
      .string()
      .min(2, { message: t("firstNameTooShort") })
      .max(32, { message: t("firstNameTooLong") }),
    lastName: z
      .string()
      .min(2, { message: t("lastNameTooShort") })
      .max(32, { message: t("lastNameTooLong") }),
    password: z
      .string()
      .min(8, { message: t("passwordTooShort") })
      .max(128, { message: t("passwordTooLong") })
      .superRefine((password, ctx) => {
        const strength = getPasswordStrength(password);

        if (strength.strength === "weak") {
          return ctx.addIssue({
            code: "custom",
            message: t("passwordTooWeak"),
          });
        }
      }),
    email: z
      .string()
      .email({ message: t("invalidEmail") })
      .max(320, { message: t("emailTooLong") }),
  });

  type SignUpSchema = z.infer<typeof signUpSchema>;

  const { mutate, isPending } = useMutation({
    mutationKey: ["sign-up"],
    mutationFn: async ({
      firstName,
      lastName,
      email,
      password,
    }: SignUpSchema) => {
      const name = [firstName, lastName].join(" ");

      const data = await authClient.signUp.email({
        name,
        email,
        password,
        callbackURL: `${env.NEXT_PUBLIC_CLIENT_URL}/onboarding`,
      });

      return data;
    },
    onSuccess: (data) => {
      if (!data.user.emailVerified) {
        toast.error(t("emailNotVerified"), {
          description: t("verificationLinkSent", { email: data.user.email || "" }),
        });

        // Redirect to email verify
        router.push("/auth/verify-email");
        return;
      }
    },

    onError: (error) => {
      handleError(error, errorTranslations, t("signUpError"));
    },
  });

  const toggleVisibility = () => setIsVisible((prevState) => !prevState);

  const form = useForm<SignUpSchema>({
    // @ts-ignore
    resolver: zodResolver(signUpSchema),
    defaultValues: {
      firstName: "",
      lastName: "",
      password: "",
      email: "",
    },
  });

  const handleSubmit = (values: SignUpSchema) => {
    mutate(values);
  };

  return (
    <div>
      <Form {...form}>
        <form
          onSubmit={form.handleSubmit(handleSubmit)}
          className="flex flex-col gap-4"
        >
          <div className="flex gap-4">
            <div className="w-full">
              <FormField
                control={form.control}
                name="firstName"
                disabled={isPending}
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t("firstName")}</FormLabel>
                    <FormControl>
                      <Input
                        type="text"
                        placeholder={t("firstNamePlaceholder")}
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <div className="w-full">
              <FormField
                control={form.control}
                name="lastName"
                disabled={isPending}
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t("lastName")}</FormLabel>
                    <FormControl>
                      <Input
                        type="text"
                        placeholder={t("lastNamePlaceholder")}
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
          </div>

          <FormField
            control={form.control}
            name="email"
            disabled={isPending}
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t("email")}</FormLabel>
                <FormControl>
                  <Input
                    type="text"
                    placeholder={t("emailPlaceholder")}
                    {...field}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="password"
            disabled={isPending}
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t("password")}</FormLabel>
                <FormControl>
                  <div>
                    {/* Password input field with toggle visibility button */}
                    <div className="space-y-2">
                      <div className="relative">
                        <Input
                          id="password"
                          className="pe-9"
                          placeholder="Password"
                          type={isVisible ? "text" : "password"}
                          {...field}
                        />

                        <button
                          className="absolute inset-y-0 end-0 flex h-full w-9 items-center justify-center rounded-e-lg text-muted-foreground/80 outline-offset-2 transition-colors hover:text-foreground focus:z-10 focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-ring/70 disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50"
                          type="button"
                          onClick={toggleVisibility}
                          aria-label={
                            isVisible ? t("hidePassword") : t("showPassword")
                          }
                          aria-pressed={isVisible}
                          aria-controls="password"
                        >
                          {isVisible ? (
                            <EyeOff
                              size={16}
                              strokeWidth={2}
                              aria-hidden="true"
                            />
                          ) : (
                            <Eye size={16} strokeWidth={2} aria-hidden="true" />
                          )}
                        </button>
                      </div>
                    </div>

                    {/* Password strength indicator */}
                    <div
                      role="progressbar"
                      aria-label={t("passwordStrength")}
                      className="bg-border h-1 w-full rounded-full relative mb-4 mt-3"
                      aria-valuenow={
                        getPasswordStrength(form.getValues("password")).entropy
                      }
                      aria-valuemin={0}
                      aria-valuemax={4}
                    >
                      <motion.div
                        initial={{ width: "0%" }}
                        animate={{
                          width: `${getPasswordStrength(form.getValues("password"))
                              .entropy * 100
                            }%`,
                        }}
                        transition={{
                          damping: 25,
                          stiffness: 400,
                          type: "spring",
                        }}
                        className={`${getStrengthColor(
                          getPasswordStrength(form.getValues("password")).strength
                        )} h-full rounded-full`}
                        style={{
                          boxShadow:
                            getPasswordStrength(form.getValues("password")).entropy > 0
                              ? `0 0 8px 2px ${getStrengthGlow(
                                getPasswordStrength(form.getValues("password")).strength
                              )}`
                              : "none",
                        }}
                      />
                    </div>
                  </div>
                </FormControl>

                <FormMessage />
              </FormItem>
            )}
          />

          <Button className="w-full" type="submit" disabled={isPending}>
            {isPending && <Loader2 className="animate-spin h-4 w-4 mr-2" />}
            {t("signUp")}
          </Button>
        </form>
      </Form>
    </div>
  );
};
