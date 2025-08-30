"use client";

import {
  Credenza,
  CredenzaBody,
  CredenzaContent,
  CredenzaDescription,
  CredenzaHeader,
  CredenzaTitle,
  CredenzaTrigger,
} from "@/components/ui/credenza";
import { useState } from "react";
import { FeedbackForm } from "../forms/feedback-form";
import { useTranslations } from "next-intl";
import { z } from "zod";

export default function FeedbackDialog({
  children,
}: {
  children: React.ReactNode;
}) {
  const t = useTranslations("Dashboard.Dialogs.Feedback");
  const [open, setOpen] = useState(false);

  // Minimal schema matching form
  const FeedbackSchema = z.object({
    type: z.enum(["Général", "Bug", "Suggestion"]).optional(),
    subject: z.string().optional(),
    content: z.string().optional(),
    image: z.string().optional(),
    email: z.string().optional(),
  });
  type TFeedback = z.infer<typeof FeedbackSchema>;

  // The same shape as you had in the form's default values
  const EMPTY_FORM_DATA: TFeedback = {
    type: "Général",
    subject: "",
    content: "",
    image: "",
    email: "",
  };

  const [formData, setFormData] = useState<TFeedback>(EMPTY_FORM_DATA);

  return (
    <Credenza
      open={open}
      onOpenChange={(newOpen) => {
        setOpen(newOpen);
        if (!newOpen) {
          setFormData(EMPTY_FORM_DATA);
        }
      }}
    >
      <CredenzaTrigger asChild>{children}</CredenzaTrigger>
      <CredenzaContent>
        <CredenzaHeader>
          <CredenzaTitle>{t("title")}</CredenzaTitle>
          <CredenzaDescription>{t("description")}</CredenzaDescription>
        </CredenzaHeader>
        <CredenzaBody className="px-4 py-6 max-h-[100%] overflow-auto">
          {open && (
            <FeedbackForm
              close={() => setOpen(false)}
              formData={formData}
              setFormData={setFormData}
            />
          )}
        </CredenzaBody>
      </CredenzaContent>
    </Credenza>
  );
}