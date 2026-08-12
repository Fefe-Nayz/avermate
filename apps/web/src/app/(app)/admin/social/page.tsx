import { AdminSocialOverviewClient } from "./social-overview-client"
import { requireServerAdmin } from "@/lib/admin-data"

export default async function AdminSocialPage() {
  await requireServerAdmin()
  return <AdminSocialOverviewClient />
}
