import type { ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { Empty, Loading, Screen, Section } from "@/components/ui";
import { t } from "@/lib/i18n";
import { orpc } from "@/lib/orpc";

/** UX guard; every procedure below is independently enforced server-side. */
export function AdminGate({ children }: { children: ReactNode }) {
  const access = useQuery(orpc.admin.access.queryOptions());
  if (access.isLoading) return <Loading />;
  if (!access.data?.isAdmin) {
    return (
      <Screen>
        <Section>
          <Empty
            icon="lock-closed-outline"
            title={t("Admin access required")}
            body={t("This area is restricted to Avermate administrators.")}
          />
        </Section>
      </Screen>
    );
  }
  return children;
}
