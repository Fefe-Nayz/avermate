import type { ReactNode } from "react"
import { requireServerAdmin } from "@/lib/admin-data"
import { AdminNavigation } from "./admin-navigation"

/**
 * Keep the entire admin route tree out of the client bundle for non-admins.
 * This navigation gate is only UX; every admin procedure still performs its
 * own authoritative backend authorization.
 *
 * The rail is the same shape settings uses: nine pages across five areas had
 * no way to reach each other, so every move between them went back through
 * the index.
 */
export default async function AdminLayout({
  children,
}: {
  children: ReactNode
}) {
  await requireServerAdmin()
  return (
    <div className="flex gap-8">
      <AdminNavigation />
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  )
}
