"use client";

import { useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { GradeForm } from "@/components/grades/grade-form";

function NewGrade() {
  const params = useSearchParams();
  return (
    <GradeForm mode="create" initial={{ subjectId: params.get("subject") }} />
  );
}

export default function NewGradePage() {
  return (
    <Suspense>
      <NewGrade />
    </Suspense>
  );
}
