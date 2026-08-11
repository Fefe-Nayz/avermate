import { useEffect, useState } from "react";
import { Text } from "react-native";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { Button, Problem, Screen, Section, Title } from "@/components/ui";
import { TextField } from "@/components/field";
import { authClient } from "@/lib/auth-client";
import { haptic } from "@/lib/haptics";
import { t } from "@/lib/i18n";
import { queryClient } from "@/lib/orpc";
import { type, usePalette } from "@/lib/theme";

/** Six-digit ownership proof sent after an email/password sign-up. */
export function VerifyEmailScreen() {
  const palette = usePalette();
  const router = useRouter();
  const params = useLocalSearchParams<{ email?: string }>();
  const email = typeof params.email === "string" ? params.email.trim() : "";
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [cooldown, setCooldown] = useState(45);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setTimeout(() => setCooldown((value) => value - 1), 1000);
    return () => clearTimeout(timer);
  }, [cooldown]);

  const verify = async () => {
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
  };

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
      haptic("error");
      setError(t("That code could not be sent. Check the address."));
      return;
    }
    haptic("success");
  };

  return (
    <>
      <Stack.Screen options={{ title: "" }} />
      <Screen
        footer={
          <Button
            label={busy ? t("Checking…") : t("Confirm email")}
            onPress={() => void verify()}
            disabled={!email || code.trim().length !== 6 || busy}
            loading={busy}
          />
        }
      >
        <Title subtitle={t("Enter the six-digit code sent to your inbox.")}>
          {t("Check your email")}
        </Title>
        <Section>
          <Text selectable style={[type.callout, { color: palette.textMuted }]}>
            {email || t("No email address was provided.")}
          </Text>
          <TextField
            label={t("Code")}
            value={code}
            onChangeText={(value) => setCode(value.replace(/\D/g, "").slice(0, 6))}
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
            disabled={!email || cooldown > 0}
            onPress={() => void resend()}
          />
        </Section>
        {error ? (
          <Section>
            <Problem>{error}</Problem>
          </Section>
        ) : null}
      </Screen>
    </>
  );
}
