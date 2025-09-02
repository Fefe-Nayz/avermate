import React from 'react'
import { CredenzaContent } from '../ui/credenza'

export default function CredenzaContentWrapper({ children }: { children: React.ReactNode }) {
    return (
        <CredenzaContent className="max-h-screen">
            {children}
        </CredenzaContent>
    )
}
