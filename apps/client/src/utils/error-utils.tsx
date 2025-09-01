import { HTTPError } from "ky";

export function handleError(
  error: unknown,
  toaster: ReturnType<typeof import("@/hooks/use-toast").useToast>,
  t: any,
  message?: string
) {
  const errorMessages: Record<number, string> = {
    401: t("unauthorized"),
    403: t("forbidden"),
    404: t("notFound"),
    500: t("serverError"),
    429: t("tooManyRequests"),
    503: t("serviceUnavailable"),
    400: t("badRequest"),
  };

  if (error instanceof HTTPError) {
    const status = error.response.status;
    const errorMessage = errorMessages[status] || t("unknownError");

    toaster.toast({
      title: message || t("error"),
      description: `${errorMessage} (${status})`,
      variant: "destructive",
    });
  } else {
    toaster.toast({
      title: message || t("error"),
      description: `${t("unexpectedError")} (${error})`,
      variant: "destructive",
    });
  }
}