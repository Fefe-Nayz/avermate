"use client"

import { useCallback, useRef, useState } from "react"
import { useMutation, useQuery } from "@tanstack/react-query"
import Cropper, { type Area } from "react-easy-crop"
import { CameraIcon, TrashIcon } from "lucide-react"
import { useExtracted } from "next-intl"
import { toast } from "sonner"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Button } from "@/components/ui/button"
import { Slider } from "@/components/ui/slider"
import { Spinner } from "@/components/ui/spinner"
import { initialsOf } from "@/components/shell/nav-user"
import {
  useAuthenticatedUser,
  useUpdateAuthenticatedUser,
} from "@/components/authenticated-user"
import { orpc } from "@/lib/orpc"
import { haptic } from "@/lib/haptics"

/**
 * Choosing an avatar.
 *
 * The crop happens in the browser and only the result is uploaded, so a 4 MB
 * photo from a phone camera becomes a ~60 KB square before it touches the
 * network. The editor appears in place rather than in a dialog — same rule as
 * every other form here.
 */

const OUTPUT_SIZE = 320

/** Draw the selected area at a fixed size, as a PNG. */
async function cropToFile(source: string, area: Area): Promise<File> {
  const image = new Image()
  image.src = source
  await new Promise((resolve, reject) => {
    image.onload = resolve
    image.onerror = reject
  })

  const canvas = document.createElement("canvas")
  canvas.width = OUTPUT_SIZE
  canvas.height = OUTPUT_SIZE
  const context = canvas.getContext("2d")
  if (!context) throw new Error("Canvas unavailable")

  context.drawImage(
    image,
    area.x,
    area.y,
    area.width,
    area.height,
    0,
    0,
    OUTPUT_SIZE,
    OUTPUT_SIZE
  )

  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, "image/png", 0.92)
  )
  if (!blob) throw new Error("Could not encode the image")
  return new File([blob], "avatar.png", { type: "image/png" })
}

export function AvatarEditor() {
  const t = useExtracted()
  const user = useAuthenticatedUser()
  const updateUser = useUpdateAuthenticatedUser()
  const fileInput = useRef<HTMLInputElement>(null)

  const [source, setSource] = useState<string | null>(null)
  const [crop, setCrop] = useState({ x: 0, y: 0 })
  const [zoom, setZoom] = useState(1)
  const [area, setArea] = useState<Area | null>(null)

  const availability = useQuery(orpc.profile.uploadsEnabled.queryOptions())
  const enabled = availability.data?.enabled ?? false

  const upload = useMutation({
    ...orpc.profile.uploadAvatar.mutationOptions(),
    onSuccess: (result) => {
      haptic("success")
      toast.success(t("Avatar updated."))
      setSource(null)
      updateUser({ image: result.url })
    },
    onError: (error: Error) => {
      haptic("error")
      toast.error(error.message || t("The upload failed. Try again."))
    },
  })

  const remove = useMutation({
    ...orpc.profile.removeAvatar.mutationOptions(),
    onSuccess: () => {
      haptic("success")
      updateUser({ image: null })
    },
  })

  const onPick = useCallback((file: File | undefined) => {
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => setSource(String(reader.result))
    reader.readAsDataURL(file)
  }, [])

  const save = async () => {
    if (!source || !area) return
    try {
      const file = await cropToFile(source, area)
      upload.mutate({ image: file })
    } catch {
      haptic("error")
      toast.error(t("That image could not be processed."))
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-4">
        <Avatar className="size-16">
          <AvatarImage src={user.image ?? undefined} alt={user.name} />
          <AvatarFallback className="text-lg">
            {initialsOf(user.name)}
          </AvatarFallback>
        </Avatar>

        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={!enabled}
            onClick={() => fileInput.current?.click()}
          >
            <CameraIcon className="size-4" />
            {t("Choose a photo")}
          </Button>
          {user.image ? (
            <Button
              variant="ghost"
              size="sm"
              className="text-destructive hover:bg-destructive/10 hover:text-destructive"
              disabled={remove.isPending}
              onClick={() => remove.mutate({})}
            >
              <TrashIcon className="size-4" />
              {t("Remove")}
            </Button>
          ) : null}
        </div>

        <input
          ref={fileInput}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          className="sr-only"
          onChange={(event) => onPick(event.target.files?.[0])}
        />
      </div>

      {!enabled ? (
        <p className="text-xs text-muted-foreground">
          {t("Photo uploads are turned off on this server.")}
        </p>
      ) : null}

      {source ? (
        <div className="flex flex-col gap-3">
          <div className="relative h-64 overflow-hidden rounded-xl bg-muted">
            <Cropper
              image={source}
              crop={crop}
              zoom={zoom}
              aspect={1}
              cropShape="round"
              showGrid={false}
              onCropChange={setCrop}
              onZoomChange={setZoom}
              onCropComplete={(_, pixels) => setArea(pixels)}
            />
          </div>

          <Slider
            value={[zoom]}
            min={1}
            max={4}
            step={0.05}
            onValueChange={(value) => {
              const next = Array.isArray(value) ? value[0] : value
              if (typeof next === "number") setZoom(next)
            }}
          />

          <div className="flex gap-2">
            <Button
              variant="outline"
              className="flex-1"
              onClick={() => setSource(null)}
            >
              {t("Cancel")}
            </Button>
            <Button
              className="flex-1"
              disabled={upload.isPending || !area}
              onClick={save}
            >
              {upload.isPending ? <Spinner className="size-4" /> : null}
              {t("Save photo")}
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  )
}
