"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useFormatter, useTranslations } from "next-intl";
import {
  Calculator,
  Info,
  Loader2,
  Pencil,
  Plus,
  Trash2,
  Weight,
} from "lucide-react";

import GradeValue from "@/components/dashboard/grade-value";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Credenza,
  CredenzaDescription,
  CredenzaFooter,
  CredenzaHeader,
  CredenzaTitle,
} from "@/components/ui/credenza";
import CredenzaContentWrapper from "@/components/credenza/credenza-content-wrapper";
import CredenzaBodyWrapper from "@/components/credenza/credenza-body-wrapper";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { apiClient } from "@/lib/api";
import { toast } from "@/lib/toast";
import { cn } from "@/lib/utils";
import type { Grade, GradeComponent } from "@/types/grade";

type CompositeFormState = {
  name: string;
  value: string;
  outOf: string;
  coefficient: string;
};

const emptyForm: CompositeFormState = {
  name: "",
  value: "",
  outOf: "20",
  coefficient: "1",
};

function componentToForm(component: GradeComponent): CompositeFormState {
  return {
    name: component.name,
    value: String(component.value / 100),
    outOf: String(component.outOf / 100),
    coefficient: String(component.coefficient / 100),
  };
}

function parseForm(form: CompositeFormState) {
  const valueInput = form.value.trim();
  const outOfInput = form.outOf.trim();
  const coefficientInput = form.coefficient.trim();

  if (!form.name.trim() || !valueInput || !outOfInput || !coefficientInput) {
    throw new Error("FORM_INCOMPLETE");
  }

  const value = Number(valueInput);
  const outOf = Number(outOfInput);
  const coefficient = Number(coefficientInput);

  if (
    !Number.isFinite(value) ||
    !Number.isFinite(outOf) ||
    !Number.isFinite(coefficient)
  ) {
    throw new Error("FORM_INCOMPLETE");
  }

  if (outOf <= 0 || coefficient <= 0) {
    throw new Error("INVALID_SCALE");
  }

  if (value > outOf) {
    throw new Error("VALUE_EXCEEDS_OUT_OF");
  }

  return {
    name: form.name.trim(),
    value,
    outOf,
    coefficient,
  };
}

function computePreview(grade: Grade) {
  const components = grade.components ?? [];
  let totalWeightedPercentages = 0;
  let totalCoefficients = 0;

  for (const component of components) {
    if (component.outOf <= 0 || component.coefficient <= 0) {
      continue;
    }

    const coefficient = component.coefficient / 100;
    totalWeightedPercentages += (component.value / component.outOf) * coefficient;
    totalCoefficients += coefficient;
  }

  if (totalCoefficients <= 0) {
    return null;
  }

  return Math.round((totalWeightedPercentages / totalCoefficients) * grade.outOf);
}

