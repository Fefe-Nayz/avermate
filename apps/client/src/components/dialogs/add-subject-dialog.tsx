"use client";

import {
  Credenza,
  CredenzaDescription,
  CredenzaHeader,
  CredenzaTitle,
  CredenzaTrigger,
  CredenzaFormSlot,
} from "@/components/ui/credenza";
import { useState } from "react";
import { AddSubjectForm } from "../forms/add-subject-form";
import { useTranslations } from "next-intl";
import CredenzaContentWrapper from "../credenza/credenza-content-wrapper";

interface AddSubjectCredenzaProps {
  children?: React.ReactNode;
  parentId?: string;
  yearId: string;
  /** If provided, the dialog will be controlled externally */
  open?: boolean;
  /** If provided, the dialog will be controlled externally */
  onOpenChange?: (open: boolean) => void;
}

/**
 * AddSubjectCredenza - A dialog for adding subjects.
 *
 * Can be used in two modes:
 * 1. Self-managed (default): Just pass children as trigger
 * 2. Controlled: Pass open/onOpenChange to control from outside (useful when rendered inside DropDrawer)
 *
 * For DropDrawer usage, render the dialog OUTSIDE the DropDrawer and control it externally:
 * ```tsx
 * const [open, setOpen] = useState(false);
 * <>
 *   <AddSubjectDialog open={open} onOpenChange={setOpen} yearId={yearId} />
 *   <DropDrawer>
 *     <DropDrawerItem onClick={() => setOpen(true)}>Add Subject</DropDrawerItem>
 *   </DropDrawer>
 * </>
 * ```
 */
export default function AddSubjectCredenza({
  children,
  parentId,
  yearId,
  open: controlledOpen,
  onOpenChange: controlledOnOpenChange,
}: AddSubjectCredenzaProps) {
  const t = useTranslations("Dashboard.Dialogs.AddSubject");

  // Support both controlled and uncontrolled modes
  const [internalOpen, setInternalOpen] = useState(false);
  const isControlled = controlledOpen !== undefined;
  const open = isControlled ? controlledOpen : internalOpen;
  const setOpen = isControlled ? controlledOnOpenChange! : setInternalOpen;

  const close = () => {
    setOpen(false);
  };

  return (
    <Credenza
      open={open}
      onOpenChange={setOpen}
      reparentableContent={
        <AddSubjectForm
          close={close}
          parentId={parentId}
          yearId={yearId}
        />
      }
    >
      {children && (
        <CredenzaTrigger className="flex items-center" asChild>
          {children}
        </CredenzaTrigger>
      )}

      <CredenzaContentWrapper>
        <CredenzaHeader>
          <CredenzaTitle>{t("title")}</CredenzaTitle>
          <CredenzaDescription>{t("description")}</CredenzaDescription>
        </CredenzaHeader>
        <CredenzaFormSlot />
      </CredenzaContentWrapper>
    </Credenza>
  );
}
