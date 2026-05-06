"use client"

import React from 'react'
import { CredenzaContent } from '../ui/credenza'
import { useMediaQuery } from '../ui/use-media-query'
import { cn } from '@/lib/utils';

export default function CredenzaContentWrapper({ children }: { children: React.ReactNode }) {
    const isDesktop = useMediaQuery("(min-width: 768px)");

    return (
        <CredenzaContent
            className={cn(
                "max-h-[calc(var(--visual-viewport-height,100dvh)-1rem)] overflow-hidden overscroll-contain after:hidden after:content-none",
                isDesktop && "max-h-[95vh] overflow-y-auto"
            )}
        >
            {children}
        </CredenzaContent>
    )
}
