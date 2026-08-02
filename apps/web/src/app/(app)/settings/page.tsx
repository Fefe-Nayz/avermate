"use client";

import { useState } from "react";
import { CheckIcon } from "lucide-react";
import { useExtracted } from "next-intl";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { PageMeta } from "@/components/shell/page-chrome";
import { SettingsSection } from "@/components/settings/settings-section";
import { ChoiceField, TextField } from "@/components/forms/controls";
import { AvatarEditor } from "@/components/settings/avatar-editor";
import { authClient, useSession } from "@/lib/auth-client";
import { usePreferences } from "@/hooks/use-preferences";
import { haptic } from "@/lib/haptics";
import { LOCALE_LABELS, locales } from "@/i18n/config";

export default function ProfileSettingsPage() {
  const t = useExtracted();
  const { data: session, refetch } = useSession();
  const { preferences, update } = usePreferences();

  const [name, setName] = useState(session?.user.name ?? "");
  const [saving, setSaving] = useState(false);

  const saveName = async () => {
    if (!name.trim() || name.trim() === session?.user.name) return;
    setSaving(true);
    haptic("light");
    const { error } = await authClient.updateUser({ name: name.trim() });
    setSaving(false);
    if (error) {
      haptic("error");
      toast.error(t("Your name could not be changed."));
      return;
    }
    haptic("success");
    toast.success(t("Name updated."));
    void refetch();
  };

  return (
    <>
      <PageMeta title={t("Profile")} backHref="/more" />

      <div className="flex flex-col gap-4">
        <h1 className="hidden text-2xl font-semibold tracking-tight md:block">
          {t("Profile")}
        </h1>

        <SettingsSection
          title={t("Who you are")}
          description={t("Shown only to you.")}
        >
          <AvatarEditor />

          <TextField
            label={t("Name")}
            value={name}
            onChange={(event) => setName(event.target.value)}
            onBlur={saveName}
          />

          <Button
            variant="outline"
            size="sm"
            className="self-start"
            disabled={saving || name.trim() === session?.user.name}
            onClick={saveName}
          >
            {saving ? <Spinner className="size-4" /> : <CheckIcon className="size-4" />}
            {t("Save name")}
          </Button>
        </SettingsSection>

        <SettingsSection
          title={t("Language")}
          description={t("Applies everywhere, on every device you sign in on.")}
        >
          <ChoiceField
            choices={[
              { value: "system", label: t("Match my device") },
              ...locales.map((locale) => ({
                value: locale,
                label: LOCALE_LABELS[locale],
              })),
            ]}
            value={preferences.language}
            onValueChange={(value) =>
              update({ language: value as typeof preferences.language })
            }
          />
        </SettingsSection>
      </div>
    </>
  );
}
