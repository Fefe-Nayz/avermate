import { useState } from "react";
import { Text, View } from "react-native";
import { Image } from "expo-image";
import Constants from "expo-constants";
import { Stack, useRouter } from "expo-router";
import { useMutation } from "@tanstack/react-query";
import { Button, Card, Note, Problem, Screen, Section } from "@/components/ui";
import { ChoiceField, TextField } from "@/components/field";
import { client } from "@/lib/orpc";
import { haptic } from "@/lib/haptics";
import { t } from "@/lib/i18n";
import { ImageSelectionError, selectImage } from "@/lib/image-file";
import { space, type, usePalette } from "@/lib/theme";

/**
 * Feedback.
 *
 * The kind is asked first because it changes what a useful message looks like,
 * and the placeholder changes with it — a bug report wants steps, an idea
 * wants the problem behind it.
 */
export default function Feedback() {
  const palette = usePalette();
  const router = useRouter();
  const [kind, setKind] = useState("idea");
  const [message, setMessage] = useState("");
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [image, setImage] = useState<{ file: File; uri: string } | null>(null);

  const chooseImage = async () => {
    try {
      const selected = await selectImage();
      if (selected) setImage(selected);
    } catch (cause) {
      if (cause instanceof ImageSelectionError && cause.code === "size") {
        setError(t("Choose an image smaller than 2 MB."));
      } else if (
        cause instanceof ImageSelectionError &&
        cause.code === "permission"
      ) {
        setError(t("Allow photo access to choose an image."));
      } else {
        setError(t("Choose a PNG, JPEG or WebP image."));
      }
    }
  };

  const submit = useMutation({
    mutationFn: (input: Parameters<typeof client.feedback.submit>[0]) =>
      client.feedback.submit(input),
    onSuccess: () => {
      haptic("success");
      setSent(true);
    },
    onError: () => {
      haptic("error");
      setError(t("That could not be sent. Try again in a moment."));
    },
  });

  // The server wants a subject line; deriving it from the kind beats asking
  // for one nobody wants to write on a phone.
  const subjectLine = (value: string) =>
    value === "bug"
      ? t("Bug report")
      : value === "idea"
        ? t("Idea")
        : value === "question"
          ? t("Question")
          : t("Feedback");

  const placeholder =
    kind === "bug"
      ? t("What did you do, and what happened instead?")
      : kind === "idea"
        ? t("What are you trying to do that the app makes hard?")
        : t("Ask away.");

  if (sent) {
    return (
      <>
        <Stack.Screen options={{ title: t("Send feedback") }} />
        <Screen
          footer={<Button label={t("Done")} onPress={() => router.back()} />}
        >
          <Section title={t("Thank you")}>
            <Note>
              {t(
                "It has landed. Every message gets read, even when the reply takes a while.",
              )}
            </Note>
          </Section>
        </Screen>
      </>
    );
  }

  return (
    <>
      <Stack.Screen options={{ title: t("Send feedback") }} />
      <Screen
        footer={
          <Button
            label={t("Send")}
            onPress={() =>
              submit.mutate({
                kind: kind as "bug" | "idea" | "question" | "other",
                subject: subjectLine(kind),
                message: message.trim(),
                context: {
                  route: "/settings/feedback",
                  platform: process.env.EXPO_OS ?? "unknown",
                  appVersion: Constants.expoConfig?.version ?? "unknown",
                },
                image: image?.file,
              })
            }
            disabled={message.trim().length < 10 || submit.isPending}
          />
        }
      >
        <ChoiceField
          label={t("What is it about?")}
          value={kind}
          onChange={setKind}
          choices={[
            { value: "idea", label: t("An idea") },
            { value: "bug", label: t("Something is broken") },
            { value: "question", label: t("A question") },
            { value: "other", label: t("Something else") },
          ]}
        />

        <Section title={t("Your message")}>
          <TextField
            label={t("Message")}
            value={message}
            onChangeText={setMessage}
            placeholder={placeholder}
            multiline
          />
        </Section>

        <Section title={t("Screenshot (optional)")}>
          {image ? (
            <Card>
              <View style={{ gap: space.md }}>
                <Image
                  source={image.uri}
                  contentFit="contain"
                  style={{ width: "100%", height: 180, borderRadius: 12 }}
                />
                <Text
                  selectable
                  style={[type.footnote, { color: palette.textMuted }]}
                >
                  {t("PNG, JPEG or WebP, up to 2 MB.")}
                </Text>
                <Button
                  label={t("Remove screenshot")}
                  variant="ghost"
                  onPress={() => setImage(null)}
                />
              </View>
            </Card>
          ) : (
            <Button
              label={t("Choose a screenshot")}
              variant="secondary"
              icon="image-outline"
              onPress={() => void chooseImage()}
            />
          )}
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
