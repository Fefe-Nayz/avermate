import { useState } from "react";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useMutation } from "@tanstack/react-query";
import { ChoiceField, TextField } from "@/components/field";
import { SocialRouteGate } from "@/components/social/social-gate";
import { PrivacyBoundaryNotice } from "@/components/social/social-ui";
import {
  Button,
  Confirmation,
  Empty,
  Note,
  Problem,
  Screen,
  Section,
} from "@/components/ui";
import { t } from "@/lib/i18n";
import { orpc, queryClient } from "@/lib/orpc";

type Source = "friendship" | "friend_request" | "group" | "group_membership";
type Category =
  "harassment" | "privacy" | "impersonation" | "unsafe_content" | "other";

function isSource(value: string | undefined): value is Source {
  return ["friendship", "friend_request", "group", "group_membership"].includes(
    value ?? "",
  );
}

export default function CreateSocialReport() {
  const params = useLocalSearchParams<{ source?: string; sourceId?: string }>();
  const router = useRouter();
  const [category, setCategory] = useState<Category>("harassment");
  const [message, setMessage] = useState("");
  const source = isSource(params.source) ? params.source : null;
  const validTarget = Boolean(source && params.sourceId);
  const create = useMutation({
    ...orpc.social.reports.create.mutationOptions(),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: orpc.social.reports.mine.queryKey(),
      });
    },
  });

  if (!validTarget) {
    return (
      <Screen>
        <Empty
          icon="lock-closed-outline"
          title={t("Invalid report target")}
          body={t("No report was sent.")}
        />
      </Screen>
    );
  }

  return (
    <SocialRouteGate requireActiveProfile={false}>
      <>
        <Stack.Screen options={{ title: t("Report a safety concern") }} />
        <Screen>
          <PrivacyBoundaryNotice compact />
          <Section title={t("What happened?")}>
            <ChoiceField<Category>
              value={category}
              onChange={setCategory}
              choices={[
                { value: "harassment", label: t("Harassment") },
                { value: "privacy", label: t("Privacy violation") },
                { value: "impersonation", label: t("Impersonation") },
                { value: "unsafe_content", label: t("Unsafe content") },
                { value: "other", label: t("Other") },
              ]}
            />
            <TextField
              label={t("Describe the concern")}
              value={message}
              onChangeText={setMessage}
              multiline
              maxLength={2000}
              placeholder={t(
                "Include useful context without copying grades or unnecessary personal data",
              )}
            />
            <Note>
              {t(
                "Reports go to Avermate’s admin moderation queue, not Discord. Blocking remains a separate immediate action.",
              )}
            </Note>
            <Button
              label={t("Submit report")}
              disabled={
                message.trim().length < 10 ||
                create.isPending ||
                create.isSuccess
              }
              loading={create.isPending}
              onPress={() =>
                create.mutate({
                  source: source!,
                  sourceId: params.sourceId!,
                  category,
                  message: message.trim(),
                })
              }
            />
            {create.isSuccess ? (
              <>
                <Confirmation>
                  {t(
                    "Report submitted. You can follow its status without exposing the reported account.",
                  )}
                </Confirmation>
                <Button
                  label={t("View submitted reports")}
                  variant="secondary"
                  onPress={() => router.replace("/social/reports")}
                />
              </>
            ) : null}
            {create.isError ? (
              <Problem>
                {t("The report could not be submitted. Try again later.")}
              </Problem>
            ) : null}
          </Section>
        </Screen>
      </>
    </SocialRouteGate>
  );
}
