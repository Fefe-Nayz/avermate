"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useExtracted } from "next-intl";
import { Button } from "@/components/ui/button";
import { FieldGroup } from "@/components/ui/field";
import { Spinner } from "@/components/ui/spinner";
import { TextField } from "@/components/forms/controls";
import { authClient } from "@/lib/auth-client";
import { haptic } from "@/lib/haptics";

export default function ForgotPasswordPage() {
  const t = useExtracted();
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [pending, setPending] = useState(false);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setPending(true);
    haptic("light");

    await authClient.emailOtp.sendVerificationOtp({
      email: email.trim(),
      type: "forget-password",
    });

    // Deliberately the same outcome whether or not the address exists: telling
    // a stranger which emails have accounts is a leak, not a nicety.
    haptic("success");
    router.push(`/auth/reset-password?email=${encodeURIComponent(email.trim())}`);
  };

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">
          {t("Reset your password")}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {t("We will send a code to your address.")}
        </p>
      </div>

      <form onSubmit={submit}>
        <FieldGroup>
          <TextField
            label={t("Email")}
            type="email"
            inputMode="email"
            autoComplete="email"
            required
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
          <Button type="submit" size="lg" disabled={pending}>
            {pending ? <Spinner className="size-4" /> : null}
            {t("Send the code")}
          </Button>
        </FieldGroup>
      </form>

      <p className="text-center text-sm text-muted-foreground">
        <Link
          href="/auth/sign-in"
          className="underline-offset-4 hover:underline"
        >
          {t("Back to sign in")}
        </Link>
      </p>
    </div>
  );
}