function ComponentEditorDialog({
  open,
  form,
  isEditing,
  isPending,
  onOpenChange,
  onFormChange,
  onSubmit,
}: {
  open: boolean;
  form: CompositeFormState;
  isEditing: boolean;
  isPending: boolean;
  onOpenChange: (open: boolean) => void;
  onFormChange: (form: CompositeFormState) => void;
  onSubmit: () => void;
}) {
  const t = useTranslations("Dashboard.Pages.CompositeGradeSection");
  const parsedValue = form.value.trim() ? Number(form.value) : NaN;
  const parsedOutOf = form.outOf.trim() ? Number(form.outOf) : NaN;
  const previewValue =
    Number.isFinite(parsedValue) && Number.isFinite(parsedOutOf) && parsedOutOf > 0
      ? Math.round(parsedValue * 100)
      : null;
  const previewOutOf =
    Number.isFinite(parsedOutOf) && parsedOutOf > 0
      ? Math.round(parsedOutOf * 100)
      : null;

  return (
    <Credenza open={open} onOpenChange={onOpenChange}>
      <CredenzaContentWrapper>
        <CredenzaHeader>
          <CredenzaTitle>
            {isEditing ? t("editSubGradeTitle") : t("addSubGradeTitle")}
          </CredenzaTitle>
          <CredenzaDescription>
            {t("editorDescription")}
          </CredenzaDescription>
        </CredenzaHeader>

        <CredenzaBodyWrapper>
          <div className="grid gap-4">
          <div className="rounded-lg border bg-muted/30 p-4">
            <div className="flex items-start gap-3">
              <div className="rounded-md border bg-background p-2 text-muted-foreground">
                <Calculator className="size-4" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium">{t("preview")}</p>
                <div className="mt-2">
                  {previewValue !== null && previewOutOf !== null ? (
                    <GradeValue value={previewValue} outOf={previewOutOf} size="sm" />
                  ) : (
                    <p className="text-lg font-semibold text-muted-foreground">
                      --/--
                    </p>
                  )}
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  {t("previewDescription", {
                    coefficient: form.coefficient || "1",
                  })}
                </p>
              </div>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="component-name">{t("subGradeNameLabel")}</Label>
            <Input
              id="component-name"
              value={form.name}
              onChange={(event) =>
                onFormChange({ ...form, name: event.target.value })
              }
              placeholder={t("subGradeNamePlaceholder")}
            />
          </div>

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-[1fr_1fr_0.8fr]">
            <div className="space-y-2">
              <Label htmlFor="component-value">{t("valueLabel")}</Label>
              <Input
                id="component-value"
                type="number"
                inputMode="decimal"
                min={0}
                value={form.value}
                onChange={(event) =>
                  onFormChange({ ...form, value: event.target.value })
                }
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="component-out-of">{t("outOfLabel")}</Label>
              <Input
                id="component-out-of"
                type="number"
                inputMode="decimal"
                min={0.01}
                value={form.outOf}
                onChange={(event) =>
                  onFormChange({ ...form, outOf: event.target.value })
                }
              />
            </div>
            <div className="col-span-2 space-y-2 sm:col-span-1">
              <Label htmlFor="component-coefficient">{t("coefficientLabel")}</Label>
              <Input
                id="component-coefficient"
                type="number"
                inputMode="decimal"
                min={0.01}
                value={form.coefficient}
                onChange={(event) =>
                  onFormChange({ ...form, coefficient: event.target.value })
                }
              />
            </div>
          </div>

          <div className="flex gap-2 rounded-md border border-dashed bg-background px-3 py-2 text-xs text-muted-foreground">
            <Info className="mt-0.5 size-3.5 shrink-0" />
            {t("editorInfo")}
          </div>
          </div>
        </CredenzaBodyWrapper>

        <CredenzaFooter className="px-4 pb-6 md:px-0 md:pb-0">
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
          >
            {t("cancel")}
          </Button>
          <Button type="button" onClick={onSubmit} disabled={isPending}>
            {isPending ? <Loader2 className="size-4 animate-spin" /> : null}
            {isEditing ? t("save") : t("add")}
          </Button>
        </CredenzaFooter>
      </CredenzaContentWrapper>
    </Credenza>
  );
}

