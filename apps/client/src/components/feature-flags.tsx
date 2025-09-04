"use client";

import { useFeatureFlags } from '@/hooks/use-feature-flags';
import React from 'react'

export default function FeatureFlags({ flags, children }: { flags: string, children: React.ReactNode }) {
    const { isLoading, isError, data } = useFeatureFlags();

    if (isLoading || isError || !data?.[flags]) return;

    return <>
        {children}
    </>;
}
