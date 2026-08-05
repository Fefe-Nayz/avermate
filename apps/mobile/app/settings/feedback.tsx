import { useState } from "react";
import { Stack, useRouter } from "expo-router";
import { useMutation } from "@tanstack/react-query";
import {
  Button,
  Note,
  Problem,
  Screen,
  Section,
} from "@/components/ui";
import { ChoiceField, TextField } from "@/components/field";
import { client } from "@/lib/orpc";
import { haptic } from "@/lib/haptics";
import { t } from "@/lib/i18n";

/**
 * Feedback.
 *
 * The kind is asked first because it changes what a useful message looks like,
 * and the placeholder changes with it — a bug report wants steps, an idea
 * wants the problem behind it.
 */
export default function Feedback() {
  const router = useRouter();
  const [kind, setKind] = useState("idea");
  const [message, setMessage] = useState("");
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
        <Screen footer={<Button label={t("Done")} onPress={() => router.back()} />}>
          <Section title={t("Thank you")}>
            <Note>{t(
                "It has landed. Every message gets read, even when the reply takes a while.",
              )}</Note>
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

        {error ? (
          <Section>
            <Problem>{error}</Problem>
          </Section>
        ) : null}
      </Screen>
    </>
  );
}
