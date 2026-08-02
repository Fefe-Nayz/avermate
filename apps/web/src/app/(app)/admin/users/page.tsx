"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { SearchIcon, ShieldIcon, UserXIcon } from "lucide-react";
import { useFormatter, useExtracted } from "next-intl";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { PageMeta } from "@/components/shell/page-chrome";
import { orpc } from "@/lib/orpc";
import { haptic } from "@/lib/haptics";

export default function AdminUsersPage() {
  const t = useExtracted();
  const format = useFormatter();
  const queryClient = useQueryClient();
  const [query, setQuery] = useState("");

  const users = useQuery(
    orpc.admin.users.queryOptions({
      input: { query, limit: 50, offset: 0 },
    }),
  );

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: orpc.admin.users.key() });

  const setRole = useMutation({
    ...orpc.admin.setRole.mutationOptions(),
    onSuccess: () => {
      haptic("success");
      toast.success(t("Role updated."));
      void invalidate();
    },
  });

  const setBanned = useMutation({
    ...orpc.admin.setBanned.mutationOptions(),
    onSuccess: () => {
      haptic("success");
      void invalidate();
    },
  });

  return (
    <>
      <PageMeta title={t("Users")} backHref="/admin" />

      <div className="flex flex-col gap-4">
        <h1 className="hidden text-2xl font-semibold tracking-tight md:block">
          {t("Users")}
        </h1>

        <div className="relative">
          <SearchIcon className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t("Search by name, email or id…")}
            className="h-11 pl-9 md:h-9"
          />
        </div>

        {users.isLoading ? (
          <div className="flex justify-center py-12">
            <Spinner className="size-5 text-muted-foreground" />
          </div>
        ) : null}

        <ul className="overflow-hidden rounded-xl border bg-card">
          {users.data?.users.map((user, index) => (
            <li
              key={user.id}
              className={`flex items-center gap-3 px-4 py-3 ${index > 0 ? "border-t" : ""}`}
            >
              <div className="min-w-0 flex-1">
                <p className="flex items-center gap-1.5 truncate text-sm font-medium">
                  {user.name}
                  {user.role === "admin" ? (
                    <ShieldIcon className="size-3.5 shrink-0 text-primary" />
                  ) : null}
                  {user.banned ? (
                    <UserXIcon className="size-3.5 shrink-0 text-destructive" />
                  ) : null}
                </p>
                <p className="truncate text-xs text-muted-foreground">
                  {user.email}
                  {" · "}
                  {format.dateTime(new Date(user.createdAt), {
                    day: "numeric",
                    month: "short",
                    year: "numeric",
                  })}
                </p>
              </div>

              <div className="hidden text-right text-xs text-muted-foreground sm:block">
                <p>{t("{count} years", { count: String(user.years) })}</p>
                <p>{t("{count} grades", { count: String(user.grades) })}</p>
              </div>

              <DropdownMenu>
                <DropdownMenuTrigger
                  render={<Button variant="ghost" size="sm">{t("Manage")}</Button>}
                />
                <DropdownMenuContent align="end">
                  <DropdownMenuItem
                    onClick={() =>
                      setRole.mutate({
                        userId: user.id,
                        role: user.role === "admin" ? "user" : "admin",
                      })
                    }
                  >
                    {user.role === "admin"
                      ? t("Remove admin")
                      : t("Make admin")}
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    variant="destructive"
                    onClick={() =>
                      setBanned.mutate({
                        userId: user.id,
                        banned: !user.banned,
                        reason: null,
                      })
                    }
                  >
                    {user.banned ? t("Lift suspension") : t("Suspend account")}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </li>
          ))}
        </ul>

        {users.data && users.data.users.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            {t("Nobody matches.")}
          </p>
        ) : null}
      </div>
    </>
  );
}
