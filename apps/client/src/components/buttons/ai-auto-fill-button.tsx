"use client";

import React from 'react'
import FeatureFlags from '../feature-flags'
import { Button } from '../ui/button'
import { SparklesIcon } from '@heroicons/react/24/outline'
import { useMutation } from '@tanstack/react-query';
import { apiClient } from '@/lib/api';
import { toast } from '@/hooks/use-toast';

export default function AiAutoFillButton({ yearId }: { yearId: string }) {
    const { isPending, isError, mutate } = useMutation({
        mutationKey: ['ai-auto-fill'],
        mutationFn: async (file: File) => {
            const formData = new FormData();
            formData.append('file', file);

            const response = await apiClient.post(`ai-auto-fill?yearId=${yearId}`, {
                body: formData,
                timeout: 1.5 * 60 * 1000,
            });

            return response.json<{ value: number; out_of: number; name: number; passed_at: number }>();
        },
        onSuccess: (data) => {
            console.log('AI Auto Fill Success:', data);
            toast({
                title: `${data?.name}`,
                description: `${data?.value}/${data?.out_of} on ${data?.passed_at}`
            })
        },
        onMutate: () => {
            toast({
                title: "Image process started",
                description: "Filling in details..."
            })
        }
    });

    function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
        const file = e.target.files?.[0];
        console.log(file);
        if (file) {
            mutate(file);
        }
    }

    return (
        <FeatureFlags flags="AI_AUTO_FILL">
            <Button variant="outline">
                <input onChange={handleFileChange} type="file" accept="image/*" capture="environment" />
                <SparklesIcon className="size-4 mr-2" />
                AI_AUTO_FILL_BUTTON_LABEL
            </Button>
        </FeatureFlags>
    )
}
