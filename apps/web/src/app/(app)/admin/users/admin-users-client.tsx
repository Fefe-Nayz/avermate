"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import {
  CheckCircle2Icon,
  FlameIcon,
  SearchIcon,
  ShieldIcon,
  UserPlusIcon,
  UserXIcon,
} from "lucide-react"
import { useFormatter, useExtracted } from "next-intl"
import { toast } from "sonner"
import {
  AdminUserActions,
  hasAdminRole,
  type ManagedUser,
} from "@/components/admin/admin-user-actions"
import { ChoiceField, TextField } from "@/components/forms/controls"
import { PageMeta } from "@/components/shell/page-chrome"
import { initialsOf } from "@/components/shell/nav-user"
import { SettingsSection } from "@/components/settings/settings-section"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Spinner } from "@/components/ui/spinner"
import { orpc } from "@/lib/orpc"
import {
  ADMIN_USERS_PAGE_SIZE,
  adminUsersInput,
} from "@/lib/route-query-inputs"

export function AdminUsersClient() {
  const t = useExtracted()
  const format = useFormatter()
  const queryClient = useQueryClient()
  const [searchInput, setSearchInput] = useState("")
  const [query, setQuery] = useState("")
  const [page, setPage] = useState(1)
  const [name, setName] = useState("")
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [role, setRole] = useState<"user" | "admin">("user")

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setQuery(searchInput.trim())
      setPage(1)
    }, 250)
    return () => window.clearTimeout(timer)
  }, [searchInput])

  const offset = (page - 1) * ADMIN_USERS_PAGE_SIZE
  const users = useQuery(
    orpc.admin.users.queryOptions({ input: adminUsersInput(query, offset) })
  )
  const totalPages = Math.max(
    1,
    Math.ceil((users.data?.total ?? 0) / ADMIN_USERS_PAGE_SIZE)
  )

  const create = useMutation({
    ...orpc.admin.createUser.mutationOptions(),
    onSuccess: async () => {
      toast.success(t("Account created."))
      setName("")
      setEmail("")
      setPassword("")
      setRole("user")
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: orpc.admin.users.key() }),
        queryClient.invalidateQueries({ queryKey: orpc.admin.overview.key() }),
      ])
    },
    onError: (error: Error) => toast.error(error.message),
  })

  return (
    <>
      <PageMeta title={t("Users")} backHref="/admin" />

      <div className="flex flex-col gap-4">
        <div>
          <h1 className="hidden text-2xl font-semibold tracking-tight md:block">
            {t("Users")}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {t("Search accounts, inspect their activity and manage access.")}
          </p>
        </div>

        <div className="grid items-start gap-4 @lg/main:grid-cols-[minmax(0,1fr)_20rem]">
          <div className="space-y-3">
            <div className="relative">
              <SearchIcon className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={searchInput}
                onChange={(event) => setSearchInput(event.target.value)}
                placeholder={t("Search by name, email or id…")}
                className="h-11 pl-9 md:h-9"
              />
            </div>

            {users.isFetching && !users.data ? (
              <div className="flex justify-center py-12">
                <Spinner className="size-5 text-muted-foreground" />
              </div>
            ) : null}

            <ul className="overflow-hidden rounded-xl border bg-card">
              {users.data?.users.map((user, index) => (
                <li
                  key={user.id}
                  className={`flex items-center gap-3 p-3 ${index > 0 ? "border-t" : ""}`}
                >
                  <Avatar className="size-10">
                    <AvatarImage
                      src={user.image ?? undefined}
                      alt={user.name}
                    />
                    <AvatarFallback>{initialsOf(user.name)}</AvatarFallback>
                  </Avatar>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <Link
                        href={`/admin/users/${user.id}`}
                        className="truncate text-sm font-medium hover:underline"
                      >
                        {user.name}
                      </Link>
                      {hasAdminRole(user.role) ? (
                        <Badge variant="secondary">
                          <ShieldIcon /> {t("Admin")}
                        </Badge>
                      ) : null}
                      {user.emailVerified ? (
                        <CheckCircle2Icon
                          className="size-3.5 text-positive"
                          aria-label={t("Email verified")}
                        />
                      ) : null}
                      {user.banned ? (
                        <Badge variant="destructive">
                          <UserXIcon /> {t("Suspended")}
                        </Badge>
                      ) : null}
                      {user.mokattamThemeAvailable ? (
                        <Badge className="bg-orange-600 text-white">
                          <FlameIcon /> {t("Mokattam")}
                        </Badge>
                      ) : null}
                    </div>
                    <p className="truncate text-xs text-muted-foreground">
                      {user.email}
                    </p>
                    <p className="mt-0.5 text-[11px] text-muted-foreground">
                      {t("{years} years · {grades} grades · joined {date}", {
                        years: String(user.years),
                        grades: String(user.grades),
                        date: format.dateTime(new Date(user.createdAt), {
                          day: "numeric",
                          month: "short",
                          year: "numeric",
                        }),
                      })}
                    </p>
                  </div>
                  <AdminUserActions
                    user={user as ManagedUser}
                    onDeleted={() => {
                      if (users.data?.users.length === 1 && page > 1) {
                        setPage((current) => Math.max(1, current - 1))
                      }
                    }}
                  />
                </li>
              ))}
            </ul>

            {users.data?.users.length === 0 ? (
              <p className="py-8 text-center text-sm text-muted-foreground">
                {t("Nobody matches.")}
              </p>
            ) : null}

            <div className="flex items-center justify-between gap-3">
              <p className="text-xs text-muted-foreground">
                {t("Page {page} of {total} · {count} accounts", {
                  page: String(page),
                  total: String(totalPages),
                  count: String(users.data?.total ?? 0),
                })}
              </p>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  disabled={page <= 1 || users.isFetching}
                  onClick={() => setPage((current) => Math.max(1, current - 1))}
                >
                  {t("Previous")}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={page >= totalPages || users.isFetching}
                  onClick={() =>
                    setPage((current) => Math.min(totalPages, current + 1))
                  }
                >
                  {t("Next")}
                </Button>
              </div>
            </div>
          </div>

          <SettingsSection
            title={t("Create an account")}
            description={t(
              "The person must still verify their email before using application data."
            )}
          >
            <TextField
              label={t("Name")}
              value={name}
              autoComplete="off"
              onChange={(event) => setName(event.target.value)}
            />
            <TextField
              label={t("Email")}
              type="email"
              value={email}
              autoComplete="off"
              onChange={(event) => setEmail(event.target.value)}
            />
            <TextField
              label={t("Temporary password")}
              type="password"
              value={password}
              minLength={8}
              autoComplete="new-password"
              onChange={(event) => setPassword(event.target.value)}
            />
            <ChoiceField
              label={t("Role")}
              choices={[
                { value: "user", label: t("User") },
                { value: "admin", label: t("Administrator") },
              ]}
              value={role}
              onValueChange={setRole}
              columns={2}
            />
            <Button
              disabled={
                create.isPending ||
                !name.trim() ||
                !email.trim() ||
                password.length < 8
              }
              onClick={() =>
                create.mutate({
                  name: name.trim(),
                  email: email.trim(),
                  password,
                  role,
                })
              }
            >
              {create.isPending ? (
                <Spinner className="size-4" />
              ) : (
                <UserPlusIcon className="size-4" />
              )}
              {t("Create account")}
            </Button>
          </SettingsSection>
        </div>
      </div>
    </>
  )
}
