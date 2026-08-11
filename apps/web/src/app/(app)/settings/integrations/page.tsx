import { IntegrationsClient, IntegrationsPageMeta } from "./integrations-client"
import { requireServerViewer } from "@/lib/authenticated-data"
import { loadOAuthIntegrations } from "@/lib/oauth-integrations"

export default async function IntegrationsSettingsPage() {
  const [, integrations] = await Promise.all([
    requireServerViewer(),
    loadOAuthIntegrations(),
  ])

  return (
    <>
      <IntegrationsPageMeta />
      <IntegrationsClient initial={integrations} />
    </>
  )
}
