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
import {
  InputOTP,
  InputOTPGroup,
  InputOTPSlot,
  InputOTPSeparator,
} from "@/components/ui/input-otp";
import { toast } from "sonner";
import { authClient } from "@/lib/auth";
import { cn } from "@/lib/utils";
import { handleError } from "@/utils/error-utils";
import { getPasswordStrength } from "@/utils/password";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation } from "@tanstack/react-query";
import { Eye, EyeOff, Loader2, Loader2Icon } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { useTranslations } from "next-intl";
import * as z from "zod";
import { motion } from "framer-motion";
import { REGEXP_ONLY_DIGITS } from "input-otp";

export const ResetPasswordForm = () => {
  const [isVisible, setIsVisible] = useState<boolean>(false);
  const [otp, setOtp] = useState("");
  const [step, setStep] = useState<"otp" | "password">("otp");

  const router = useRouter();
  const searchParams = useSearchParams();
  const email = searchParams.get("email") || "";
  const errorTranslations = useTranslations("Errors");
  const t = useTranslations("Auth.Reset");

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

  const resetPasswordSchema = z.object({
    password: z
      .string()
      .min(8)
      .max(128)
      .superRefine((password, ctx) => {
        const strength = getPasswordStrength(password);

        if (strength.strength === "weak") {
          return ctx.addIssue({
            code: "custom",
            message: t("passwordTooWeak"),
          });
        }
      }),
  });

  type ResetPasswordSchema = z.infer<typeof resetPasswordSchema>;

  // Step 1: Verify OTP
  const { mutate: verifyOtp, isPending: isVerifying } = useMutation({
    mutationKey: ["verify-reset-otp"],
    mutationFn: async () => {
      const data = await authClient.emailOtp.checkVerificationOtp({
        email,
        otp,
        type: "forget-password",
      });
      return data;
    },
    onSuccess: () => {
      setStep("password");
      toast.success(t("codeVerified"));
    },
    onError: (error) => {
      setOtp("");
      handleError(error, errorTranslations, t("errorVerifyingCode"));
    },
  });

  // Step 2: Reset password
  const { mutate: resetPassword, isPending: isResetting } = useMutation({
    mutationKey: ["reset-password"],
    mutationFn: async ({ password }: ResetPasswordSchema) => {
      const data = await authClient.emailOtp.resetPassword({
        email,
        otp,
        password,
      });
      return data;
    },
    onSuccess: () => {
      router.push("/auth/sign-in");
      toast.success(t("passwordReset"), {
        description: t("passwordResetSuccess"),
      });
    },
    onError: (error) => {
      handleError(error, errorTranslations, t("errorResettingPassword"));
    },
  });

  // Resend OTP mutation
  const { mutate: resendOtp, isPending: isResending } = useMutation({
    mutationKey: ["resend-reset-otp"],
    mutationFn: async () => {
      await authClient.emailOtp.sendVerificationOtp({
        email,
        type: "forget-password",
      });
    },
    onSuccess: () => {
      toast.success(t("otpResent"), {
        description: t("otpResentDescription", { email }),
      });
    },
    onError: (error) => {
      handleError(error, errorTranslations, t("errorResettingPassword"));
    },
  });

  const toggleVisibility = () => setIsVisible((prevState) => !prevState);

  const form = useForm<ResetPasswordSchema>({
    resolver: zodResolver(resetPasswordSchema),
    defaultValues: {
      password: "",
    },
  });

  const handleSubmit = (values: ResetPasswordSchema) => {
    resetPassword(values);
  };

  const isPending = isVerifying || isResetting;

  return (
    <div className="flex flex-col gap-4">
      {step === "otp" ? (
        /* Step 1: OTP Verification */
        <div className="flex flex-col gap-4 items-center">
          <div className="flex flex-col gap-2 w-full">
            <label className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70">{t("otp")}</label>
          </div>
          <InputOTP
            maxLength={6}
            pattern={REGEXP_ONLY_DIGITS}
            value={otp}
            onChange={setOtp}
            disabled={isVerifying}
            onComplete={() => verifyOtp()}
          >
            <InputOTPGroup>
              <InputOTPSlot index={0} />
              <InputOTPSlot index={1} />
              <InputOTPSlot index={2} />
            </InputOTPGroup>
            <InputOTPSeparator />
            <InputOTPGroup>
              <InputOTPSlot index={3} />
              <InputOTPSlot index={4} />
              <InputOTPSlot index={5} />
            </InputOTPGroup>
          </InputOTP>

          <Button
            className="w-full"
            onClick={() => verifyOtp()}
            disabled={otp.length !== 6 || isVerifying}
          >
            {isVerifying && <Loader2 className="animate-spin h-4 w-4 mr-2" />}
            {t("verifyCode")}
          </Button>

          <Button
            variant="outline"
            className="w-full"
            type="button"
            onClick={() => resendOtp()}
            disabled={isResending || !email}
          >
            {isResending && <Loader2Icon className="animate-spin mr-2 size-4" />}
            {t("resendOtp")}
          </Button>
        </div>
      ) : (
        /* Step 2: New Password */
        <div className="flex flex-col gap-4">
          <p className="text-sm text-muted-foreground">{t("enterNewPassword")}</p>
          <Form {...form}>
            <form
              onSubmit={form.handleSubmit(handleSubmit)}
              className="flex flex-col gap-4"
            >
              <FormField
                control={form.control}
                name="password"
                disabled={isResetting}
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
                              width: `${Math.min(
                                (getPasswordStrength(form.getValues("password")).entropy / 4) * 100,
                                100
                              )}%`,
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

              <Button className="w-full" type="submit" disabled={isResetting}>
                {isResetting && <Loader2 className="animate-spin h-4 w-4 mr-2" />}
                {t("resetPassword")}
              </Button>
            </form>
          </Form>
        </div>
      )}
    </div>
  );
};
