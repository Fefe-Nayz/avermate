import { adminSurface } from "./admin";
import { destructiveSurface } from "./destructive";
import { documentsSurface } from "./documents";
import { materialsSurface } from "./materials";
import { plannerSurface } from "./planner";
import { promptsSurface } from "./prompts";
import { projectsSurface } from "./projects";
import { readSurface } from "./read";
import { resourcesSurface } from "./resources";
import { socialManageSurface } from "./social-manage";
import { socialModerationSurface } from "./social-moderation";
import { socialReadSurface } from "./social-read";
import { writeSurface } from "./write";
import { actionsSurface } from "./actions";
import { conversationsSurface } from "./conversations";
import type { McpSurface } from "../shared";

/** Registration order is part of the deterministic MCP catalog contract. */
export const SURFACES: readonly McpSurface[] = [
  readSurface,
  projectsSurface,
  conversationsSurface,
  actionsSurface,
  resourcesSurface,
  promptsSurface,
  writeSurface,
  socialReadSurface,
  socialManageSurface,
  destructiveSurface,
  adminSurface,
  socialModerationSurface,
  plannerSurface,
  materialsSurface,
  documentsSurface,
];
