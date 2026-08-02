"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { ShieldOffIcon } from "lucide-react";
import { useExtracted } from "next-intl";
import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Spinner } from "@/components/ui/spinner";
import { useIsAdmin } from "@/hooks/use-admin";

/**
 * The admin gate.
 *
 * Without it every query on these screens fails with a 403 and the page just
 * renders empty — which reads as a broken app rather than as a closed door.
 */
export default function AdminLayout({ children }: { children: ReactNode }) {
  const t = useExtracted();
  const { isAdmin, isLoading } = useIsAdmin();

  if (isLoading) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center">
        <Spinner className="size-5 text-muted-foreground" />
      </div>
    );
  }

  if (!isAdmin) {
    return (
      <Empty className="py-20">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <ShieldOffIcon />
          </EmptyMedia>
          <EmptyTitle>{t("This area is for administrators")}</EmptyTitle>
          <EmptyDescription>
            {t("Your account does not administer this site.")}
          </EmptyDescription>
        </EmptyHeader>
        <Button variant="outline" render={<Link href="/dashboard" />}>
          {t("Back to the dashboard")}
        </Button>
      </Empty>
    );
  }

  return <>{children}</>;
}
