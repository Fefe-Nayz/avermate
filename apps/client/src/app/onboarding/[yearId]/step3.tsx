// import AddGradeDialog from "@/components/dialogs/add-grade-dialog";
// import AddSubjectDialog from "@/components/dialogs/add-subject-dialog";
// import ErrorStateCard from "@/components/skeleton/error-card";
// import GradeBadge from "@/components/tables/grade-badge";
// import { Button } from "@/components/ui/button";
// import { PlusCircleIcon } from "@heroicons/react/24/outline";
// import { Skeleton } from "@/components/ui/skeleton";
// import { useSubjects } from "@/hooks/use-subjects";
// import { Subject } from "@/types/subject";
// import { useTranslations } from "next-intl";

// export default function Step3() {
//   const t = useTranslations("Onboarding.Step3");
//   const { data: subjects, isError, isLoading } = useSubjects();

//   if (isLoading) {
//     return (
//       <div className="flex flex-col gap-4">
//         <h2 className="text-2xl font-bold text-primary">{t("title")}</h2>
//         <div className="flex flex-col gap-4">
//           {Array.from({ length: 20 }).map((_, index) => (
//             <div key={index} className="flex flex-col gap-2">
//               <div className="flex items-center justify-between gap-4">
//                 <div className="flex items-center flex-1 gap-2">
//                   <Skeleton className="w-1/2 h-5" />
//                 </div>
//                 <div className="flex space-x-2">
//                   <Button size="icon" variant="outline" disabled>
//                     <PlusCircleIcon className="size-4" />
//                   </Button>
//                 </div>
//               </div>
//               <div className="flex flex-wrap gap-2">
//                 {Array.from({ length: Math.floor(Math.random() * 5) + 1 }).map(
//                   (_, i) => (
//                     <Skeleton key={i} className="w-10 h-5" />
//                   )
//                 )}
//               </div>
//             </div>
//           ))}
//         </div>
//         <div className="flex md:flex-row flex-col items-center justify-center md:space-x-4 space-x-0 gap-2 md:gap-0">
//           <AddSubjectDialog>
//             <Button variant="outline" disabled>
//               <PlusCircleIcon className="size-4 mr-2" />
//               {t("addNewGrade")}
//             </Button>
//           </AddSubjectDialog>
//         </div>
//       </div>
//     );
//   }

//   if (isError) {
//     return ErrorStateCard();
//   }

//   if (!subjects || subjects.length === 0) {
//     return (
//       <div className="flex flex-col items-center justify-center space-y-8">
//         <h2 className="text-2xl font-bold text-primary">{t("title")}</h2>
//         <p className="text-muted-foreground text-justify">
//           {t("noSubjectsMessage")}
//         </p>

//         <AddSubjectDialog>
//           <Button variant="outline">
//             <PlusCircleIcon className="size-4 mr-2" />
//             {t("addSubject")}
//           </Button>
//         </AddSubjectDialog>
//       </div>
//     );
//   }

//   const renderSubjects = (
//     subjects: Subject[],
//     parentId: string | null = null,
//     level: number = 0
//   ) =>
//     subjects
//       .filter((subject: Subject) => subject.parentId === parentId)
//       .map((subject: Subject) => (
//         <div
//           key={subject.id}
//           className={`${
//             level > 0 ? "border-l-2 border-gray-300 pl-2 md:pl-4 " : ""
//           }`}
//         >
//           <div className="flex md:flex-row md:items-center justify-between min-w-0 gap-4">
//             <div className="flex items-center space-x-2  flex-1 min-w-0">
//               <span className="font-bold truncate">{subject.name}</span>
//             </div>
//             <div className="flex items-center space-x-2 flex-shrink-0">
//               {!subject.isDisplaySubject && (
//                 <AddGradeDialog parentId={subject.id}>
//                   <Button variant="outline" size="icon">
//                     <PlusCircleIcon className="size-4" />
//                   </Button>
//                 </AddGradeDialog>
//               )}
//             </div>
//           </div>
//           <div className="flex flex-wrap gap-2 pb-2">
//             {subject.grades?.map((grade) => (
//               <GradeBadge
//                 key={grade.id}
//                 value={grade.value}
//                 outOf={grade.outOf}
//                 coefficient={grade.coefficient}
//                 id={grade.id}
//                 periodId={grade.periodId}
//               />
//             ))}
//           </div>
//           {renderSubjects(subjects, subject.id, level + 1)}
//         </div>
//       ));

//   return (
//     <div className="flex flex-col gap-4">
//       <h2 className="text-2xl font-bold text-primary">{t("title")}</h2>
//       <div>{renderSubjects(subjects ?? [])}</div>
//       <div className="flex flex-col items-center justify-center space-y-4">
//         <AddGradeDialog>
//           <Button variant="outline">
//             <PlusCircleIcon className="size-4 mr-2" />
//             {t("addNewGrade")}
//           </Button>
//         </AddGradeDialog>
//       </div>
//     </div>
//   );
// }