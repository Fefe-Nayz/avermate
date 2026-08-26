"use client"

import type { AgentApprovalMode } from "@avermate/agent-contracts"
import {
  ActivityIcon,
  ArchiveIcon,
  CheckIcon,
  DownloadIcon,
  InfoIcon,
  ListTreeIcon,
  LoaderCircleIcon,
  Maximize2Icon,
  MoreHorizontalIcon,
  PanelLeftCloseIcon,
  PanelLeftOpenIcon,
  SaveIcon,
  ShieldCheckIcon,
  StarIcon,
  Trash2Icon,
  XIcon,
} from "lucide-react"
import Link from "next/link"
import { useExtracted } from "next-intl"
import { Button, buttonVariants } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import type {
  AssistantProjectOption,
  AssistantThreadDetail,
  AssistantWorkspaceActions,
} from "./assistant-types"
import { activeRun } from "./assistant-thread-model"

function downloadExport(result: {
  fileName: string
  mimeType: string
  content: string
}) {
  const url = URL.createObjectURL(
    new Blob([result.content], { type: result.mimeType })
  )
  const anchor = document.createElement("a")
  anchor.href = url
  anchor.download = result.fileName
  anchor.click()
  window.setTimeout(() => URL.revokeObjectURL(url), 0)
}

function SafetyDisclosure({
  approvalMode,
  placementLabel,
  onApprovalModeChange,
}: {
  approvalMode: AgentApprovalMode
  placementLabel: string
  onApprovalModeChange: (mode: AgentApprovalMode) => void
}) {
  const t = useExtracted()
  const modes: { value: AgentApprovalMode; label: string; hint: string }[] = [
    {
      value: "read-only",
      label: t("Read only"),
      hint: t("It can look at your data and change nothing."),
    },
    {
      value: "confirm-writes",
      label: t("Ask before changing"),
      hint: t("Every change waits for you to approve it."),
    },
    {
      value: "auto-reversible",
      label: t("Change what can be undone"),
      hint: t("Reversible changes happen; the rest still asks."),
    },
  ]
  const current = modes.find((mode) => mode.value === approvalMode)

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={t("What the assistant may do")}
        render={
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="min-w-0 gap-1.5 px-2 font-normal text-muted-foreground"
          />
        }
      >
        <ShieldCheckIcon className="shrink-0" />
        <span className="hidden max-w-32 truncate lg:inline">
          {current?.label}
        </span>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-72">
        <DropdownMenuGroup>
          <DropdownMenuLabel>{t("What it may do")}</DropdownMenuLabel>
          {modes.map((mode) => (
            <DropdownMenuItem
              key={mode.value}
              onClick={() => onApprovalModeChange(mode.value)}
            >
              <CheckIcon
                className={
                  mode.value === approvalMode ? "opacity-100" : "opacity-0"
                }
              />
              <span className="flex min-w-0 flex-col">
                <span>{mode.label}</span>
                <span className="text-xs text-wrap text-muted-foreground">
                  {mode.hint}
                </span>
              </span>
            </DropdownMenuItem>
          ))}
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <DropdownMenuLabel>{t("Where it runs")}</DropdownMenuLabel>
          <p className="px-2 pb-1.5 text-xs text-pretty text-muted-foreground">
            {placementLabel}
          </p>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export function ConversationHeader({
  detail,
  railOpen,
  onToggleRail,
  onClose,
  expandHref,
  actions,
  projects,
  openContext,
  approvalMode,
  placementLabel,
}: {
  detail: AssistantThreadDetail
  railOpen: boolean
  onToggleRail: () => void
  onClose?: () => void
  expandHref?: string
  actions: AssistantWorkspaceActions
  projects: readonly AssistantProjectOption[]
  openContext: () => void
  approvalMode: AgentApprovalMode
  placementLabel: string
}) {
  const t = useExtracted()
  const thread = detail.thread
  const exportConversation = async (
    format: "json" | "markdown",
    mode: "active-branch" | "whole-dag"
  ) => downloadExport(await actions.exportThread(thread.id, format, mode))

  return (
    <header className="flex min-h-(--header-h) items-center gap-2 border-b px-2 md:px-3">
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        onClick={onToggleRail}
        aria-label={
          railOpen ? t("Hide conversations") : t("Show conversations")
        }
      >
        {railOpen ? <PanelLeftCloseIcon /> : <PanelLeftOpenIcon />}
      </Button>
      <div className="min-w-0 flex-1">
        <h2 className="truncate text-sm font-medium">{thread.title}</h2>
        <div
          className="flex items-center gap-1 text-xs text-muted-foreground"
          role="status"
          aria-live="polite"
          aria-atomic="true"
        >
          <span>
            {t("{count, plural, one {# message} other {# messages}}", {
              count: detail.messages.length,
            })}
          </span>
          {activeRun(detail) ? (
            <>
              <span>·</span>
              <span className="flex items-center gap-1 text-primary">
                <LoaderCircleIcon className="size-3 animate-spin motion-reduce:animate-none" />{" "}
                {t("Running")}
              </span>
            </>
          ) : null}
        </div>
      </div>
      {detail.branches.length > 1 ? (
        <Select
          value={detail.activeBranchId ?? undefined}
          onValueChange={(value) => {
            const branch = detail.branches.find(
              (candidate) => candidate.id === value
            )
            if (branch) actions.switchBranch(branch)
          }}
        >
          <SelectTrigger size="sm" className="hidden max-w-40 md:flex">
            <ListTreeIcon /> <SelectValue placeholder={t("Branch")} />
          </SelectTrigger>
          <SelectContent>
            {detail.branches.map((branch, index) => (
              <SelectItem key={branch.id} value={branch.id}>
                {branch.name ??
                  t("Branch {number}", { number: String(index + 1) })}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      ) : null}
      <SafetyDisclosure
        approvalMode={approvalMode}
        placementLabel={placementLabel}
        onApprovalModeChange={actions.setApprovalMode}
      />
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        aria-label={t("Inspect context and usage")}
        onClick={openContext}
      >
        <InfoIcon />
      </Button>
      <Link
        href="/assistant/actions"
        className={buttonVariants({ variant: "ghost", size: "icon-sm" })}
        aria-label={t("Open action activity")}
      >
        <ActivityIcon />
      </Link>
      <DropdownMenu>
        <DropdownMenuTrigger
          aria-label={t("Conversation actions")}
          render={<Button type="button" variant="ghost" size="icon-sm" />}
        >
          <MoreHorizontalIcon />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {/*
           * Base UI reads a menu label through `MenuGroupContext`, so a label
           * outside a group is not a style slip — it throws at render. Nothing
           * static catches it: this menu typechecked and linted clean, then
           * blew up the moment somebody opened it.
           */}
          <DropdownMenuGroup>
            <DropdownMenuLabel>{t("Conversation")}</DropdownMenuLabel>
            <DropdownMenuItem
              onClick={() =>
                void actions.updateThread(thread.id, {
                  starred: !thread.starredAt,
                })
              }
            >
              <StarIcon /> {thread.starredAt ? t("Unstar") : t("Star")}
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() =>
                void actions.updateThread(thread.id, {
                  archived: !thread.archivedAt,
                })
              }
            >
              <ArchiveIcon />
              {thread.archivedAt ? t("Unarchive") : t("Archive")}
            </DropdownMenuItem>
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>
                <DownloadIcon /> {t("Export")}
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent>
                <DropdownMenuItem
                  onClick={() =>
                    void exportConversation("markdown", "active-branch")
                  }
                >
                  {t("Markdown · active branch")}
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() =>
                    void exportConversation("json", "active-branch")
                  }
                >
                  {t("JSON · active branch")}
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => void exportConversation("json", "whole-dag")}
                >
                  {t("JSON · whole conversation tree")}
                </DropdownMenuItem>
              </DropdownMenuSubContent>
            </DropdownMenuSub>
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>
                <SaveIcon /> {t("Save to project")}
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent>
                {projects.length ? (
                  projects.map((project) => (
                    // A heading and the two things it heads: that is a group,
                    // which is both what Base UI requires and what this flat run
                    // of three keyed siblings was already trying to say.
                    <DropdownMenuGroup key={project.id}>
                      <DropdownMenuLabel>
                        {project.emoji ? `${project.emoji} ` : ""}
                        {project.title}
                      </DropdownMenuLabel>
                      <DropdownMenuItem
                        onClick={() =>
                          void actions.saveToProject(
                            thread.id,
                            project.id,
                            "reference"
                          )
                        }
                      >
                        {t("Add conversation reference")}
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onClick={() =>
                          void actions.saveToProject(
                            thread.id,
                            project.id,
                            "markdown"
                          )
                        }
                      >
                        {t("Create Markdown document")}
                      </DropdownMenuItem>
                    </DropdownMenuGroup>
                  ))
                ) : (
                  <DropdownMenuItem disabled>
                    {t("Create a study project first")}
                  </DropdownMenuItem>
                )}
              </DropdownMenuSubContent>
            </DropdownMenuSub>
          </DropdownMenuGroup>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            variant="destructive"
            onClick={() => void actions.trashThread(thread.id)}
          >
            <Trash2Icon /> {t("Move to trash")}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      {/*
        Opening the page, not a second full-screen mode.
        
        `/assistant` already is this workspace at full width, so a `full` flag
        was a second way to say the same thing — one more piece of state to
        persist, and no address to share or come back to. It sits on this row
        next to Close; drawn as a floating cluster over the panel it landed on
        top of this header and gave the reader two X buttons an inch apart.
      */}
      {expandHref ? (
        <Link
          href={expandHref}
          className={buttonVariants({ variant: "ghost", size: "icon-sm" })}
          aria-label={t("Open the full assistant page")}
        >
          <Maximize2Icon />
        </Link>
      ) : null}
      {onClose ? (
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label={t("Close assistant")}
          onClick={onClose}
        >
          <XIcon />
        </Button>
      ) : null}
    </header>
  )
}
