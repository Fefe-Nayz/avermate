"use client";

import { usePathname } from "next/navigation";
import {
  createContext,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { useMutation } from "@tanstack/react-query";
import { BugIcon, LightbulbIcon, MessageCircleIcon, SendIcon } from "lucide-react";
import { useExtracted } from "next-intl";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { orpc } from "@/lib/orpc";
import { haptic } from "@/lib/haptics";

/**
 * Feedback, reachable from anywhere.
 *
 * The page it was sent from and the viewport go along with it: nine times in
 * ten that is the difference between a report someone can act on and one that
 * needs a reply asking where it happened.
 */

interface FeedbackStore {
  open: (kind?: FeedbackKind) => void;
}

type FeedbackKind = "bug" | "idea" | "question" | "other";

const FeedbackContext = createContext<FeedbackStore | null>(null);

export function FeedbackProvider({ children }: { children: ReactNode }) {
  const t = useExtracted();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<FeedbackKind>("idea");
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");

  const submit = useMutation({
    ...orpc.feedback.submit.mutationOptions(),
    onSuccess: () => {
      haptic("success");
      toast.success(t("Thanks — your message is on its way."));
      setOpen(false);
      setSubject("");
      setMessage("");
    },
    onError: () => {
      haptic("error");
      toast.error(t("The message could not be sent."));
    },
  });

  const store = useMemo<FeedbackStore>(
    () => ({
      open: (nextKind) => {
        if (nextKind) setKind(nextKind);
        setOpen(true);
      },
    }),
    [],
  );

  const kinds: Array<{ value: FeedbackKind; label: string; icon: typeof BugIcon }> = [
    { value: "bug", label: t("Bug"), icon: BugIcon },
    { value: "idea", label: t("Idea"), icon: LightbulbIcon },
    { value: "question", label: t("Question"), icon: MessageCircleIcon },
  ];

  return (
    <FeedbackContext.Provider value={store}>
      {children}
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="right" className="w-full sm:max-w-md">
          <SheetHeader>
            <SheetTitle>{t("Send feedback")}</SheetTitle>
          </SheetHeader>

          <form
            className="flex flex-1 flex-col gap-4 overflow-y-auto px-4 pb-4"
            onSubmit={(event) => {
              event.preventDefault();
              submit.mutate({
                kind,
                subject,
                message,
                context: {
                  page: pathname,
                  viewport:
                    typeof window === "undefined"
                      ? ""
                      : `${window.innerWidth}×${window.innerHeight}`,
                  agent:
                    typeof navigator === "undefined" ? "" : navigator.userAgent,
                },
              });
            }}
          >
            <FieldGroup>
              <Field>
                <FieldLabel>{t("What is this about?")}</FieldLabel>
                <ToggleGroup
                  value={[kind]}
                  onValueChange={(value) => {
                    const next = value[0] as FeedbackKind | undefined;
                    if (next) setKind(next);
                  }}
                  variant="outline"
                  className="w-full"
                >
                  {kinds.map((item) => (
                    <ToggleGroupItem
                      key={item.value}
                      value={item.value}
                      className="flex-1"
                    >
                      <item.icon className="size-4" />
                      {item.label}
                    </ToggleGroupItem>
                  ))}
                </ToggleGroup>
              </Field>

              <Field>
                <FieldLabel htmlFor="feedback-subject">{t("Summary")}</FieldLabel>
                <Input
                  id="feedback-subject"
                  value={subject}
                  onChange={(event) => setSubject(event.target.value)}
                  placeholder={t("In one line")}
                  maxLength={120}
                  required
                />
              </Field>

              <Field>
                <FieldLabel htmlFor="feedback-message">{t("Details")}</FieldLabel>
                <Textarea
                  id="feedback-message"
                  value={message}
                  onChange={(event) => setMessage(event.target.value)}
                  placeholder={t("What happened, and what did you expect?")}
                  rows={7}
                  maxLength={4000}
                  required
                />
                <FieldDescription>
                  {t("The page you are on is included automatically.")}
                </FieldDescription>
              </Field>
            </FieldGroup>

            <Button
              type="submit"
              className="mt-auto"
              disabled={submit.isPending || message.trim().length < 10}
            >
              <SendIcon className="size-4" />
              {t("Send")}
            </Button>
          </form>
        </SheetContent>
      </Sheet>
    </FeedbackContext.Provider>
  );
}

export function useFeedback(): FeedbackStore {
  return useContext(FeedbackContext) ?? { open: () => undefined };
}
