"use client";

import Link from "next/link";
import { use } from "react";
import { useExtracted } from "next-intl";
import type { CardDisplay, CardMetric } from "@avermate/core";
import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@/components/ui/empty";
import { CardForm } from "@/components/cards/card-form";
import { useYear } from "@/components/year/year-provider";

export default function EditCardPage({
  params,
}: {
  params: Promise<{ cardId: string }>;
}) {
  const { cardId } = use(params);
  const t = useExtracted();
  const { cards, isLoading } = useYear();
  const card = cards.find((item) => item.id === cardId);

  if (!card) {
    if (isLoading) return null;
    return (
      <Empty className="py-16">
        <EmptyHeader>
          <EmptyTitle>{t("Card not found")}</EmptyTitle>
          <EmptyDescription>{t("It may have been removed.")}</EmptyDescription>
        </EmptyHeader>
        <Button variant="outline" render={<Link href="/dashboard" />}>
          {t("Back to the dashboard")}
        </Button>
      </Empty>
    );
  }

  return (
    <CardForm
      mode="edit"
      initial={{
        id: card.id,
        metric: card.metric as CardMetric,
        targetKind: card.targetKind as "general" | "subject" | "custom",
        targetId: card.targetId,
        goalId: card.goalId,
        display: card.display as CardDisplay,
        span: Math.min(4, Math.max(1, card.span)) as 1 | 2 | 3 | 4,
        title: card.title ?? "",
      }}
    />
  );
}
