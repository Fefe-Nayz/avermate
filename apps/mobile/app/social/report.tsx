import { useState } from "react";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useMutation } from "@tanstack/react-query";
import { ChoiceField, TextField } from "@/components/field";
import { Button, Card, Note, Problem, Screen, Section } from "@/components/ui";
import { haptic } from "@/lib/haptics";
import { t } from "@/lib/i18n";
import { orpc } from "@/lib/orpc";
import { space } from "@/lib/theme";

type Category =
  | "harassment"
  | "privacy"
  | "impersonation"
  | "unsafe_content"
  | "other";

/**
 * Reporting a person or a group. The one instruction that matters — keep
 * grades out of a moderation queue — sits beside the text box.
 */
export default function Report() {
  const router = useRouter();
  const { targetUserId, groupId } = useLocalSearchParams<{
    targetUserId?: string;
    groupId?: string;
  }>();
  const [category, setCategory] = useState<Category>("harassment");
  const [message, setMessage] = useState("");

  const create = useMutation({
    ...orpc.social.reports.create.mutationOptions(),
    onSuccess: () => {
      haptic("success");
      router.back();
    },
  });

  return (
    <>
      <Stack.Screen options={{ title: t("Report a safety concern") }} />
      <Screen>
        <Section title={t("What happened?")}>
          <Card style={{ gap: space.lg }}>
            <ChoiceField
              label={t("Category")}
              value={category}
              onChange={setCategory}
              choices={[
                { value: "harassment", label: t("Harassment") },
                { value: "privacy", label: t("Privacy") },
                { value: "impersonation", label: t("Impersonation") },
                { value: "unsafe_content", label: t("Unsafe content") },
                { value: "other", label: t("Other") },
              ]}
            />
            <TextField
              label={t("Describe the problem")}
              value={message}
              onChangeText={setMessage}
              multiline
              maxLength={2000}
            />
            <Note>
              {t(
                "Write only what a moderator needs. Do not paste grades, subject names or anyone's academic results.",
              )}
            </Note>
            {create.isError ? (
              <Problem>
                {t("The report could not be sent. Try again later.")}
              </Problem>
            ) : null}
            <Button
              label={t("Send private report")}
              disabled={message.trim().length < 10}
              loading={create.isPending}
              onPress={() =>
                create.mutate({
                  targetUserId: targetUserId || undefined,
                  groupId: groupId || undefined,
                  category,
                  message: message.trim(),
                })
              }
            />
          </Card>
        </Section>
      </Screen>
    </>
  );
}
