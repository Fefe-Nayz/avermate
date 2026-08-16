import { useCallback, useEffect, useState } from "react";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import {
  Button,
  Confirmation,
  Problem,
  Screen,
  Section,
  Title,
} from "@/components/ui";
import { TextField } from "@/components/field";
import { authClient } from "@/lib/auth-client";
import { haptic } from "@/lib/haptics";
import { t } from "@/lib/i18n";
import { queryClient } from "@/lib/orpc";

/** Six-digit ownership proof sent after an email/password sign-up. */
export function VerifyEmailScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ email?: string }>();
  const email = typeof params.email === "string" ? params.email.trim() : "";
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [resent, setResent] = useState(false);

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setTimeout(() => setCooldown((value) => value - 1), 1000);
    return () => clearTimeout(timer);
  }, [cooldown]);

  const verify = useCallback(async () => {
    if (!email || code.trim().length !== 6 || busy) return;
    setBusy(true);
    setError(null);
    const result = await authClient.emailOtp.verifyEmail({
      email,
      otp: code.trim(),
    });
    setBusy(false);

    if (result.error) {
      haptic("error");
      setCode("");
      setError(t("That code is not right, or it has expired."));
      return;
    }

    haptic("success");
    queryClient.clear();
    router.replace("/onboarding");
  }, [busy, code, email, router]);

  // The web form submits itself once the last digit lands.
  useEffect(() => {
    if (code.length !== 6 || busy) return;
    void verify();
  }, [busy, code, verify]);

  const resend = async () => {
    if (!email || cooldown > 0) return;
    setCooldown(45);
    setError(null);
    const result = await authClient.emailOtp.sendVerificationOtp({
      email,
      type: "email-verification",
    });
    if (result.error) {
      setCooldown(0);
      setResent(false);
      haptic("error");
      setError(t("That code could not be sent. Check the address."));
      return;
    }
    haptic("success");
    setResent(true);
  };

  return (
    <>
      <Stack.Screen options={{ title: "" }} />
      <Screen
        footer={
          email ? (
            <Button
              label={busy ? t("Checking…") : t("Confirm email")}
              onPress={() => void verify()}
              disabled={code.trim().length !== 6 || busy}
              loading={busy}
            />
          ) : (
            <Button
              label={t("Create an account")}
              onPress={() => router.replace("/sign-up")}
            />
          )
        }
      >
        <Title
          subtitle={
            email
              ? t("We sent a six-digit code to {email}.", { email })
              : t("Create an account first so we know where to send the code.")
          }
        >
          {t("Check your email")}
        </Title>
        {email ? (
          <Section>
            <TextField
              label={t("Code")}
              value={code}
              onChangeText={(value) =>
                setCode(value.replace(/\D/g, "").slice(0, 6))
              }
              keyboardType="number-pad"
              autoFocus
            />
            <Button
              label={
                cooldown > 0
                  ? t("Send again in {seconds}s", { seconds: cooldown })
                  : t("Send the code again")
              }
              variant="ghost"
              disabled={cooldown > 0}
              onPress={() => void resend()}
            />
            {resent && !error ? (
              <Confirmation>{t("A new code is on its way.")}</Confirmation>
            ) : null}
          </Section>
        ) : null}
        {error ? (
          <Section>
            <Problem>{error}</Problem>
          </Section>
        ) : null}
      </Screen>
    </>
  );
}
