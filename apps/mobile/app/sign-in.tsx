import { useState } from "react";
import { KeyboardAvoidingView, Pressable, Text, View } from "react-native";
import { Link, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Button } from "@/components/ui";
import { FieldGroup, TextField } from "@/components/field";
import { Wordmark } from "@/components/wordmark";
import { SocialAuthButtons } from "@/components/auth/social-auth-buttons";
import { authClient, signIn } from "@/lib/auth-client";
import { haptic } from "@/lib/haptics";
import { t } from "@/lib/i18n";
import { queryClient } from "@/lib/orpc";
import { space, type, usePalette } from "@/lib/theme";

export default function SignIn() {
  const palette = usePalette();
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);

    const result = await signIn.email({ email: email.trim(), password });

    if (result.error) {
      haptic("error");
      if (result.error.status === 403) {
        await authClient.emailOtp.sendVerificationOtp({
          email: email.trim(),
          type: "email-verification",
        });
        router.push({
          pathname: "/verify-email",
          params: { email: email.trim() },
        });
        setBusy(false);
        return;
      }
      setError(
        result.error.status === 401
          ? t("That email and password do not match.")
          : t("Sign-in failed. Try again."),
      );
      setBusy(false);
      return;
    }

    haptic("success");
    // The session changed, so every cached answer was for someone else.
    queryClient.clear();
    router.replace("/");
  };

  const ready = email.includes("@") && password.length > 0;

  return (
    <KeyboardAvoidingView
      behavior={process.env.EXPO_OS === "ios" ? "padding" : undefined}
      style={{
        flex: 1,
        backgroundColor: palette.background,
        paddingTop: insets.top,
        paddingBottom: insets.bottom,
      }}
    >
      <View
        style={{
          flex: 1,
          justifyContent: "center",
          paddingHorizontal: space.lg,
          gap: space.xxl,
        }}
      >
        <View style={{ gap: space.sm }}>
          <Wordmark />
          <Text style={[type.display, { color: palette.text }]}>
            {t("Sign in")}
          </Text>
          <Text style={[type.callout, { color: palette.textMuted }]}>
            {t("Pick up where you left off.")}
          </Text>
        </View>

        <FieldGroup>
          <SocialAuthButtons mode="sign-in" />
          <TextField
            label={t("Email")}
            value={email}
            onChangeText={setEmail}
            keyboardType="email-address"
            autoCapitalize="none"
            autoComplete="email"
            placeholder="vous@exemple.fr"
          />
          <TextField
            label={t("Password")}
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            autoComplete="password"
            autoCapitalize="none"
          />
          <Link href="/forgot-password" asChild>
            <Pressable hitSlop={8} style={{ alignSelf: "flex-end" }}>
              <Text style={[type.footnote, { color: palette.text, fontWeight: "600" }]}>
                {t("Forgot password?")}
              </Text>
            </Pressable>
          </Link>
          {error ? (
            <Text style={[type.footnote, { color: palette.negative }]}>
              {error}
            </Text>
          ) : null}
          <Button
            label={busy ? t("Signing in…") : t("Sign in")}
            onPress={() => void submit()}
            disabled={!ready}
            loading={busy}
          />
        </FieldGroup>

        <View
          style={{
            flexDirection: "row",
            justifyContent: "center",
            gap: space.xs,
          }}
        >
          <Text style={[type.footnote, { color: palette.textMuted }]}>
            {t("No account yet?")}
          </Text>
          <Link href="/sign-up" asChild>
            <Pressable hitSlop={8}>
              <Text
                style={[
                  type.footnote,
                  { color: palette.text, fontWeight: "600" },
                ]}
              >
                {t("Create an account")}
              </Text>
            </Pressable>
          </Link>
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}