export function CompositeGradeSection({
  grade,
  openCreateNonce = 0,
}: {
  grade: Grade;
  openCreateNonce?: number;
}) {
  const t = useTranslations("Dashboard.Pages.CompositeGradeSection");
  const formatter = useFormatter();
  const queryClient = useQueryClient();
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingComponentId, setEditingComponentId] = useState<string | null>(null);
  const [form, setForm] = useState<CompositeFormState>(emptyForm);
  const lastOpenCreateNonceRef = useRef(0);
  const autoRevertOnCancelRef = useRef(false);
  const components = grade.components ?? [];
  const previewValue = useMemo(() => computePreview(grade), [grade]);
  const totalCoefficient = components.reduce(
    (sum, component) => sum + component.coefficient / 100,
    0
  );
  const formatNumber = (value: number) =>
    formatter.number(value, { maximumFractionDigits: 2 });

  const invalidateGradeData = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["grades"] }),
      queryClient.invalidateQueries({ queryKey: ["grades", grade.id] }),
      queryClient.invalidateQueries({ queryKey: ["subjects"] }),
      queryClient.invalidateQueries({
        queryKey: ["subjects", "organized-by-periods"],
      }),
      queryClient.invalidateQueries({ queryKey: ["recent-grades"] }),
    ]);
  };

  const saveComponentMutation = useMutation({
    mutationKey: ["grades", grade.id, "save-component", editingComponentId],
    mutationFn: async () => {
      const payload = parseForm(form);

      if (editingComponentId) {
        const response = await apiClient.patch(
          `grades/${grade.id}/components/${editingComponentId}`,
          { json: payload }
        );
        return response.json();
      }

      const response = await apiClient.post(`grades/${grade.id}/components`, {
        json: payload,
      });
      return response.json();
    },
    onSuccess: async () => {
      toast.success(
        editingComponentId ? t("toasts.subGradeUpdated") : t("toasts.subGradeAdded")
      );
      autoRevertOnCancelRef.current = false;
      setForm(emptyForm);
      setEditingComponentId(null);
      setEditorOpen(false);
      await invalidateGradeData();
    },
    onError: (error) => {
      if (error instanceof Error && error.message === "VALUE_EXCEEDS_OUT_OF") {
        toast.error(t("toasts.valueExceedsOutOf"));
        return;
      }

      if (error instanceof Error && error.message === "INVALID_SCALE") {
        toast.error(t("toasts.invalidScale"));
        return;
      }

      toast.error(t("toasts.saveError"));
    },
  });

  const deleteComponentMutation = useMutation({
    mutationKey: ["grades", grade.id, "delete-component"],
    mutationFn: async (componentId: string) => {
      const response = await apiClient.delete(
        `grades/${grade.id}/components/${componentId}`
      );
      return response.json<{ grade: Grade; components: GradeComponent[] }>();
    },
    onSuccess: async (data) => {
      toast.success(
        data.grade.isComposite
          ? t("toasts.subGradeDeleted")
          : t("toasts.revertedToSimpleGrade")
      );
      await invalidateGradeData();
    },
    onError: () => {
      toast.error(t("toasts.deleteError"));
    },
  });

  const revertCompositeMutation = useMutation({
    mutationKey: ["grades", grade.id, "revert-composite"],
    mutationFn: async () => {
      const response = await apiClient.delete(`grades/${grade.id}/composite`);
      return response.json<{ grade: Grade; components: GradeComponent[] }>();
    },
    onSuccess: async () => {
      toast.info(t("toasts.compositeCancelled"));
      await invalidateGradeData();
    },
    onError: () => {
      toast.error(t("toasts.cancelError"));
    },
  });

  const openCreateDialog = () => {
    setEditingComponentId(null);
    setForm(emptyForm);
    setEditorOpen(true);
  };

  const openEditDialog = (component: GradeComponent) => {
    setEditingComponentId(component.id);
    setForm(componentToForm(component));
    setEditorOpen(true);
  };

  useEffect(() => {
    if (!grade.isComposite || openCreateNonce <= lastOpenCreateNonceRef.current) {
      return;
    }

    lastOpenCreateNonceRef.current = openCreateNonce;
    autoRevertOnCancelRef.current = true;
    openCreateDialog();
  }, [grade.isComposite, openCreateNonce]);

  const handleEditorOpenChange = (open: boolean) => {
    setEditorOpen(open);

    if (open) {
      return;
    }

    const shouldRevertComposite =
      autoRevertOnCancelRef.current &&
      !editingComponentId &&
      components.length <= 1 &&
      !saveComponentMutation.isPending;

    autoRevertOnCancelRef.current = false;
    setEditingComponentId(null);
    setForm(emptyForm);

    if (shouldRevertComposite) {
      revertCompositeMutation.mutate();
    }
  };

  if (!grade.isComposite) {
    return null;
  }

  return (
    <Card className="rounded-lg">
      <CardHeader className="pb-4">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex items-start gap-3">
            <div className="rounded-md border bg-muted p-2 text-muted-foreground">
              <Calculator className="size-4" />
            </div>
            <div className="space-y-1">
              <CardTitle className="text-base">{t("title")}</CardTitle>
              <CardDescription>
                {t("description")}
              </CardDescription>
            </div>
          </div>

          <Button
            variant="outline"
            onClick={openCreateDialog}
            className="w-full sm:w-auto"
          >
            <Plus className="size-4" />
            {t("addSubGrade")}
          </Button>
        </div>
      </CardHeader>

      <CardContent className="space-y-4 border-t pt-4">
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="rounded-md border p-3">
            <p className="text-xs text-muted-foreground">{t("currentResult")}</p>
            <GradeValue value={grade.value} outOf={grade.outOf} size="sm" />
          </div>
          <div className="rounded-md border p-3">
            <p className="text-xs text-muted-foreground">{t("subGrades")}</p>
            <p className="text-lg font-semibold">{components.length}</p>
          </div>
          <div className="rounded-md border p-3">
            <p className="text-xs text-muted-foreground">{t("totalCoefficient")}</p>
            <p className="flex items-center gap-2 text-lg font-semibold">
              <Weight className="size-4 text-muted-foreground" />
              {formatNumber(totalCoefficient)}
            </p>
          </div>
        </div>

        {components.length === 1 ? (
          <div className="rounded-md border border-dashed bg-muted/30 p-3 text-sm text-muted-foreground">
            {t("singleSubGradeHint")}
          </div>
        ) : null}

        <div className="overflow-hidden rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("table.name")}</TableHead>
                <TableHead className="text-right">{t("table.grade")}</TableHead>
                <TableHead className="text-right">
                  {t("table.coefficient")}
                </TableHead>
                <TableHead className="w-[96px] text-right">
                  {t("table.actions")}
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {components.map((component) => (
                <TableRow key={component.id}>
                  <TableCell className="font-medium">{component.name}</TableCell>
                  <TableCell className="text-right">
                    {formatNumber(component.value / 100)}/
                    {formatNumber(component.outOf / 100)}
                  </TableCell>
                  <TableCell className="text-right">
                    {formatNumber(component.coefficient / 100)}
                  </TableCell>
                  <TableCell>
                    <div className="flex justify-end gap-1">
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        onClick={() => openEditDialog(component)}
                      >
                        <Pencil className="size-4" />
                        <span className="sr-only">{t("edit")}</span>
                      </Button>
                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                            disabled={deleteComponentMutation.isPending}
                          >
                            <Trash2 className="size-4" />
                            <span className="sr-only">{t("delete")}</span>
                          </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>
                              {t("deleteDialog.title")}
                            </AlertDialogTitle>
                            <AlertDialogDescription>
                              {t("deleteDialog.description")}
                            </AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>{t("cancel")}</AlertDialogCancel>
                            <AlertDialogAction
                              className={cn(
                                buttonVariants({ variant: "destructive" })
                              )}
                              onClick={() =>
                                deleteComponentMutation.mutate(component.id)
                              }
                            >
                              {t("delete")}
                            </AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>

        {previewValue !== null ? (
          <div className="flex items-center justify-between rounded-md bg-muted/40 px-3 py-2 text-sm">
            <span className="text-muted-foreground">{t("recalculatedPreview")}</span>
            <GradeValue value={previewValue} outOf={grade.outOf} size="sm" />
          </div>
        ) : null}
      </CardContent>

      <ComponentEditorDialog
        open={editorOpen}
        form={form}
        isEditing={Boolean(editingComponentId)}
        isPending={saveComponentMutation.isPending}
        onOpenChange={handleEditorOpenChange}
        onFormChange={setForm}
        onSubmit={() => saveComponentMutation.mutate()}
      />
    </Card>
  );
}
