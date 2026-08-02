"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { useExtracted } from "next-intl";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  InputOTP,
  InputOTPGroup,
  InputOTPSlot,
} from "@/components/ui/input-otp";
import { Spinner } from "@/components/ui/spinner";
import { authClient } from "@/lib/auth-client";
import { haptic } from "@/lib/haptics";

/** Six digits from the email. Submits itself once the last one lands. */
function Verify() {
  const t = useExtracted();
  const router = useRouter();
  const params = useSearchParams();
  const email = params.get("email") ?? "";

  const [code, setCode] = useState("");
  const [pending, setPending] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setTimeout(() => setCooldown((value) => value - 1), 1000);
    return () => clearTimeout(timer);
  }, [cooldown]);

  useEffect(() => {
    if (code.length !== 6 || pending) return;

    const run = async () => {
      setPending(true);
      setError(null);
      const { error: failure } = await authClient.emailOtp.verifyEmail({
        email,
        otp: code,
      });

      if (failure) {
        setPending(false);
        setCode("");
        haptic("error");
        setError(t("That code is not right, or it has expired."));
        return;
      }

      haptic("success");
      toast.success(t("Email confirmed."));
      router.replace("/onboarding");
    };

    void run();
  }, [code, pending, email, router, t]);

  const resend = async () => {
    haptic("light");
    setCooldown(45);
    await authClient.emailOtp.sendVerificationOtp({
      email,
      type: "email-verification",
    });
    toast.success(t("A new code is on its way."));
  };

  return (
    <div className="flex flex-col items-center gap-6 text-center">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">
          {t("Check your email")}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {t("We sent a six-digit code to {email}.", { email })}
        </p>
      </div>

      <InputOTP maxLength={6} value={code} onChange={setCode} disabled={pending}>
        <InputOTPGroup>
          {[0, 1, 2, 3, 4, 5].map((index) => (
            <InputOTPSlot key={index} index={index} className="size-12 text-lg" />
          ))}
        </InputOTPGroup>
      </InputOTP>

      {pending ? <Spinner className="size-5 text-muted-foreground" /> : null}
      {error ? <p className="text-sm text-destructive">{error}</p> : null}

      <Button
        variant="ghost"
        size="sm"
        disabled={cooldown > 0}
        onClick={resend}
        className="text-muted-foreground"
      >
        {cooldown > 0
          ? t("Send again in {seconds}s", { seconds: String(cooldown) })
          : t("Send the code again")}
      </Button>
    </div>
  );
}

export default function VerifyPage() {
  return (
    <Suspense>
      <Verify />
    </Suspense>
  );
}
