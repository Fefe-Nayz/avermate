import { EyeOffIcon, ShieldCheckIcon } from "lucide-react"
import { useExtracted } from "next-intl"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { initialsOf } from "@/components/shell/nav-user"

export interface SocialProfileProjection {
  displayName?: string | null
  avatar?: string | null
  bio?: string | null
  educationBand?: string | null
}

function EducationBand({ value }: { value: string }) {
  const t = useExtracted()
  if (value === "middle_school") return t("Middle school")
  if (value === "high_school") return t("High school")
  if (value === "higher_education") return t("Higher education")
  if (value === "other") return t("Other education")
  return t("Education level")
}

export function ProfilePreview({
  profile,
  audienceLabel,
  exact = false,
}: {
  profile: SocialProfileProjection
  audienceLabel: string
  exact?: boolean
}) {
  const t = useExtracted()
  const name = profile.displayName?.trim() || t("Private profile")

  return (
    <Card className="overflow-hidden py-0">
      <div className="h-16 bg-linear-to-br from-primary/25 via-primary/8 to-transparent" />
      <CardHeader className="-mt-7 flex-row items-end gap-3 px-4">
        <Avatar className="size-14 ring-4 ring-card">
          <AvatarImage src={profile.avatar ?? undefined} alt="" />
          <AvatarFallback>{initialsOf(name)}</AvatarFallback>
        </Avatar>
        <div className="min-w-0 flex-1 pb-0.5">
          <CardTitle className="truncate text-base">{name}</CardTitle>
          <p className="text-xs text-muted-foreground">{audienceLabel}</p>
        </div>
        {exact ? (
          <Badge variant="secondary">
            <ShieldCheckIcon aria-hidden /> {t("Exact preview")}
          </Badge>
        ) : null}
      </CardHeader>
      <CardContent className="space-y-3 px-4 pb-4">
        {profile.bio ? (
          <p className="text-sm leading-relaxed">{profile.bio}</p>
        ) : (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <EyeOffIcon className="size-4" aria-hidden /> {t("Bio not shared")}
          </p>
        )}
        {profile.educationBand ? (
          <Badge variant="outline">
            <EducationBand value={profile.educationBand} />
          </Badge>
        ) : (
          <Badge variant="outline">
            <EyeOffIcon aria-hidden /> {t("Education level not shared")}
          </Badge>
        )}
      </CardContent>
    </Card>
  )
}
