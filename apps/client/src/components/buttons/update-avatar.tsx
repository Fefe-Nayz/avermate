"use client";

import { UploadButton as OriginalUploadButton } from "@/components/buttons/upload-button";
import { Button, buttonVariants } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { authClient } from "@/lib/auth";
import { Loader2Icon } from "lucide-react";
import { useRouter } from "next/navigation";

const UpdateAvatar = () => {
  const toast = useToast();
  const router = useRouter();

  return (
    <OriginalUploadButton
      endpoint="avatarUploader"
      className="flex flex-col items-center w-full"
      appearance={{
        button({ ready, isUploading }) {
          return buttonVariants({
            variant: "default",
            size: "default",
            className: `w-full ${
              isUploading || !ready ? "opacity-50 pointer-events-none" : ""
            }`,
          });
        },
        container: "flex flex-col items-center space-y-2",
        allowedContent: "text-sm text-muted-foreground mt-1",
      }}
      content={{
        button({ ready, isUploading }) {
          if (isUploading) {
            return (
              <span className="flex items-center">
                <Loader2Icon className="animate-spin mr-2 size-4" />
                Modifier l&apos;avatar
              </span>
            );
          }
          return ready ? (
            <span className="text-black">Modifier l&apos;avatar</span>
          ) : (
            <span className="flex items-center text-black">
              <Loader2Icon className="animate-spin mr-2 size-4" />
              Modifier l&apos;avatar
            </span>
          );
        },
        allowedContent() {
          return "Formats images acceptés. Poids Max: 4MB.";
        },
      }}
      onClientUploadComplete={async (files) => {
        if (!files?.length) return;

        const uploadedFile = files[0];
        try {
          // Update user profile picture
          await authClient.updateUser({ image: uploadedFile.url });

          // Show success message
          toast.toast({
            title: "✅ Avatar modifié avec succès !",
            description: "Votre avatar a été mis à jour avec succès.",
          });

          // Refresh the page to update all avatar instances
          router.refresh();
        } catch (error) {
          console.error("Failed to update avatar:", error);

          // Show error message
          toast.toast({
            title: "❌ Erreur",
            description:
              "Une erreur est survenue lors de la mise à jour de l'avatar.",
          });
        }
      }}
      onUploadError={(err) => {
        if (err.code === "TOO_LARGE") {
          toast.toast({
            title: "❌ Erreur",
            description:
              "Le fichier que vous avez essayé d'upload est trop volumineux.",
          });

          return;
        }

        toast.toast({
          title: "❌ Erreur",
          description:
            "Une erreur est survenue lors de l'upload de votre avatar. Réesayez plus tard.",
        });

        console.error(err);
      }}
      onUploadBegin={() => {
        toast.toast({
          title: "🔄 Upload de l'avatar en cours...",
          description: "Merci de patienter quelques instants.",
        });
      }}
    />
  );
};

export default UpdateAvatar;
