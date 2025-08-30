// "use client";

// import ProfileSection from "../profile-section";
// import { Button } from "@/components/ui/button";
// import {
//   AlertDialog,
//   AlertDialogAction,
//   AlertDialogCancel,
//   AlertDialogContent,
//   AlertDialogDescription,
//   AlertDialogFooter,
//   AlertDialogHeader,
//   AlertDialogTitle,
//   AlertDialogTrigger,
// } from "@/components/ui/alert-dialog";
// import { useTranslations } from "next-intl";
// import { apiClient } from "@/lib/api";
// import { useQueryClient } from "@tanstack/react-query";
// import { useMutation } from "@tanstack/react-query";
// import { handleError } from "@/utils/error-utils";
// import { useToast } from "@/hooks/use-toast";
// export const ResetAccountSection = () => {
//   const errorTranslations = useTranslations("Errors");
//   const t = useTranslations("Settings.Settings.ResetAccount");
//   const toaster = useToast();
//   const queryClient = useQueryClient();

//   const { mutate, isPending } = useMutation({
//     mutationKey: ["reset-account"],
//     mutationFn: async () => {
//       await apiClient.post("users/reset");
//     },
//     onSuccess: () => {
//       toaster.toast({
//         title: t("accountResetSuccess"),
//         description: t("accountResetDescription"),
//       });
//       // reset the query client
//       queryClient.invalidateQueries({ queryKey: ["customAverages"] });
//       queryClient.invalidateQueries({ queryKey: ["periods"] });
//       queryClient.invalidateQueries({ queryKey: ["subjects"] });
//     },
//     onError: (error) => {
//       handleError(error, toaster, errorTranslations, t("resetAccountError"));
//     },
//   });

//   return (
//     <ProfileSection
//       title={t("title")}
//       description={t("description")}
//       className="border-red-500"
//     >
//       <AlertDialog>
//         <AlertDialogTrigger asChild>
//           <Button variant="destructive">{t("resetAccount")}</Button>
//         </AlertDialogTrigger>
//         <AlertDialogContent>
//           <AlertDialogHeader>
//             <AlertDialogTitle>{t("resetAccountTitle")}</AlertDialogTitle>
//             <AlertDialogDescription>
//               {t("resetAccountDescription")}
//             </AlertDialogDescription>
//           </AlertDialogHeader>
//           <AlertDialogFooter>
//             <AlertDialogCancel>{t("cancel")}</AlertDialogCancel>
//             <AlertDialogAction
//               onClick={() => mutate()}
//               className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
//             >
//               {t("confirmReset")}
//             </AlertDialogAction>
//           </AlertDialogFooter>
//         </AlertDialogContent>
//       </AlertDialog>
//     </ProfileSection>
//   );
// };
