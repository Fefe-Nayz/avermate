import { Badge } from '@/components/ui/badge'
import { ZapIcon } from 'lucide-react'
import React from 'react'

export default function EarlyBirdBadge() {
  return (
    <span className="ml-1">
      <Badge>
        <ZapIcon className="-ms-0.5 opacity-60 mr-1" size={12} aria-hidden="true" />
        {"OG"}
      </Badge>
    </span>
  )
}
