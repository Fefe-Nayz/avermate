"use client"

import { useState } from "react"
import { CheckIcon, CopyIcon } from "lucide-react"
import { useExtracted } from "next-intl"
import { SocialCallout } from "@/components/social/social-ui"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"

/**
 * A secret shown exactly once.
 *
 * Both invitation screens wrote their own version of this, and one of them put
 * the link in a plain bordered box with no warning that it would not be shown
 * again. A one-time secret is a specific thing; it gets one component.
 *
 * It lives in its own file because it is the only piece of the social
 * vocabulary that holds state. Keeping `social-ui` free of `"use client"` is
 * what lets the server-rendered hub pass an icon *component* to `SocialHeading`
 * — across a client boundary React can only send plain data, and a function
 * is not plain data.
 */
export function SecretLink({
  url,
  label,
  note,
}: {
  url: string
  label: string
  note?: string
}) {
  const t = useExtracted()
  const [copied, setCopied] = useState(false)

  return (
    <SocialCallout tone="caution" title={label}>
      <p>
        {note ??
          t(
            "Copy it now — for safety the full secret is never shown again. Do not post it publicly."
          )}
      </p>
      <div className="mt-2.5 flex gap-2">
        <Input
          value={url}
          readOnly
          aria-label={label}
          className="bg-background font-mono text-xs"
          onFocus={(event) => event.currentTarget.select()}
        />
        <Button
          type="button"
          variant="outline"
          size="icon"
          onClick={async () => {
            await navigator.clipboard.writeText(url)
            setCopied(true)
          }}
        >
          {copied ? <CheckIcon /> : <CopyIcon />}
          <span className="sr-only">{t("Copy link")}</span>
        </Button>
      </div>
    </SocialCallout>
  )
}
