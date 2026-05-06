import React from 'react'
import { CredenzaBody } from '../ui/credenza'

export default function CredenzaBodyWrapper({ children }: { children: React.ReactNode }) {
    return (
        <CredenzaBody className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-6">
            {children}
        </CredenzaBody>
    )
}
