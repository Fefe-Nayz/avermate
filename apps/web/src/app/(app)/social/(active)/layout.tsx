import type { Metadata } from "next"
import type { ReactNode } from "react"
import { SocialNavigation } from "@/components/social/social-navigation"

export const metadata: Metadata = {
  title: "Social",
  description: "Share averages with friends and groups in Avermate.",
  robots: { index: false, follow: false },
}

/**
 * The rail sits beside the content on a wide screen; the pill row it also
 * renders stacks above it on a phone. There is no gate any more — social is
 * part of the app, and what leaves an account is governed by its locks.
 */
export default function ActiveSocialLayout({
  children,
}: {
  children: ReactNode
}) {
  return (
    <div className="flex flex-col gap-4 md:flex-row md:gap-8">
      <SocialNavigation />
      <div className="flex min-w-0 flex-1 flex-col gap-4">{children}</div>
    </div>
  )
}
