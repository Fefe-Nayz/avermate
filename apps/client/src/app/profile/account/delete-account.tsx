import DeleteAccountDialog from "@/components/dialogs/delete-account-dialog";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { useTranslations } from "next-intl";

export default function DeleteAccount() {
  const t = useTranslations("Settings.Account.DeleteAccount");

  return (
    <Card className="border-destructive/40 gap-0">
      <CardHeader className="pb-6">
        <CardTitle>{t("title")}</CardTitle>
        <CardDescription>{t("description")}</CardDescription>
      </CardHeader>
      <div className="flex justify-end rounded-b-xl border-t border-destructive/30 bg-destructive/10 px-6 pt-6 pb-6 -mb-6">
        <DeleteAccountDialog />
      </div>
    </Card>
  );
}
