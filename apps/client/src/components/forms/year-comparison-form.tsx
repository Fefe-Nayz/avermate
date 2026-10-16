"use client";

import { useEffect, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { Loader2Icon } from "lucide-react";
import { useTranslations } from "next-intl";
import { useYearComparisonSettings } from "@/hooks/use-year-comparison";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CredenzaFooter } from "@/components/ui/credenza";
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import CredenzaBodyWrapper from "@/components/credenza/credenza-body-wrapper";
import FormContentWrapper from "./form-content-wrapper";
import type { Subject } from "@/types/subject";
import type { YearComparisonMappings, YearComparisonScope } from "@/types/year-comparison";

type FormValues = YearComparisonMappings & { referenceYearId: string; scope: YearComparisonScope };
const unmatchedValue = "__unmatched__";

function subjectPath(subject: Subject, subjects: Subject[]) {
  const names = [subject.name];
  const visited = new Set([subject.id]);
  let parentId = subject.parentId;
  while (parentId && !visited.has(parentId)) {
    visited.add(parentId);
    const parent = subjects.find((entry) => entry.id === parentId);
    if (!parent) break;
    names.unshift(parent.name);
    parentId = parent.parentId;
  }
  return names.join(" › ");
}

export default function YearComparisonForm({ close, onSavingChange }: {
  close: () => void;
  onSavingChange: (saving: boolean) => void;
}) {
  const t = useTranslations("YearComparison");
  const initial = useYearComparisonSettings();
  const candidates = initial.years.filter((year) => year.id !== initial.currentYear?.id)
    .sort((a, b) => b.startDate.localeCompare(a.startDate));
  const previous = candidates.find((year) => year.startDate < (initial.currentYear?.startDate ?? ""));
  const form = useForm<FormValues>({
    defaultValues: {
      referenceYearId: initial.referenceYear?.id ?? previous?.id ?? candidates[0]?.id ?? "",
      scope: initial.scope,
      subjectMap: {},
      periodMap: {},
    },
  });
  const referenceYearId = form.watch("referenceYearId");
  const settings = useYearComparisonSettings(referenceYearId);
  const [loadedPair, setLoadedPair] = useState("");
  const drafts = useRef(new Map<string, YearComparisonMappings>());
  const [search, setSearch] = useState("");
  const pair = `${settings.activeId}:${referenceYearId}`;
  const ready = loadedPair === pair && !settings.loading && !settings.error;
  const saving = form.formState.isSubmitting;
  const subjectMap = form.watch("subjectMap");
  const periodMap = form.watch("periodMap");
  const scope = form.watch("scope");

  // Initialize each selected pair once; background refetches must preserve edits.
  useEffect(() => {
    if (settings.loading || settings.error || !settings.referenceYear || loadedPair === pair) return;
    const draft = drafts.current.get(pair);
    form.setValue("subjectMap", draft?.subjectMap ?? settings.subjectMap);
    form.setValue("periodMap", draft?.periodMap ?? settings.periodMap);
    setSearch("");
    setLoadedPair(pair);
  }, [settings.loading, settings.error, settings.referenceYear, settings.subjectMap, settings.periodMap, loadedPair, pair, form]);

  const sourceSubjects = [...settings.sourceSubjects].sort((a, b) =>
    subjectPath(a, settings.sourceSubjects).localeCompare(subjectPath(b, settings.sourceSubjects)));
  const referenceSubjects = [...settings.referenceSubjects].sort((a, b) =>
    subjectPath(a, settings.referenceSubjects).localeCompare(subjectPath(b, settings.referenceSubjects)));
  const matchedSubjects = sourceSubjects.filter((subject) => !!subjectMap[subject.id]).length;
  const matchedPeriods = settings.sourcePeriods.filter((period) => !!periodMap[period.id]).length;
  const filteredSubjects = sourceSubjects.filter((subject) =>
    subjectPath(subject, settings.sourceSubjects).toLocaleLowerCase().includes(search.toLocaleLowerCase()));

  async function submit(values: FormValues) {
    if (!ready) return;
    form.clearErrors("root");
    onSavingChange(true);
    try {
      await settings.saveMappings({ subjectMap: values.subjectMap, periodMap: values.periodMap });
      settings.setReferenceYear(values.referenceYearId);
      settings.setScope(values.scope);
      settings.setEnabled(true);
      close();
    } catch {
      form.setError("root", { message: t("saveError") });
    } finally {
      onSavingChange(false);
    }
  }

  function mappingField(kind: "subjectMap" | "periodMap", id: string, label: string,
    options: { id: string; name: string }[]) {
    const mappings = kind === "subjectMap" ? subjectMap : periodMap;
    return (
      <FormField key={id} control={form.control} name={`${kind}.${id}`} render={({ field }) => (
        <FormItem className="min-w-0">
          <FormLabel className="break-words">{label}</FormLabel>
          <Select value={field.value ?? unmatchedValue} disabled={saving}
            onValueChange={(value) => field.onChange(value === unmatchedValue ? null : value)}>
            <FormControl><SelectTrigger className="w-full min-w-0" onBlur={field.onBlur} ref={field.ref}>
              <SelectValue />
            </SelectTrigger></FormControl>
            <SelectContent><SelectGroup>
              <SelectItem value={unmatchedValue}>{t("unmatched")}</SelectItem>
              {options.map((option) => <SelectItem key={option.id} value={option.id}
                disabled={Object.entries(mappings).some(([source, target]) => source !== id && target === option.id)}>
                {option.name}
              </SelectItem>)}
            </SelectGroup></SelectContent>
          </Select>
          <FormMessage />
        </FormItem>
      )} />
    );
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(submit)} className="flex min-h-0 flex-col">
        <CredenzaBodyWrapper>
          <FormContentWrapper>
            <FormField control={form.control} name="referenceYearId" render={({ field }) => (
              <FormItem>
                <FormLabel>{t("referenceYear")}</FormLabel>
                <Select value={field.value} disabled={saving} onValueChange={(value) => {
                  if (ready) drafts.current.set(pair, {
                    subjectMap: { ...form.getValues("subjectMap") },
                    periodMap: { ...form.getValues("periodMap") },
                  });
                  form.clearErrors("root");
                  field.onChange(value);
                }}>
                  <FormControl><SelectTrigger className="w-full" onBlur={field.onBlur} ref={field.ref}>
                    <SelectValue />
                  </SelectTrigger></FormControl>
                  <SelectContent><SelectGroup>
                    {candidates.map((year) => <SelectItem key={year.id} value={year.id}>{year.name}</SelectItem>)}
                  </SelectGroup></SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )} />
            <FormField control={form.control} name="scope" render={({ field }) => (
              <FormItem>
                <FormLabel>{t("scope")}</FormLabel>
                <Select value={field.value} onValueChange={field.onChange} disabled={saving}>
                  <FormControl><SelectTrigger className="w-full" onBlur={field.onBlur} ref={field.ref}>
                    <SelectValue />
                  </SelectTrigger></FormControl>
                  <SelectContent><SelectGroup>
                    <SelectItem value="same-progress">{t("sameProgress")}</SelectItem>
                    <SelectItem value="full-period">{t("fullPeriod")}</SelectItem>
                  </SelectGroup></SelectContent>
                </Select>
                <FormDescription>{t(scope === "same-progress" ? "sameProgressHelp" : "fullPeriodHelp")}</FormDescription>
                <FormMessage />
              </FormItem>
            )} />
            {settings.error ? <p role="alert" className="text-sm text-destructive">{t("loadError")}</p>
              : !ready ? <div role="status" className="space-y-3">
                <span className="sr-only">{t("loading")}</span><Skeleton className="h-12 w-full" /><Skeleton className="h-12 w-full" />
              </div> : <div>
                <p className="text-sm text-muted-foreground">{t(settings.savedComparison ? "mappingsSaved" : "mappingsHelp")}</p>
                <Accordion type="single" collapsible>
                  <AccordionItem value="subjects">
                    <AccordionTrigger>
                      <span className="flex flex-wrap items-center gap-2">
                        {t("subjects")}<Badge variant="secondary">{matchedSubjects}/{sourceSubjects.length}</Badge>
                      </span>
                    </AccordionTrigger>
                    <AccordionContent className="space-y-4">
                      <p className="text-sm text-muted-foreground">{t("subjectsHelp")}</p>
                      {sourceSubjects.length > 6 && <Input aria-label={t("searchSubjects")} placeholder={t("searchSubjects")}
                        value={search} onChange={(event) => setSearch(event.target.value)} disabled={saving}
                        onKeyDown={(event) => { if (event.key === "Enter") event.preventDefault(); }} />}
                      {filteredSubjects.map((subject) => mappingField("subjectMap", subject.id,
                        subjectPath(subject, settings.sourceSubjects), referenceSubjects.map((reference) => ({
                          id: reference.id, name: subjectPath(reference, settings.referenceSubjects),
                        }))))}
                      {!filteredSubjects.length && <p className="text-sm text-muted-foreground">
                        {t(sourceSubjects.length ? "noSearchResults" : "emptySubjects")}
                      </p>}
                    </AccordionContent>
                  </AccordionItem>
                  {settings.sourcePeriods.length > 0 && <AccordionItem value="periods">
                    <AccordionTrigger>
                      <span className="flex flex-wrap items-center gap-2">
                        {t("periods")}<Badge variant="secondary">{matchedPeriods}/{settings.sourcePeriods.length}</Badge>
                      </span>
                    </AccordionTrigger>
                    <AccordionContent className="space-y-4">
                      <p className="text-sm text-muted-foreground">{t("fullYearAutomatic")}</p>
                      {[...settings.sourcePeriods].sort((a, b) => a.startAt.localeCompare(b.startAt))
                        .map((period) => mappingField("periodMap", period.id, period.name, settings.referencePeriods))}
                    </AccordionContent>
                  </AccordionItem>}
                </Accordion>
              </div>}
            {form.formState.errors.root && <p role="alert" className="text-sm text-destructive">
              {form.formState.errors.root.message}
            </p>}
          </FormContentWrapper>
        </CredenzaBodyWrapper>
        <CredenzaFooter className="shrink-0">
          {initial.enabled && initial.referenceYear && <Button type="button" variant="outline" disabled={saving}
            onClick={() => { initial.setEnabled(false); close(); }}>
            {t("stop")}
          </Button>}
          <Button type="submit" className="flex-1" disabled={!ready || saving}>
            {saving && <Loader2Icon className="animate-spin" aria-hidden="true" />}
            {saving ? t("saving") : initial.enabled ? t("save") : t("compare")}
          </Button>
        </CredenzaFooter>
      </form>
    </Form>
  );
}
