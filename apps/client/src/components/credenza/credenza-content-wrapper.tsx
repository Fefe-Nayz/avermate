"use client"

import React from 'react'
import { CredenzaContent } from '../ui/credenza'
import { useMediaQuery } from '../ui/use-media-query'
import { cn } from '@/lib/utils';

export default function CredenzaContentWrapper({ children }: { children: React.ReactNode }) {
    const isDesktop = useMediaQuery("(min-width: 768px)");

    return (
        <CredenzaContent className={cn("max-h-screen", isDesktop && "overflow-y-scroll")}>
            {children}
        </CredenzaContent>
    )
}
