import { useState } from "react";
import { KeyboardAvoidingView, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { Button, Screen, Title } from "@/components/ui";
import { FieldGroup, TextField } from "@/components/field";
import { SocialAuthButtons } from "@/components/auth/social-auth-buttons";
import { signUp } from "@/lib/auth-client";
import { haptic } from "@/lib/haptics";
import { t } from "@/lib/i18n";
import { queryClient } from "@/lib/orpc";
import { space, type, usePalette } from "@/lib/theme";

export default function SignUp() {
  const palette = usePalette();
  const router = useRouter();

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);

    const result = await signUp.email({
      name: name.trim(),
      email: email.trim(),
      password,
    });

    if (result.error) {
      haptic("error");
      setError(result.error.message ?? t("That account could not be created."));
      setBusy(false);
      return;
    }

    haptic("success");
    queryClient.clear();
    router.replace({
      pathname: "/verify-email",
      params: { email: email.trim() },
    });
  };

  const ready =
    name.trim().length > 0 && email.includes("@") && password.length >= 8;

  return (
    <KeyboardAvoidingView
      behavior={process.env.EXPO_OS === "ios" ? "padding" : undefined}
      style={{ flex: 1 }}
    >
      <Screen
        footer={
          <Button
            label={t("Create account")}
            onPress={() => void submit()}
            disabled={!ready}
            loading={busy}
          />
        }
      >
        <Title subtitle={t("Free, and your grades stay yours.")}>
          {t("Create your account")}
        </Title>

        <View style={{ height: space.sm }} />

        <FieldGroup>
          <SocialAuthButtons mode="sign-in" />
          <TextField
            label={t("Name")}
            value={name}
            onChangeText={setName}
            autoComplete="name"
            autoCapitalize="words"
          />
          <TextField
            label={t("Email")}
            value={email}
            onChangeText={setEmail}
            keyboardType="email-address"
            autoCapitalize="none"
            autoComplete="email"
          />
          <TextField
            label={t("Password")}
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            autoCapitalize="none"
            autoComplete="new-password"
            error={
              password.length > 0 && password.length < 8
                ? t("Use at least 8 characters.")
                : undefined
            }
          />
          {error ? (
            <Text style={[type.footnote, { color: palette.negative }]}>
              {error}
            </Text>
          ) : null}
        </FieldGroup>
      </Screen>
    </KeyboardAvoidingView>
  );
}
