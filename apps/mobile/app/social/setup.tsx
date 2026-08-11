import { useState } from "react";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useMutation, useQuery } from "@tanstack/react-query";
import { ChoiceField, SwitchField, TextField } from "@/components/field";
import { PrivacyBoundaryNotice } from "@/components/social/social-ui";
import {
  Button,
  Card,
  Confirmation,
  Empty,
  Loading,
  Note,
  Problem,
  Row,
  Screen,
  Section,
} from "@/components/ui";
import { haptic } from "@/lib/haptics";
import { t } from "@/lib/i18n";
import { orpc, queryClient } from "@/lib/orpc";
import { useSocialEligibility } from "@/components/social/social-gate";
import {
  discardSocialInvitation,
  peekSocialInvitation,
} from "@/lib/social-invitation-session";

type AgeBand = "under15" | "15to17" | "adult";

function guardianRequestStatus(status: string): string {
  if (status === "pending") return t("pending");
  if (status === "accepted") return t("accepted");
  if (status === "declined") return t("declined");
  if (status === "revoked") return t("revoked");
  return t("expired");
}

export default function SocialSetup() {
  const router = useRouter();
  const { resume } = useLocalSearchParams<{ resume?: string }>();
  const eligibility = useSocialEligibility();
  const [ageBand, setAgeBand] = useState<AgeBand | null>(null);
  const [accepted, setAccepted] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [guardianEmail, setGuardianEmail] = useState("");
  const [guardianMessage, setGuardianMessage] = useState<string | null>(null);
  const guardianRequests = useQuery(
    orpc.social.guardian.requests.queryOptions(),
  );

  const refresh = () =>
    queryClient.invalidateQueries({
      queryKey: orpc.social.eligibility.get.queryKey(),
    });
  const continueAfterEligibility = (status: string) => {
    if (status !== "active") return;
    const held = peekSocialInvitation(resume);
    if (held?.kind === "group" && resume) {
      router.replace({
        pathname: "/social/invitation-process",
        params: { flow: resume },
      });
      return;
    }
    if (held?.kind === "friend" && resume) {
      router.replace({ pathname: "/social/profile", params: { resume } });
      return;
    }
    router.replace("/social/profile");
  };
  const begin = useMutation({
    ...orpc.social.eligibility.begin.mutationOptions(),
    onSuccess: async (next) => {
      haptic("success");
      await refresh();
      continueAfterEligibility(next.status);
    },
    onError: () => {
      haptic("error");
      setProblem(t("Social setup could not be saved."));
    },
  });
  const refreshGuardian = () =>
    queryClient.invalidateQueries({
      queryKey: orpc.social.guardian.requests.queryKey(),
    });
  const requestGuardian = useMutation({
    ...orpc.social.guardian.initiate.mutationOptions(),
    onSuccess: async () => {
      haptic("success");
      setGuardianEmail("");
      setProblem(null);
      setGuardianMessage(
        t(
          "A secure, single-use link was sent. Your guardian must sign in with that exact verified email within 72 hours.",
        ),
      );
      await refreshGuardian();
    },
    onError: () => {
      haptic("error");
      setProblem(
        t(
          "The guardian request could not be sent. Verify the address or try again tomorrow.",
        ),
      );
    },
  });
  const revokeGuardian = useMutation({
    ...orpc.social.guardian.revoke.mutationOptions(),
    onSuccess: async () => {
      haptic("warning");
      await Promise.all([refreshGuardian(), refresh()]);
    },
  });

  if (eligibility.isLoading) return <Loading />;
  if (!eligibility.data || eligibility.isError) {
    return (
      <Screen>
        <Section>
          <Empty
            icon="cloud-offline-outline"
            title={t("Setup cannot be verified")}
            body={t(
              "Reconnect and try again. No social permission was changed.",
            )}
          />
        </Section>
      </Screen>
    );
  }

  const current = eligibility.data;
  const continueSetup = () => {
    if (!ageBand || !accepted) return;
    setProblem(null);
    begin.mutate({
      ageBand,
      channel: "mobile",
      acceptedPolicyVersion: current.policyVersion,
    });
  };

  const guardianPending =
    current.status === "guardian_required" ||
    current.status === "verification_expired";

  return (
    <>
      <Stack.Screen options={{ title: t("Social setup") }} />
      <Screen
        footer={
          guardianPending ? undefined : (
            <Button
              label={t("Consent and continue")}
              disabled={!ageBand || !accepted || begin.isPending}
              loading={begin.isPending}
              onPress={continueSetup}
            />
          )
        }
      >
        <PrivacyBoundaryNotice />

        {guardianPending ? (
          <Section title={t("Joint consent required")}>
            <Card padded={false}>
              <Row
                first
                title={t("Your choice is recorded")}
                subtitle={t("No profile or sharing is active yet")}
              />
              <Row
                title={t("Guardian verification is still required")}
                subtitle={t("For accounts under 15 in France")}
              />
            </Card>
            <Note>
              {t(
                "A parent or guardian must complete the verified consent flow. A name, checkbox or code shared by the student is not accepted as proof.",
              )}
            </Note>
            <TextField
              label={t("Guardian email")}
              value={guardianEmail}
              onChangeText={setGuardianEmail}
              keyboardType="email-address"
              autoCapitalize="none"
              autoComplete="email"
              placeholder="parent@example.com"
            />
            <Button
              label={t("Send secure guardian link")}
              disabled={
                !guardianEmail.includes("@") || requestGuardian.isPending
              }
              loading={requestGuardian.isPending}
              onPress={() => {
                setProblem(null);
                setGuardianMessage(null);
                requestGuardian.mutate({ guardianEmail: guardianEmail.trim() });
              }}
            />
            <Note>
              {t(
                "The guardian completes the decision on Avermate web after signing in with the addressed account. The app never receives the secret link or their email back.",
              )}
            </Note>
            {guardianMessage ? (
              <Confirmation>{guardianMessage}</Confirmation>
            ) : null}

            <Button
              label={t("Check guardian decision")}
              variant="secondary"
              onPress={() =>
                void eligibility.refetch().then((result) => {
                  if (result.data) continueAfterEligibility(result.data.status);
                })
              }
            />

            {guardianRequests.isLoading ? <Loading /> : null}
            {(guardianRequests.data?.length ?? 0) > 0 ? (
              <Card padded={false}>
                {guardianRequests.data?.map((request, index) => (
                  <Row
                    key={request.id}
                    first={index === 0}
                    title={t("Guardian request · {status}", {
                      status: guardianRequestStatus(request.status),
                    })}
                    subtitle={`${t("Request code {code}", {
                      code: request.requestCode,
                    })} · ${t("Policy {version}", {
                      version: request.policyVersion,
                    })}`}
                    destructive={
                      request.status === "pending" ||
                      request.status === "accepted"
                    }
                    onPress={
                      request.status === "pending" ||
                      request.status === "accepted"
                        ? () => revokeGuardian.mutate({ requestId: request.id })
                        : undefined
                    }
                  />
                ))}
              </Card>
            ) : null}
            {guardianRequests.isError || revokeGuardian.isError ? (
              <Problem>
                {t(
                  "Guardian request status could not be updated. No permission was granted silently.",
                )}
              </Problem>
            ) : null}
          </Section>
        ) : (
          <>
            <Section title={t("Age band")}>
              <ChoiceField<AgeBand>
                value={ageBand}
                onChange={setAgeBand}
                choices={[
                  {
                    value: "under15",
                    label: t("Under 15"),
                    hint: t(
                      "Joint consent with a verified guardian is required in France",
                    ),
                  },
                  { value: "15to17", label: t("15 to 17") },
                  { value: "adult", label: t("18 or older") },
                ]}
              />
              <Note>
                {t(
                  "Avermate stores only this broad band and assurance status, never a birth date or identity document.",
                )}
              </Note>
            </Section>

            <Section title={t("Current policy")}>
              <Card padded={false}>
                <Row
                  first
                  title={t("Policy version")}
                  subtitle={current.policyVersion}
                />
                <Row
                  title={t("Friends require mutual acceptance")}
                  subtitle={t("Exact-handle discovery only; no contact upload")}
                />
                <Row
                  title={t("Groups require a separate data choice")}
                  subtitle={t("A policy change always asks again")}
                />
                <Row
                  title={t("Named rankings are off by default")}
                  subtitle={t("Separate opt-in and privacy thresholds apply")}
                />
              </Card>
              <SwitchField
                label={t("I understand and consent to this policy")}
                hint={t(
                  "You can withdraw later; withdrawal stops future social access.",
                )}
                value={accepted}
                onValueChange={setAccepted}
              />
            </Section>
          </>
        )}

        {problem ? (
          <Section>
            <Problem>{problem}</Problem>
          </Section>
        ) : null}
        {resume && !peekSocialInvitation(resume) ? (
          <Section>
            <Problem>
              {t(
                "The private invitation continuation expired. Reopen the original link; its secret was not stored on this device.",
              )}
            </Problem>
          </Section>
        ) : null}
        {resume && peekSocialInvitation(resume) ? (
          <Section>
            <Button
              label={t("Cancel invitation setup")}
              variant="ghost"
              onPress={() => {
                discardSocialInvitation(resume);
                router.replace("/social");
              }}
            />
          </Section>
        ) : null}
      </Screen>
    </>
  );
}
