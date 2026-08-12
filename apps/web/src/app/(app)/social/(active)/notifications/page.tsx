import type { Metadata } from "next"
import { NotificationsClient } from "./notifications-client"

export const metadata: Metadata = {
  title: "Social updates",
  robots: { index: false, follow: false },
}

export default function SocialNotificationsPage() {
  return <NotificationsClient />
}
