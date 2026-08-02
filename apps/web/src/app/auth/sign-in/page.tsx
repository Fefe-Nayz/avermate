"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { useExtracted } from "next-intl";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { FieldGroup, FieldSeparator } from "@/components/ui/field";
import { Spinner } from "@/components/ui/spinner";
import { TextField } from "@/components/forms/controls";
import { SocialButtons } from "@/components/auth/social-buttons";
import { authClient } from "@/lib/auth-client";
import { haptic } from "@/lib/haptics";

function SignIn() {
  const t = useExtracted();
  const router = useRouter();
  const params = useSearchParams();
  const next = params.get("next") ?? "/dashboard";

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setPending(true);
    setError(null);
    haptic("light");

    const { error: failure } = await authClient.signIn.email({
      email: email.trim(),
      password,
    });

    if (failure) {
      setPending(false);
      haptic("error");
      setError(
        failure.status === 401
          ? t("That email and password do not match.")
          : (failure.message ?? t("Sign-in failed. Try again.")),
      );
      return;
    }

    haptic("success");
    toast.success(t("Welcome back."));
    router.replace(next);
  };

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">
          {t("Sign in")}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {t("Pick up where you left off.")}
        </p>
      </div>

      <SocialButtons next={next} />

      <FieldSeparator>{t("or")}</FieldSeparator>

      <form onSubmit={submit}>
        <FieldGroup>
          <TextField
            label={t("Email")}
            type="email"
            autoComplete="email"
            inputMode="email"
            required
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
          <TextField
            label={t("Password")}
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            error={error ?? undefined}
          />
          <Button type="submit" size="lg" disabled={pending}>
            {pending ? <Spinner className="size-4" /> : null}
            {t("Sign in")}
          </Button>
        </FieldGroup>
      </form>

      <div className="flex flex-col gap-2 text-center text-sm">
        <Link
          href="/auth/forgot-password"
          className="text-muted-foreground underline-offset-4 hover:underline"
        >
          {t("Forgot your password?")}
        </Link>
        <p className="text-muted-foreground">
          {t("No account yet?")}{" "}
          <Link
            href="/auth/sign-up"
            className="font-medium text-foreground underline-offset-4 hover:underline"
          >
            {t("Create an account")}
          </Link>
        </p>
      </div>
    </div>
  );
}

export default function SignInPage() {
  return (
    <Suspense>
      <SignIn />
    </Suspense>
  );
}
