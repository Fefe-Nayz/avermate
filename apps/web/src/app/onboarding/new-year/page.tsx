"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useExtracted } from "next-intl";
import { toast } from "sonner";
import { FormPage } from "@/components/forms/form-page";
import { FormSection, NumberField, TextField } from "@/components/forms/controls";
import { orpc } from "@/lib/orpc";
import { haptic } from "@/lib/haptics";

/** Adding another year later — the same questions as onboarding, one screen. */
export default function NewYearPage() {
  const t = useExtracted();
  const router = useRouter();
  const queryClient = useQueryClient();

  const defaults = useMemo(() => {
    const now = new Date();
    const startYear =
      now.getMonth() >= 7 ? now.getFullYear() : now.getFullYear() - 1;
    return {
      name: `${startYear}–${startYear + 1}`,
      start: `${startYear}-09-01`,
      end: `${startYear + 1}-07-15`,
    };
  }, []);

  const [name, setName] = useState(defaults.name);
  const [startsAt, setStartsAt] = useState(defaults.start);
  const [endsAt, setEndsAt] = useState(defaults.end);
  const [scale, setScale] = useState("20");

  const create = useMutation({
    ...orpc.years.create.mutationOptions(),
    onSuccess: async () => {
      haptic("success");
      toast.success(t("Year created."));
      await queryClient.invalidateQueries();
      router.replace("/dashboard");
    },
    onError: (error: Error) => {
      haptic("error");
      toast.error(error.message || t("The year could not be created."));
    },
  });

  return (
    <div className="mx-auto w-full max-w-2xl px-4 py-8">
      <FormPage
        title={t("New school year")}
        description={t("Subjects and periods come next.")}
        onSubmit={() =>
          create.mutate({
            name: name.trim(),
            startsAt: new Date(`${startsAt}T00:00:00`),
            endsAt: new Date(`${endsAt}T23:59:59`),
            scale: Number.parseFloat(scale) || 20,
            defaultOutOf: Number.parseFloat(scale) || 20,
            passingRatio: 0.5,
            decimals: 2,
          })
        }
        submitLabel={t("Create year")}
        submitting={create.isPending}
        disabled={!name.trim()}
      >
        <FormSection>
          <TextField
            label={t("Name")}
            required
            value={name}
            onChange={(event) => setName(event.target.value)}
            autoFocus
          />
          <div className="grid grid-cols-2 gap-3">
            <TextField
              label={t("Starts")}
              type="date"
              value={startsAt}
              onChange={(event) => setStartsAt(event.target.value)}
            />
            <TextField
              label={t("Ends")}
              type="date"
              value={endsAt}
              onChange={(event) => setEndsAt(event.target.value)}
            />
          </div>
          <NumberField
            label={t("Grades are out of")}
            value={scale}
            onValueChange={setScale}
            min={1}
          />
        </FormSection>
      </FormPage>
    </div>
  );
}
