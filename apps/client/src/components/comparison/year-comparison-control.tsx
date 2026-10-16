"use client";

import { useState } from "react";
import { ArrowLeftRight, Check, LoaderCircle, Settings2, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { useYearComparison, useYearComparisonSettings } from "@/hooks/use-year-comparison";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Credenza, CredenzaBody, CredenzaClose, CredenzaContent, CredenzaDescription, CredenzaFooter, CredenzaHeader, CredenzaTitle } from "@/components/ui/credenza";
import type { Subject } from "@/types/subject";

const selectClass = "h-10 w-full min-w-0 rounded-md border border-input bg-background px-3 text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50";

function subjectLabel(subject: Subject, subjects: Subject[]) {
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

function MappingForm({ settings, onSaved, onSavingChange }: {
  settings: ReturnType<typeof useYearComparisonSettings>;
  onSaved: () => void;
  onSavingChange: (saving: boolean) => void;
}) {
  const t = useTranslations("YearComparison");
  const [subjectMap, setSubjectMap] = useState(settings.subjectMap);
  const [periodMap, setPeriodMap] = useState(settings.periodMap);
  const [search, setSearch] = useState("");
  const [failed, setFailed] = useState(false);
  const sourceSubjects = [...settings.sourceSubjects].sort((a, b) => subjectLabel(a, settings.sourceSubjects).localeCompare(subjectLabel(b, settings.sourceSubjects)));
  const referenceSubjects = [...settings.referenceSubjects].sort((a, b) => subjectLabel(a, settings.referenceSubjects).localeCompare(subjectLabel(b, settings.referenceSubjects)));
  const count = sourceSubjects.filter((subject) => !!subjectMap[subject.id]).length;

  async function save() {
    setFailed(false);
    onSavingChange(true);
    try {
      await settings.saveMappings({ subjectMap, periodMap });
      settings.setReferenceYear(settings.referenceYear!.id);
      settings.setEnabled(true);
      onSaved();
    } catch {
      setFailed(true);
    } finally {
      onSavingChange(false);
    }
  }

  return <>
    <CredenzaBody className="min-h-0 overflow-y-auto pb-2">
      <fieldset disabled={settings.isSaving} className="space-y-5 disabled:opacity-70">
      <div className="rounded-lg border bg-muted/30 p-3 text-sm text-muted-foreground">{t("method")}</div>
      <section className="space-y-3" aria-labelledby="comparison-periods-title">
        <h3 id="comparison-periods-title" className="font-semibold">{t("periods")}</h3>
        <p className="text-xs text-muted-foreground">{t("periodsHelp")}</p>
        {[...settings.sourcePeriods].sort((a, b) => a.startAt.localeCompare(b.startAt)).map((period) => (
          <div key={period.id} className="grid items-center gap-2 sm:grid-cols-2">
            <Label htmlFor={`compare-period-${period.id}`} className="min-w-0 break-words">{period.name}</Label>
            <select id={`compare-period-${period.id}`} className={selectClass} value={periodMap[period.id] ?? ""}
              onChange={(event) => setPeriodMap({ ...periodMap, [period.id]: event.target.value || null })}>
              <option value="">{t("unmatched")}</option>
              {settings.referencePeriods.map((reference) => <option key={reference.id} value={reference.id}
                disabled={Object.entries(periodMap).some(([source, target]) => source !== period.id && target === reference.id)}>{reference.name}</option>)}
            </select>
          </div>
        ))}
        <p className="text-xs text-muted-foreground">{t("fullYearAutomatic")}</p>
      </section>
      <section className="space-y-3" aria-labelledby="comparison-subjects-title">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 id="comparison-subjects-title" className="font-semibold">{t("subjects")}</h3>
          <span className="text-xs text-muted-foreground">{t("mappedCount", { count, total: sourceSubjects.length })}</span>
        </div>
        <p className="text-xs text-muted-foreground">{t("subjectsHelp")}</p>
        <Input aria-label={t("searchSubjects")} placeholder={t("searchSubjects")} value={search} onChange={(event) => setSearch(event.target.value)} />
        {sourceSubjects.filter((subject) => subjectLabel(subject, settings.sourceSubjects).toLocaleLowerCase().includes(search.toLocaleLowerCase())).map((subject) => (
          <div key={subject.id} className="grid items-center gap-2 border-b pb-3 last:border-0 sm:grid-cols-2">
            <Label htmlFor={`compare-subject-${subject.id}`} className="min-w-0 break-words leading-relaxed">{subjectLabel(subject, settings.sourceSubjects)}</Label>
            <select id={`compare-subject-${subject.id}`} className={selectClass} value={subjectMap[subject.id] ?? ""}
              onChange={(event) => setSubjectMap({ ...subjectMap, [subject.id]: event.target.value || null })}>
              <option value="">{t("unmatched")}</option>
              {referenceSubjects.map((reference) => <option key={reference.id} value={reference.id}
                disabled={Object.entries(subjectMap).some(([source, target]) => source !== subject.id && target === reference.id)}>{subjectLabel(reference, settings.referenceSubjects)}</option>)}
            </select>
          </div>
        ))}
        {sourceSubjects.length === 0 && <p className="text-sm text-muted-foreground">{t("emptySubjects")}</p>}
      </section>
      <p className="text-xs text-muted-foreground">{t("savedHelp")}</p>
      {failed && <p role="alert" className="text-sm text-destructive">{t("saveError")}</p>}
      </fieldset>
    </CredenzaBody>
    <CredenzaFooter className="shrink-0 border-t pt-4">
      <CredenzaClose asChild><Button variant="outline" disabled={settings.isSaving}>{t("cancel")}</Button></CredenzaClose>
      <Button disabled={settings.isSaving} onClick={save} className="w-full sm:w-auto">
        {settings.isSaving ? <LoaderCircle className="size-4 animate-spin" /> : <Check className="size-4" />}
        {settings.isSaving ? t("saving") : t("saveAndCompare")}
      </Button>
    </CredenzaFooter>
  </>;
}

function ComparisonDialog({ onSaved }: { onSaved: () => void }) {
  const t = useTranslations("YearComparison");
  const initial = useYearComparisonSettings();
  const [saving, setSaving] = useState(false);
  const candidates = [...initial.years].filter((year) => year.id !== initial.currentYear?.id)
    .sort((a, b) => b.startDate.localeCompare(a.startDate));
  const previous = candidates.find((year) => year.startDate < (initial.currentYear?.startDate ?? ""));
  const [selectedId, setSelectedId] = useState(initial.referenceYear?.id ?? previous?.id ?? candidates[0]?.id ?? "");
  const settings = useYearComparisonSettings(selectedId);

  return <>
    <CredenzaHeader>
      <CredenzaTitle>{t("title")}</CredenzaTitle>
      <CredenzaDescription>{t("description", { year: initial.currentYear?.name ?? "" })}</CredenzaDescription>
    </CredenzaHeader>
    <div className="shrink-0 space-y-2 px-4 md:px-0">
      <Label htmlFor="comparison-reference-year">{t("referenceYear")}</Label>
      <select id="comparison-reference-year" disabled={saving} className={selectClass} value={selectedId} onChange={(event) => setSelectedId(event.target.value)}>
        {candidates.map((year) => <option key={year.id} value={year.id}>{year.name}</option>)}
      </select>
    </div>
    {settings.loading ? <p role="status" className="p-4 text-sm text-muted-foreground">{t("loading")}</p>
      : settings.error ? <p role="alert" className="p-4 text-sm text-destructive">{t("loadError")}</p>
      : settings.referenceYear && <MappingForm key={`${initial.currentYear?.id}:${selectedId}`} settings={settings} onSaved={onSaved} onSavingChange={setSaving} />}
  </>;
}

export default function YearComparisonControl() {
  const t = useTranslations("YearComparison");
  const comparison = useYearComparison();
  const settings = useYearComparisonSettings();
  const [open, setOpen] = useState(false);
  if (!settings.currentYear || settings.years.length < 2) return null;
  return <div className="border-t bg-muted/20">
    <div className="mx-auto flex max-w-[2000px] flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-16 lg:px-32 2xl:px-64 3xl:px-96">
      <div className="flex min-w-0 items-center gap-2 text-sm">
        <ArrowLeftRight className="size-4 shrink-0 text-muted-foreground" />
        <span className="min-w-0 break-words">{comparison.active
          ? t("comparing", { current: settings.currentYear.name, reference: comparison.referenceYear?.name ?? "" })
          : t("intro")}</span>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {comparison.active && <>
          <select aria-label={t("scope")} className={`${selectClass} w-auto max-w-full text-xs`} value={comparison.scope}
            onChange={(event) => comparison.setScope(event.target.value as "same-progress" | "full-period")}>
            <option value="same-progress">{t("sameProgress")}</option>
            <option value="full-period">{t("fullPeriod")}</option>
          </select>
          <Button variant="ghost" size="sm" onClick={() => comparison.setEnabled(false)} aria-label={t("stop")}><X className="size-4" /><span className="hidden sm:inline">{t("stop")}</span></Button>
        </>}
        {!comparison.active && settings.referenceYear && <Button variant="ghost" size="sm" onClick={() => settings.setEnabled(true)}>{t("resume")}</Button>}
        <Button variant={comparison.active ? "outline" : "secondary"} size="sm" onClick={() => setOpen(true)}>
          {comparison.active && <Settings2 className="size-4" />}{comparison.active ? t("configure") : t("compare")}
        </Button>
      </div>
      {comparison.active && comparison.error && <p role="alert" className="w-full text-xs text-destructive">{t("loadError")}</p>}
    </div>
    <Credenza open={open} onOpenChange={setOpen}>
      <CredenzaContent className="flex max-h-[85dvh] flex-col overflow-hidden md:max-w-2xl">
        {open && <ComparisonDialog key={settings.currentYear.id} onSaved={() => setOpen(false)} />}
      </CredenzaContent>
    </Credenza>
  </div>;
}
