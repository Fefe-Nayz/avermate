"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckIcon } from "lucide-react";
import { useFormatter, useExtracted } from "next-intl";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { PageMeta } from "@/components/shell/page-chrome";
import { ChoiceField } from "@/components/forms/controls";
import { orpc } from "@/lib/orpc";
import { haptic } from "@/lib/haptics";

export default function AdminFeedbackPage() {
  const t = useExtracted();
  const format = useFormatter();
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<"open" | "closed" | "all">("open");

  const list = useQuery(
    orpc.admin.feedback.queryOptions({ input: { status, limit: 50 } }),
  );

  const setStatusMutation = useMutation({
    ...orpc.admin.setFeedbackStatus.mutationOptions(),
    onSuccess: () => {
      haptic("success");
      void queryClient.invalidateQueries({
        queryKey: orpc.admin.feedback.key(),
      });
    },
  });

  return (
    <>
      <PageMeta title={t("Feedback")} backHref="/admin" />

      <div className="flex flex-col gap-4">
        <h1 className="hidden text-2xl font-semibold tracking-tight md:block">
          {t("Feedback")}
        </h1>

        <ChoiceField
          choices={[
            { value: "open", label: t("Open") },
            { value: "closed", label: t("Closed") },
            { value: "all", label: t("All") },
          ]}
          value={status}
          onValueChange={setStatus}
          columns={3}
        />

        {list.isLoading ? (
          <div className="flex justify-center py-12">
            <Spinner className="size-5 text-muted-foreground" />
          </div>
        ) : null}

        <ul className="flex flex-col gap-2">
          {list.data?.map((item) => (
            <li key={item.id} className="rounded-xl border bg-card p-4">
              <div className="flex items-start gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="secondary">{item.kind}</Badge>
                    <p className="min-w-0 flex-1 truncate font-medium">
                      {item.subject}
                    </p>
                  </div>
                  <p className="mt-1.5 whitespace-pre-wrap text-sm text-muted-foreground">
                    {item.message}
                  </p>
                  <p className="mt-2 text-xs text-muted-foreground">
                    {item.userName} · {item.userEmail} ·{" "}
                    {format.dateTime(new Date(item.createdAt), {
                      day: "numeric",
                      month: "short",
                      hour: "numeric",
                      minute: "numeric",
                    })}
                  </p>
                  <p className="mt-1 font-mono text-[11px] text-muted-foreground/70">
                    {item.context}
                  </p>
                </div>
                {item.status === "open" ? (
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={t("Mark as handled")}
                    onClick={() =>
                      setStatusMutation.mutate({
                        feedbackId: item.id,
                        status: "closed",
                      })
                    }
                  >
                    <CheckIcon className="size-4" />
                  </Button>
                ) : null}
              </div>
            </li>
          ))}
        </ul>

        {list.data && list.data.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            {t("Nothing here.")}
          </p>
        ) : null}
      </div>
    </>
  );
}
