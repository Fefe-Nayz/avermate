"use client";

import DeleteGradeDialog from "@/components/dialogs/delete-grade-dialog";
import UpdateGradeDialog from "@/components/dialogs/update-grade-dialog";
import { Button } from "@/components/ui/button";
import {
  DropDrawer,
  DropDrawerTrigger,
  DropDrawerContent,
  DropDrawerItem,
  DropDrawerGroup,
} from "@/components/ui/dropdrawer";
import { apiClient } from "@/lib/api";
import { toast } from "@/lib/toast";
import { PartialGrade } from "@/types/grade";
import { EllipsisVerticalIcon } from "@heroicons/react/24/outline";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Calculator, Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";

export default function GradeMoreButton({
  grade,
  shouldBackOnDelete = true,
  onCompositeActivated,
}: {
  grade: PartialGrade;
  shouldBackOnDelete?: boolean;
  onCompositeActivated?: () => void;
}) {
  const queryClient = useQueryClient();
  const router = useRouter();
  const transformMutation = useMutation({
    mutationKey: ["grades", grade.id, "transform-composite"],
    mutationFn: async () => {
      const response = await apiClient.post(`grades/${grade.id}/composite`);
      return response.json();
    },
    onSuccess: async () => {
      toast.success("Note transformée en note composite");
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["grades"] }),
        queryClient.invalidateQueries({ queryKey: ["grades", grade.id] }),
        queryClient.invalidateQueries({ queryKey: ["subjects"] }),
        queryClient.invalidateQueries({
          queryKey: ["subjects", "organized-by-periods"],
        }),
        queryClient.invalidateQueries({ queryKey: ["recent-grades"] }),
      ]);

      if (onCompositeActivated) {
        onCompositeActivated();
        return;
      }

      sessionStorage.setItem(`openCompositeEditor:${grade.id}`, "true");
      router.push(`/dashboard/grades/${grade.id}/${grade.periodId ?? "full-year"}`);
    },
    onError: () => {
      toast.error("Impossible de transformer la note.");
    },
  });

  return (
    <DropDrawer>
      <DropDrawerTrigger asChild>
        <Button size="icon" variant="outline">
          <EllipsisVerticalIcon className="size-4" />
        </Button>
      </DropDrawerTrigger>

      <DropDrawerContent>
        <DropDrawerGroup>
          {!grade.isComposite ? (
            <DropDrawerItem
              onSelect={() => transformMutation.mutate()}
              disabled={transformMutation.isPending}
              icon={
                transformMutation.isPending ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Calculator className="size-4" />
                )
              }
            >
              Activer note composite
            </DropDrawerItem>
          ) : null}

          {/* Update grade */}
          <UpdateGradeDialog gradeId={grade.id} />

          {/* Delete grade */}
          <DeleteGradeDialog
            grade={grade}
            shouldBackOnDelete={shouldBackOnDelete}
          />
        </DropDrawerGroup>
      </DropDrawerContent>
    </DropDrawer>
  );
}
