import DeleteAccountDialog from "@/components/dialogs/delete-account-dialog";
import { Card, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { useTranslations } from "next-intl";

export default function DeleteAccount() {
  const t = useTranslations("Settings.Account.DeleteAccount");

  return (
    <Card className="border-destructive/40">
      <CardHeader>
        <CardTitle>
          {t("title")}
        </CardTitle>
        <CardDescription>
          {t("description")}
        </CardDescription>
      </CardHeader>
      <div className="justify-end flex rounded-b-xl px-6 py-4 border-t border-destructive/30 bg-destructive/10">
        <DeleteAccountDialog />
      </div>
    </Card>
  );
}
