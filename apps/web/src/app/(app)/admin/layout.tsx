import type { ReactNode } from "react"
import { requireServerAdmin } from "@/lib/admin-data"

/**
 * Keep the entire admin route tree out of the client bundle for non-admins.
 * This navigation gate is only UX; every admin procedure still performs its
 * own authoritative backend authorization.
 */
export default async function AdminLayout({
  children,
}: {
  children: ReactNode
}) {
  await requireServerAdmin()
  return children
}
