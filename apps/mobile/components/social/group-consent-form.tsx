import { useMemo, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { ChoiceField, SwitchField } from "@/components/field";
import { socialExposureLabel, socialMetricLabel } from "./social-copy";
import { isSocialMetric, type SocialMetric } from "./social-model";
import { GroupPolicySummary, type GroupPolicyView } from "./group-policy-ui";
import { Button, Note, Problem, Section } from "@/components/ui";
import { useYear } from "@/components/year-provider";
import { t } from "@/lib/i18n";
import { orpc } from "@/lib/orpc";

export function GroupConsentForm({
  groupId,
  policy,
  onAccepted,
}: {
  groupId: string;
  policy: GroupPolicyView;
  onAccepted: () => void | Promise<void>;
}) {
  const { year, years } = useYear();
  const [selected, setSelected] = useState<Set<SocialMetric>>(new Set());
  const [sharedYearId, setSharedYearId] = useState(year?.id ?? "");
  const [accepted, setAccepted] = useState(false);
  const required = useMemo(
    () =>
      policy.fields
        .filter((field) => field.required && isSocialMetric(field.fieldKey))
        .map((field) => field.fieldKey as SocialMetric),
    [policy],
  );
  const valid =
    Boolean(sharedYearId) &&
    accepted &&
    required.every((metric) => selected.has(metric));
  const reconsent = useMutation({
    ...orpc.social.groups.policy.reconsent.mutationOptions(),
    onSuccess: onAccepted,
  });

  return (
    <>
      <GroupPolicySummary policy={policy} />
      <Section title={t("Your explicit choices")}>
        <Note>
          {t("Select only the derived metrics you agree to share. Raw grades, subject names, comments and dates stay excluded.")}
        </Note>
        {policy.fields.map((field) => {
          if (!isSocialMetric(field.fieldKey)) return null;
          const metric = field.fieldKey;
          const checked = selected.has(metric);
          return (
            <SwitchField
              key={metric}
              label={socialMetricLabel(metric)}
              hint={`${socialExposureLabel(field.exposure)} · ${
                field.required ? t("Required") : t("Optional")
              }`}
              value={checked}
              onValueChange={(enabled) =>
                setSelected((current) => {
                  const next = new Set(current);
                  if (enabled) next.add(metric);
                  else next.delete(metric);
                  return next;
                })
              }
            />
          );
        })}
        <ChoiceField<string>
          label={t("School year used to derive these metrics")}
          value={sharedYearId}
          onChange={setSharedYearId}
          choices={years.map((item) => ({ value: item.id, label: item.name }))}
        />
        <SwitchField
          label={t("I accept this exact policy version")}
          hint={t("A future policy version stops sharing and asks for consent again.")}
          value={accepted}
          onValueChange={setAccepted}
        />
        <Button
          label={t("Accept selected fields and join")}
          disabled={!valid || reconsent.isPending}
          loading={reconsent.isPending}
          onPress={() =>
            reconsent.mutate({
              groupId,
              policyDigest: policy.digest,
              selectedFields: [...selected],
              sharedYearId,
              accepted: true,
              channel: "mobile",
            })
          }
        />
        {reconsent.isError ? (
          <Problem>
            {t("Consent could not be saved. The policy may have changed; refresh before deciding again.")}
          </Problem>
        ) : null}
      </Section>
    </>
  );
}
