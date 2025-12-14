"use client";

import { Button } from "@/components/ui/button";
import { Form, FormControl, FormField, FormItem, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { apiClient } from "@/lib/api";
import { handleError } from "@/utils/error-utils";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";
import React from "react";
import { useForm } from "react-hook-form";
import * as z from "zod";

export function UpdateYearDefaultOutOfForm({
	yearId,
	defaultOutOf,
}: {
	yearId: string;
	defaultOutOf?: number;
}) {
	const errorTranslations = useTranslations("Errors");
	const t = useTranslations("Dashboard.Forms.UPDATE_YEAR_DEFAULT_OUT_OF_FORM");
	const queryClient = useQueryClient();

	const schema = z.object({
		outOf: z.coerce
			.number()
			.min(1, { message: t("DEFAULT_OUT_OF_MIN_ERROR") })
			.max(1000, { message: t("DEFAULT_OUT_OF_MAX_ERROR") }),
	});
	type Schema = z.infer<typeof schema>;

	const { mutate, isPending } = useMutation({
		mutationKey: ["update-year-outof", yearId],
		mutationFn: async ({ outOf }: Schema) => {
			const res = await apiClient.patch(`years/${yearId}`, {
				json: { defaultOutOf: outOf },
			});
			return res.json();
		},
		onSuccess: () => {
			toast.success(t("TOAST_SUCCESS_TITLE"), {
				description: t("TOAST_SUCCESS_DESC"),
			});
		},
		onSettled: () => {
			queryClient.cancelQueries();
			queryClient.invalidateQueries({ queryKey: ["years"] });
			queryClient.invalidateQueries({ queryKey: ["grades"] });
			queryClient.invalidateQueries({ queryKey: ["recent-grades"] });
		},
		onError: (error) => {
			handleError(error, errorTranslations, t("errorMessage"));
		},
	});

	const form = useForm({
		resolver: zodResolver(schema),
		defaultValues: { outOf: defaultOutOf != null ? Math.round(defaultOutOf / 100) : 20 },
	});

	const onSubmit = (values: Schema) => mutate(values as Schema);

	return (
		<div className="flex flex-col gap-4">
			<div className="px-6">
				<Form {...form}>
					<form onSubmit={form.handleSubmit(onSubmit)}>
						<div className="w-full">
							<FormField
								control={form.control}
								name="outOf"
								disabled={isPending}
								render={({ field }) => (
									<FormItem>
										<FormControl>
											<Input type="number" placeholder={t("FIELD_PLACEHOLDER")} {...field} value={field.value as number | string} onChange={(e) => field.onChange(e.target.value)} />
										</FormControl>
										<FormMessage />
									</FormItem>
								)}
							/>
						</div>
					</form>
				</Form>
			</div>
			<div className="flex justify-end border-t py-4 px-6">
				<Button type="submit" disabled={isPending} onClick={form.handleSubmit(onSubmit)}>
					{isPending && <Loader2 className="animate-spin h-4 w-4 mr-2" />}
					{t("SUBMIT_BUTTON_LABEL")}
				</Button>
			</div>
		</div>
	);
}

export default UpdateYearDefaultOutOfForm;
