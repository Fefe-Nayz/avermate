"use client"

import { useExtracted } from "next-intl"
import type { McpScope } from "./mcp-scope-model"

export interface McpScopeCopy {
  label: string
  description: string
}

/**
 * One translated, user-facing explanation for every Avermate MCP scope.
 *
 * Keep the literal messages beside `useExtracted`: the extractor cannot see
 * messages reached through dynamic keys. Both OAuth screens consume this hook
 * so the registration ceiling and the eventual grant cannot describe the same
 * permission differently.
 */
export function useMcpScopeCopy(): Record<McpScope, McpScopeCopy> {
  const t = useExtracted()

  return {
    "avermate:read": {
      label: t("Read your account and academic data"),
      description: t(
        "Read your account profile, academic structure, grades, averages, goals, preferences, announcements, analytics, recaps and owned job results."
      ),
    },
    "avermate:write": {
      label: t("Create and update academic data"),
      description: t(
        "Create and update academic data, goals, dashboard cards, preferences, feedback and read status."
      ),
    },
    "avermate:delete": {
      label: t("Request destructive actions"),
      description: t(
        "Make destructive tools available. Each destructive action still requires a separate confirmation."
      ),
    },
    "avermate:admin": {
      label: t("Use administration tools"),
      description: t(
        "Use administration tools only when your account is an administrator. Administrative changes still require their matching write or delete permission."
      ),
    },
    "avermate:social.read": {
      label: t("Read your social data"),
      description: t(
        "Read your sharing choices, friends and requests, blocks, classes and shared averages, notifications, and reports you submitted."
      ),
    },
    "avermate:social.manage": {
      label: t("Manage your social data"),
      description: t(
        "Update your handle and sharing choices, manage friendships, blocks and classes, and submit safety reports. Destructive actions still require confirmation."
      ),
    },
    "avermate:social.moderate": {
      label: t("Moderate social activity"),
      description: t(
        "Read moderation counts and safety reports, update report handling, and freeze or unfreeze classes, only when your account is an administrator."
      ),
    },
    "avermate:planner.read": {
      label: t("Read your agenda"),
      description: t(
        "Read planner tasks and events, plus the combined agenda of dated goals, grades and academic periods."
      ),
    },
    "avermate:planner.write": {
      label: t("Manage your agenda"),
      description: t(
        "Create and update planner tasks and events, change task status, and request confirmed planner deletion."
      ),
    },
    "avermate:materials.read": {
      label: t("Read your course materials"),
      description: t(
        "Read folders, document sources, OCR text, lecture recordings, timestamped transcripts and safe synchronization status."
      ),
    },
    "avermate:materials.write": {
      label: t("Manage your course materials"),
      description: t(
        "Create folders, rename or move documents, start OCR or provider synchronization, and request confirmed deletion. This does not allow file uploads or provider setup."
      ),
    },
    "avermate:documents.read": {
      label: t("Read your study documents"),
      description: t(
        "Read your revision sheets, notes, mind maps and slide decks, including their linked academic sources."
      ),
    },
    "avermate:documents.write": {
      label: t("Manage your study documents"),
      description: t(
        "Create and update study documents, export slide decks to PowerPoint, and request confirmed document deletion."
      ),
    },
  }
}
