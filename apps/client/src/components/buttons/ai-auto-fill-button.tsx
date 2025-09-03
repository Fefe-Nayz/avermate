"use client";

import React from 'react'
import FeatureFlags from '../feature-flags'
import { Button } from '../ui/button'
import { SparklesIcon } from '@heroicons/react/24/outline'

export default function AiAutoFillButton() {
    return (
        <FeatureFlags flags="AI_AUTO_FILL">
            <Button variant="outline">
                <SparklesIcon className="size-4 mr-2" />
                AI_AUTO_FILL_BUTTON_LABEL
            </Button>
        </FeatureFlags>
    )
}
