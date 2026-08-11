import { SubjectForm } from "@/components/subjects/subject-form"

export default async function NewSubjectPage({
  searchParams,
}: {
  searchParams: Promise<{
    kind?: string | string[]
    parent?: string | string[]
  }>
}) {
  const params = await searchParams
  const rawKind = Array.isArray(params.kind) ? params.kind[0] : params.kind
  const rawParent = Array.isArray(params.parent)
    ? params.parent[0]
    : params.parent
  const kind = rawKind === "category" ? "category" : "subject"

  return (
    <SubjectForm
      mode="create"
      initial={{ kind, parentId: rawParent ?? null }}
    />
  )
}
