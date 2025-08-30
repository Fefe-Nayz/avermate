// import { Button } from "@/components/ui/button";
// import { authClient } from "@/lib/auth";
// import { Session, User } from "better-auth/types";
// import { ArrowRight, ShareIcon, SquarePlusIcon } from "lucide-react";
// import { useEffect, useState } from "react";
// import { Skeleton } from "@/components/ui/skeleton";
// import { useTranslations } from "next-intl";
// import { useSubjects } from "@/hooks/use-subjects";
// import { usePeriods } from "@/hooks/use-periods";
// import { useCustomAverages } from "@/hooks/use-custom-averages";
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
// import { toast, useToast } from "@/hooks/use-toast";
// import { apiClient } from "@/lib/api";
// import { useRouter } from "next/navigation";
// import { handleError } from "@/utils/error-utils";
// import { useMutation, useQueryClient } from "@tanstack/react-query";

// export default function WelcomeScreen() {
//   const t = useTranslations("Onboarding.Welcome");
//   const errorTranslations = useTranslations("Errors");
//   const { data: session } = authClient.useSession() as unknown as {
//     data: { session: Session; user: User };
//   };
//   const router = useRouter();
//   const toaster = useToast();
//   const { data: subjects } = useSubjects();
//   const { data: periods } = usePeriods();
//   const { data: customAverages } = useCustomAverages();
//   const queryClient = useQueryClient();

//   const hasExistingData =
//     (subjects && subjects.length > 0) ||
//     (periods && periods.length > 0) ||
//     (customAverages && customAverages.length > 0);

//   // -- Detect iOS (iPhone) --
//   const [isIos, setIsIos] = useState(false);

//   useEffect(() => {
//     // Basic detection: check if user agent has 'iPhone'
//     const userAgent = window.navigator.userAgent.toLowerCase();
//     const onIphone = /iphone/.test(userAgent);
//     setIsIos(onIphone);
//   }, []);

//   // -- PWA install logic (mostly for Android/Chrome) --
//   const [installPrompt, setInstallPrompt] = useState<Event | null>(null);
//   const [canInstall, setCanInstall] = useState(false);

//   useEffect(() => {
//     function handleBeforeInstallPrompt(e: Event) {
//       e.preventDefault();
//       setInstallPrompt(e); // store the event
//       setCanInstall(true); // show the button
//     }

//     window.addEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
//     return () => {
//       window.removeEventListener(
//         "beforeinstallprompt",
//         handleBeforeInstallPrompt
//       );
//     };
//   }, []);

//   // Listen for a successful install
//   useEffect(() => {
//     function handleAppInstalled() {
//       disableInAppInstallPrompt();
//     }

//     window.addEventListener("appinstalled", handleAppInstalled);
//     return () => {
//       window.removeEventListener("appinstalled", handleAppInstalled);
//     };
//   }, []);

//   const handleInstallClick = async () => {
//     if (!installPrompt) return;
//     const result = await (installPrompt as any).prompt();
//     console.log(`Install prompt outcome: ${result.outcome}`);
//     disableInAppInstallPrompt();
//   };

//   function disableInAppInstallPrompt() {
//     setInstallPrompt(null);
//     setCanInstall(false);
//   }
//   // -- end PWA install logic --

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
//     <div className="text-center space-y-8">
//       <h2 className="text-4xl font-bold text-primary">
//         {t("welcomeTitle")},&nbsp;
//         <span className="items-center">
//           {session?.user?.name ? (
//             session.user.name.split(" ")[0]
//           ) : (
//             <Skeleton className="w-32 h-11 inline-block align-middle" />
//           )}
//         </span>
//         &nbsp;! 🎉
//       </h2>

//       <p className="text-xl text-muted-foreground max-w-2xl mx-auto">
//         {t("welcomeMessage")}
//       </p>

//       <div className="bg-secondary/50 rounded-lg p-6 max-w-xl mx-auto space-y-6">
//         <div>
//           <h3 className="text-lg font-semibold mb-2">
//             {t("whatToExpectTitle")}
//           </h3>
//           <ul className="text-left text-muted-foreground space-y-2">
//             <li className="flex items-center">
//               <ArrowRight className="w-5 h-5 mr-2 text-primary" />
//               {t("createPeriods")}
//             </li>
//             <li className="flex items-center">
//               <ArrowRight className="w-5 h-5 mr-2 text-primary" />
//               {t("createSubjects")}
//             </li>
//             <li className="flex items-center">
//               <ArrowRight className="w-5 h-5 mr-2 text-primary" />
//               {t("addGrades")}
//             </li>
//           </ul>
//         </div>

//         {hasExistingData && (
//           <div className="pt-4 border-t border-border">
//             <h3 className="text-lg font-semibold mb-2">
//               {t("resetAccountTitle")}
//             </h3>
//             <p className="text-sm text-muted-foreground mb-5">
//               {t("resetAccountText")}
//             </p>
//             <AlertDialog>
//               <AlertDialogTrigger asChild>
//                 <Button variant="destructive">{t("resetAccount")}</Button>
//               </AlertDialogTrigger>
//               <AlertDialogContent>
//                 <AlertDialogHeader>
//                   <AlertDialogTitle>{t("resetAccountTitle")}</AlertDialogTitle>
//                   <AlertDialogDescription>
//                     {t("resetAccountDescription")}
//                   </AlertDialogDescription>
//                 </AlertDialogHeader>
//                 <AlertDialogFooter>
//                   <AlertDialogCancel>{t("cancel")}</AlertDialogCancel>
//                   <AlertDialogAction
//                     onClick={() => mutate()}
//                     className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
//                   >
//                     {t("confirmReset")}
//                   </AlertDialogAction>
//                 </AlertDialogFooter>
//               </AlertDialogContent>
//             </AlertDialog>
//           </div>
//         )}

//         {/* If canInstall is true (Android/Chrome), show the install button */}
//         {canInstall && (
//           <div className="flex flex-col md:flex-row items-center justify-center space-x-4">
//             <p className="text-muted-foreground">{t("installAppMessage")}</p>
//             <Button variant="default" onClick={handleInstallClick}>
//               {t("installAppButton")}
//             </Button>
//           </div>
//         )}

//         {/* If not installable (no beforeinstallprompt) but on iPhone, show iOS instructions */}
//         {!canInstall && isIos && (
//           <div className="text-left bg-secondary p-4 rounded-lg">
//             <h4 className="text-lg font-semibold mb-2">
//               {t("installOnIphoneTitle")}
//             </h4>
//             <p className="text-muted-foreground mb-2">
//               {t("installOnIphoneMessage")}
//             </p>
//             <ol className="list-decimal list-inside text-muted-foreground space-y-1">
//               <li>{t("openInSafari")}</li>
//               <li>
//                 {t.rich("tapShareIcon", {
//                   share: (chunks) => <strong>{chunks}</strong>,
//                 })}{" "}
//                 <ShareIcon className="inline-block w-4 h-4 ml-1 align-text-bottom" />{" "}
//                 {t("atBottomOfScreen")}
//               </li>
//               <li>
//                 {t.rich("selectAddToHomeScreen", {
//                   addToHomeScreen: (chunks) => <strong>{chunks}</strong>,
//                 })}{" "}
//                 <SquarePlusIcon className="inline-block w-4 h-4 ml-1 align-text-bottom" />
//               </li>
//               <li>
//                 {t.rich("tapAddToConfirm", {
//                   add: (chunks) => <strong>{chunks}</strong>,
//                 })}
//               </li>
//             </ol>
//           </div>
//         )}
//       </div>
//     </div>
//   );
// }
