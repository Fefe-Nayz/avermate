"use client";

import { useState } from "react";
import { Megaphone, Plus, Trash2 } from "lucide-react";

import {
  useAdminAnnouncements,
  useCreateAdminAnnouncement,
  useDeleteAdminAnnouncement,
  useUpdateAdminAnnouncement,
} from "@/hooks/use-admin-announcements";
import { toast } from "@/lib/toast";
import type { AnnouncementTone } from "@/types/announcement";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  SelectDrawer,
  SelectDrawerContent,
  SelectDrawerGroup,
  SelectDrawerItem,
  SelectDrawerTrigger,
} from "@/components/ui/selectdrawer";

const toneLabels: Record<AnnouncementTone, string> = {
  info: "Info",
  success: "Succès",
  warning: "Important",
};

export function AnnouncementAdminPanel() {
  const { data: announcements } = useAdminAnnouncements();
  const createAnnouncement = useCreateAdminAnnouncement();
  const updateAnnouncement = useUpdateAdminAnnouncement();
  const deleteAnnouncement = useDeleteAdminAnnouncement();
  const [title, setTitle] = useState("");
  const [message, setMessage] = useState("");
  const [tone, setTone] = useState<AnnouncementTone>("info");

  const handleCreate = () => {
    if (!title.trim() || !message.trim()) {
      toast.error("Titre et message requis.");
      return;
    }

    createAnnouncement.mutate(
      {
        title: title.trim(),
        message: message.trim(),
        tone,
        active: true,
        startsAt: null,
        endsAt: null,
      },
      {
        onSuccess: () => {
          setTitle("");
          setMessage("");
          setTone("info");
          toast.success("Bannière envoyée");
        },
        onError: () => toast.error("Impossible d'envoyer la bannière."),
      }
    );
  };

  return (
    <Card className="min-w-0 overflow-hidden">
      <CardHeader>
        <div className="flex items-start gap-3">
          <div className="rounded-md border bg-muted p-2 text-muted-foreground">
            <Megaphone className="size-4" />
          </div>
          <div>
            <CardTitle>Bannières d'information</CardTitle>
            <CardDescription>
              Envoyez une notification dismissable, mémorisée par utilisateur.
            </CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 lg:grid-cols-[minmax(0,220px)_minmax(0,1fr)_150px_auto] lg:items-end">
          <div className="space-y-1">
            <p className="text-xs font-medium text-muted-foreground">Titre</p>
            <Input value={title} onChange={(event) => setTitle(event.target.value)} />
          </div>
          <div className="space-y-1">
            <p className="text-xs font-medium text-muted-foreground">Message</p>
            <Textarea
              value={message}
              onChange={(event) => setMessage(event.target.value)}
              className="min-h-9"
            />
          </div>
          <div className="space-y-1">
            <p className="text-xs font-medium text-muted-foreground">Ton</p>
            <SelectDrawer value={tone} onValueChange={(value) => setTone(value as AnnouncementTone)}>
              <SelectDrawerTrigger>{toneLabels[tone]}</SelectDrawerTrigger>
              <SelectDrawerContent title="Ton">
                <SelectDrawerGroup>
                  <SelectDrawerItem value="info">Info</SelectDrawerItem>
                  <SelectDrawerItem value="success">Succès</SelectDrawerItem>
                  <SelectDrawerItem value="warning">Important</SelectDrawerItem>
                </SelectDrawerGroup>
              </SelectDrawerContent>
            </SelectDrawer>
          </div>
          <Button onClick={handleCreate} disabled={createAnnouncement.isPending}>
            <Plus className="size-4" />
            Envoyer
          </Button>
        </div>

        <div className="space-y-2">
          {(announcements ?? []).map((announcement) => (
            <div
              key={announcement.id}
              className="flex flex-col gap-3 rounded-md border p-3 sm:flex-row sm:items-start sm:justify-between"
            >
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="font-medium">{announcement.title}</p>
                  <Badge variant={announcement.active ? "default" : "secondary"}>
                    {announcement.active ? "Active" : "Pause"}
                  </Badge>
                  <Badge variant="outline">{toneLabels[announcement.tone]}</Badge>
                </div>
                <p className="mt-1 text-sm text-muted-foreground">
                  {announcement.message}
                </p>
              </div>

              <div className="flex shrink-0 items-center gap-2">
                <Switch
                  checked={Boolean(announcement.active)}
                  onCheckedChange={(active) =>
                    updateAnnouncement.mutate({
                      id: announcement.id,
                      input: { active },
                    })
                  }
                />
                <Button
                  variant="outline"
                  size="icon"
                  onClick={() => deleteAnnouncement.mutate(announcement.id)}
                  disabled={deleteAnnouncement.isPending}
                >
                  <Trash2 className="size-4" />
                  <span className="sr-only">Supprimer</span>
                </Button>
              </div>
            </div>
          ))}

          {announcements?.length === 0 ? (
            <p className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
              Aucune bannière créée.
            </p>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}
