"use client";

import { useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { SubjectForm } from "@/components/subjects/subject-form";

function NewSubject() {
  const params = useSearchParams();
  const kind = params.get("kind") === "category" ? "category" : "subject";
  const parentId = params.get("parent");

  return (
    <SubjectForm
      mode="create"
      initial={{ kind, parentId: parentId ?? null }}
    />
  );
}

export default function NewSubjectPage() {
  return (
    <Suspense>
      <NewSubject />
    </Suspense>
  );
}
