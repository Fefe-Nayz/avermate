import { useState } from "react";
import { useRouter } from "expo-router";
import { Button, Problem } from "@/components/ui";
import { authClient } from "@/lib/auth-client";
import { haptic } from "@/lib/haptics";
import { t } from "@/lib/i18n";
import { queryClient } from "@/lib/orpc";

/** OAuth entry points shared by sign-in and sign-up. */
export function SocialAuthButtons({ mode }: { mode: "sign-in" | "link" }) {
  const router = useRouter();
  const [pending, setPending] = useState<"google" | "microsoft" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const start = async (provider: "google" | "microsoft") => {
    if (pending) return;
    setPending(provider);
    setError(null);
    haptic("light");

    const result =
      mode === "link"
        ? await authClient.linkSocial({
            provider,
            callbackURL: "/settings/account",
          })
        : await authClient.signIn.social({ provider, callbackURL: "/" });

    if (result.error) {
      haptic("error");
      setError(t("That connection could not be started."));
      setPending(null);
      return;
    }

    haptic("success");
    queryClient.clear();
    // The Expo plugin completes the browser hand-off but intentionally leaves
    // navigation to the native app after the deep-link callback resolves.
    router.replace(mode === "link" ? "/settings/account" : "/");
  };

  return (
    <>
      <Button
        label={
          mode === "link" ? t("Link Google") : t("Continue with Google")
        }
        icon="logo-google"
        variant="secondary"
        disabled={pending !== null}
        loading={pending === "google"}
        onPress={() => void start("google")}
      />
      <Button
        label={
          mode === "link"
            ? t("Link Microsoft")
            : t("Continue with Microsoft")
        }
        icon="logo-windows"
        variant="secondary"
        disabled={pending !== null}
        loading={pending === "microsoft"}
        onPress={() => void start("microsoft")}
      />
      {error ? <Problem>{error}</Problem> : null}
    </>
  );
}
