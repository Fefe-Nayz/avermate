import { GradeForm } from "@/components/grades/grade-form"

export default async function NewGradePage({
  searchParams,
}: {
  searchParams: Promise<{ subject?: string | string[] }>
}) {
  const params = await searchParams
  const subjectId = Array.isArray(params.subject)
    ? params.subject[0]
    : params.subject

  return <GradeForm mode="create" initial={{ subjectId: subjectId ?? null }} />
}
