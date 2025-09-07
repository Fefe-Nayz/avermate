import React from 'react'
import { CredenzaBody } from '../ui/credenza'

export default function CredenzaBodyWrapper({ children }: { children: React.ReactNode }) {
    return (
        <CredenzaBody className="px-4 py-6 overflow-y-auto">
            {children}
        </CredenzaBody>
    )
}
