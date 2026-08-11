import type { Metadata } from "next"
import type { ReactNode } from "react"
import { SocialAdminNav } from "@/components/admin/social-admin-nav"

export const metadata: Metadata = {
  title: "Social moderation",
  robots: { index: false, follow: false },
}

export default function AdminSocialLayout({
  children,
}: {
  children: ReactNode
}) {
  return (
    <div className="flex flex-col gap-4">
      <SocialAdminNav />
      {children}
    </div>
  )
}
